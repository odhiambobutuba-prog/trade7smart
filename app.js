const WS_URL = "wss://ws.derivws.com/websockets/v3";
const WATCHLIST = [
  ["R_100", "Volatility 100"],
  ["R_75", "Volatility 75"],
  ["R_50", "Volatility 50"],
  ["R_25", "Volatility 25"],
  ["R_10", "Volatility 10"],
];

const state = {
  ws: null,
  scannerOnly: false,
  authorized: false,
  running: false,
  activeTrade: false,
  appId: "1089",
  symbol: "R_100",
  loginid: "",
  currency: "USD",
  balance: null,
  accountTarget: "demo",
  lastQuote: "----.--",
  lastDigit: null,
  oddStreak: 0,
  digitStreak: 0,
  repeatDigit: null,
  lossCount: 0,
  cumulativeLoss: 0,
  baseStake: 0.35,
  currentStake: 0.35,
  totalProfit: 0,
  dailyProfit: 0,
  totalTrades: 0,
  wins: 0,
  losses: 0,
  cyclesCompleted: 0,
  longestRecovery: 0,
  recoveryHistory: [],
  cycleRecoveryDepth: 0,
  soundEnabled: true,
  notificationsEnabled: false,
  aiAutoEnabled: false,
  realCountdownActive: false,
  realCountdownPassed: false,
  replayDigits: [],
  tradeEntryDigit: null,
  tradeEndDigit: null,
  tradeCursorDigit: null,
  tradeCursorTimer: null,
  lastReplay: [],
  requestMap: new Map(),
  settledContracts: new Set(),
  tickHistory: [],
  digitHistory: [],
  recentOdds: [],
  profitHistory: [0],
  digitCounts: Array(10).fill(0),
  watch: new Map(),
  marketStats: new Map(),
};

const $ = (id) => document.getElementById(id);

function toast(message, type = "") {
  const item = document.createElement("div");
  item.className = `toast ${type}`;
  item.textContent = message;
  $("toast-layer").appendChild(item);
  setTimeout(() => item.remove(), 4300);
}

function journal(message, type = "") {
  const li = document.createElement("li");
  li.className = type;
  if (typeof message === "object") {
    li.innerHTML = `<div class="journal-line"><span>${message.time || new Date().toLocaleTimeString()}</span><b>${message.signal || "--"}</b><span>${message.stake || "--"}</span><span>${message.result || "--"} L${message.level ?? 0}</span></div>`;
  } else {
    li.textContent = `${new Date().toLocaleTimeString()}  ${message}`;
  }
  $("journal").prepend(li);
}

function playTone(kind = "info") {
  if (!state.soundEnabled) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const tones = {
      ready: 880,
      trade: 640,
      win: 1040,
      loss: 240,
      danger: 180,
    };
    osc.frequency.value = tones[kind] || 520;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
  } catch (error) {
    state.soundEnabled = false;
  }
}

async function requestNotifications() {
  if (!("Notification" in window)) {
    toast("Phone notifications are not supported in this browser.", "danger");
    return;
  }
  const permission = await Notification.requestPermission();
  state.notificationsEnabled = permission === "granted";
  localStorage.setItem("trade7smart_notifications", state.notificationsEnabled ? "1" : "0");
  $("notify-toggle").textContent = state.notificationsEnabled ? "Notify On" : "Notify";
  toast(state.notificationsEnabled ? "Phone notifications enabled." : "Notifications not allowed.", state.notificationsEnabled ? "good" : "danger");
}

async function phoneNotify(title, body, kind = "info") {
  if (!state.notificationsEnabled || !("Notification" in window) || Notification.permission !== "granted") return;
  const options = {
    body,
    icon: "./icon.svg",
    badge: "./icon.svg",
    tag: `trade7smart-${kind}`,
    renotify: true,
    data: { url: location.href },
  };
  try {
    const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.ready : null;
    if (reg?.showNotification) await reg.showNotification(title, options);
    else new Notification(title, options);
  } catch (error) {
    try { new Notification(title, options); } catch (_) {}
  }
}

function nextReqId(type) {
  const reqId = Date.now() + Math.floor(Math.random() * 10000);
  state.requestMap.set(reqId, type);
  return reqId;
}

function send(payload, type) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return false;
  const req_id = nextReqId(type);
  state.ws.send(JSON.stringify({ ...payload, req_id }));
  return req_id;
}

function connectWebSocket() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_URL}?app_id=${encodeURIComponent(state.appId)}`);
    const timeout = setTimeout(() => reject(new Error("Connection timeout")), 12000);
    ws.onopen = () => {
      clearTimeout(timeout);
      resolve(ws);
    };
    ws.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("Connection failed"));
    };
  });
}

function bindSocket() {
  state.ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.error) {
      handleError(data);
      return;
    }

    if (data.msg_type === "authorize") handleAuthorize(data.authorize);
    if (data.msg_type === "balance") handleBalance(data.balance);
    if (data.msg_type === "tick") handleTick(data.tick);
    if (data.msg_type === "proposal") handleProposal(data.proposal);
    if (data.msg_type === "buy") handleBuy(data.buy);
    if (data.msg_type === "proposal_open_contract") handleContract(data.proposal_open_contract);
    updateDashboard();
  };

  state.ws.onclose = () => {
    const wasScannerOnly = state.scannerOnly;
    state.authorized = false;
    state.scannerOnly = false;
    state.running = false;
    state.activeTrade = false;
    updateDashboard();
    if (!wasScannerOnly) toast("Connection closed.", "danger");
    if (!state.authorized) setTimeout(connectPublicScanner, 1800);
  };
}

async function connectPublicScanner() {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) return;
  state.appId = $("app-id").value.trim() || "1089";
  try {
    state.ws = await connectWebSocket();
    bindSocket();
    state.scannerOnly = true;
    WATCHLIST.forEach(([symbol]) => send({ ticks: symbol, subscribe: 1 }, `watch:${symbol}`));
    hideLoader();
    updateDashboard();
  } catch (error) {
    setTimeout(connectPublicScanner, 3000);
  }
}

async function connectAccount() {
  const token = $("api-token").value.trim();
  state.accountTarget = $("account-target").value;
  state.appId = $("app-id").value.trim() || "1089";
  state.symbol = $("symbol").value;

  if (!token) {
    toast("Paste your Deriv API token first.", "danger");
    return;
  }

  $("connect-button").disabled = true;
  $("connect-button").textContent = "Connecting";

  try {
    if ($("save-token").checked) {
      localStorage.setItem("trade7smart_token", token);
      localStorage.setItem("trade7smart_account_target", state.accountTarget);
      localStorage.setItem("trade7smart_app_id", state.appId);
      localStorage.setItem("trade7smart_symbol", state.symbol);
    } else {
      localStorage.removeItem("trade7smart_token");
    }
    if (state.ws) state.ws.close();
    state.scannerOnly = false;
    state.ws = await connectWebSocket();
    bindSocket();
    send({ authorize: token }, "authorize");
  } catch (error) {
    $("connect-button").disabled = false;
    $("connect-button").textContent = "Connect";
    toast("Connection failed. Check token or internet.", "danger");
  }
}

function handleAuthorize(authorize) {
  state.scannerOnly = false;
  state.authorized = true;
  state.loginid = authorize.loginid || "";
  state.currency = authorize.currency || "USD";
  const isDemo = state.loginid.toUpperCase().startsWith("VRTC");

  if (state.accountTarget === "demo" && !isDemo) {
    toast("This is a Real token. Switch account to Real if you want to use it.", "danger");
    journal("Real token blocked while Demo account is selected.", "loss");
    state.authorized = false;
    $("connect-button").disabled = false;
    $("connect-button").textContent = "Connect";
    return;
  }

  if (state.accountTarget === "real" && isDemo) {
    toast("This is a Demo token. Switch account to Demo.", "danger");
    journal("Demo token blocked while Real account is selected.", "loss");
    state.authorized = false;
    $("connect-button").disabled = false;
    $("connect-button").textContent = "Connect";
    return;
  }

  $("connect-button").disabled = false;
  $("connect-button").textContent = "Reconnect";
  document.body.classList.add("connected-mode");
  hideLoader();
  toast(`${isDemo ? "Demo" : "Real"} account connected.`, "good");
  journal(`Connected ${state.loginid} on ${state.symbol}.`, "trade");
  subscribeCoreStreams();
}

function subscribeCoreStreams() {
  send({ balance: 1, subscribe: 1 }, "balance");
  send({ forget_all: "ticks" }, "forget");
  WATCHLIST.forEach(([symbol]) => send({ ticks: symbol, subscribe: 1 }, `watch:${symbol}`));
}

function handleBalance(balance) {
  state.balance = Number(balance.balance || 0);
  state.currency = balance.currency || state.currency;
}

function handleTick(tick) {
  const symbol = tick.symbol || state.symbol;
  const quote = Number(tick.quote);
  const display = Number.isFinite(quote) ? quote.toFixed(2) : String(tick.quote);
  const digit = Number(display.replace(".", "").slice(-1));

  updateWatch(symbol, display, digit);
  maybeTradeAiMarket(symbol);
  if (symbol !== state.symbol) return;

  state.lastQuote = display;
  state.lastDigit = digit;
  state.tickHistory.push(quote);
  state.digitHistory.push(digit);
  if (state.tickHistory.length > 80) state.tickHistory.shift();
  if (state.digitHistory.length > 400) state.digitHistory.shift();
  if (Number.isInteger(digit)) state.digitCounts[digit] += 1;

  if (digit % 2 === 1) {
    state.oddStreak += 1;
    state.recentOdds.push(digit);
    if (state.recentOdds.length > getSettings().preferredOdds) state.recentOdds.shift();
  } else {
    state.oddStreak = 0;
    state.recentOdds = [];
  }

  if (digit === state.repeatDigit) {
    state.digitStreak += 1;
  } else {
    state.repeatDigit = digit;
    state.digitStreak = 1;
  }

  state.replayDigits = state.recentOdds.slice();
  if ($("differ-repeat-digit")) $("differ-repeat-digit").textContent = state.repeatDigit ?? "--";

  if (state.oddStreak >= 4 || state.digitStreak >= 3 || checkEntryReady()) {
    showStreakPrompt(display);
  }

  if (state.running && !state.activeTrade && checkEntryReady()) {
    triggerTrade(false);
  }
}

function updateWatch(symbol, display, digit) {
  const previous = state.watch.get(symbol);
  const value = Number(display);
  const direction = previous && value < previous.value ? "down" : "up";
  state.watch.set(symbol, { value, display, direction });

  const prior = state.marketStats.get(symbol) || {
    oddStreak: 0,
    digitStreak: 0,
    repeatDigit: null,
    recentDigits: [],
    progress: 0,
    digit: null,
  };
  const oddStreak = digit % 2 === 1 ? prior.oddStreak + 1 : 0;
  const digitStreak = digit === prior.repeatDigit ? prior.digitStreak + 1 : 1;
  const repeatDigit = digit;
  const recentDigits = [...(prior.recentDigits || []), digit].slice(-30);
  const settings = getSettings();
  const stat = {
    digit,
    oddStreak,
    digitStreak,
    repeatDigit,
    recentDigits,
    progress: 0,
  };
  const ai = computeMarketAi(stat, settings);
  stat.progress = ai.progress;
  stat.aiScore = ai.score;
  stat.signal = ai.signal;
  stat.ready = ai.ready;
  state.marketStats.set(symbol, stat);
}

function showStreakPrompt(display) {
  const settings = getSettings();
  if (settings.contractMode === "odds_even") {
    const preferred = settings.preferredOdds;
    if (state.oddStreak >= 4 && state.oddStreak <= 9) {
      journal(`Analysis: ${state.oddStreak} straight Odds at ${display}.`, "warn");
    }
    if (state.oddStreak === preferred) {
      toast(`Strong signal: ${preferred} Odds found. ${contractLabel(settings)} setup ready.`, "warn");
      playTone("ready");
      phoneNotify("Trade7Smart signal", `${preferred} Odds on ${state.symbol}. Entry ready.`, "signal");
    }
    return;
  }
  if (settings.contractMode === "differ") {
    if (state.digitStreak >= settings.differTrigger - 1) {
      journal(`Differ watch: digit ${state.repeatDigit} repeated ${state.digitStreak}x.`, "warn");
    }
    if (state.digitStreak === settings.differTrigger) {
      toast(`Differ trigger: ${state.digitStreak}x repeat on digit ${state.repeatDigit}.`, "warn");
      playTone("ready");
      phoneNotify("Trade7Smart Differ", `${state.symbol} digit ${state.repeatDigit} x${state.digitStreak}.`, "signal");
    }
    return;
  }
  const sample = state.digitHistory.slice(-settings.ouSample);
  if (sample.length >= settings.ouSample && checkEntryReady()) {
    toast(`Over/Under bias ready: ${contractLabel(settings)}.`, "warn");
    playTone("ready");
  }
}

function maybeTradeAiMarket(symbol) {
  const settings = getSettings();
  const stat = state.marketStats.get(symbol);
  if (!state.aiAutoEnabled || !state.running || state.activeTrade || !stat) return;
  if (state.lossCount > 0) return;

  const ai = computeMarketAi(stat, settings);
  if (!ai.ready) return;

  state.symbol = symbol;
  $("symbol").value = symbol;
  state.oddStreak = stat.oddStreak;
  state.digitStreak = stat.digitStreak;
  state.repeatDigit = stat.repeatDigit;
  state.lastDigit = stat.digit;
  state.recentOdds = Array.from({ length: Math.min(stat.oddStreak, settings.preferredOdds) }, () => stat.digit).filter((digit) => digit % 2 === 1);
  state.replayDigits = state.recentOdds.slice();
  journal(`AI Auto selected ${symbol}: ${ai.signal}.`, "trade");
  toast(`AI Auto trading ${symbol}.`, "good");
  phoneNotify("Trade7Smart AI Auto", `${symbol} ${ai.signal}. Trade starting.`, "ai");
  triggerTrade(false);
}

function getSettings() {
  const preferred = Number($("trigger-count").value || $("preferred-odds").value);
  const recoveryStart = Math.min(5, Math.max(0, Number($("recovery-start-losses").value) || 0));
  const profitBuffer = Math.max(Number($("profit-buffer").value) || 0, 0);
  return {
    contractMode: $("contract-mode").value || "odds_even",
    preferredOdds: preferred,
    stake: Math.max(Number($("stake").value) || 0.35, 0.35),
    shield: Math.max(Number($("shield").value) || 50, 1),
    executionMode: $("execution-mode").value,
    accountTarget: $("account-target").value,
    profitBuffer,
    recoveryStartLosses: recoveryStart,
    maxRecoverySteps: Math.max(Number($("max-recovery-steps").value) || 1, 1),
    maxStake: Math.max(Number($("max-stake").value) || 0.35, 0.35),
    dailyProfitTarget: Math.max(Number($("daily-profit-target").value) || 0, 0),
    dailyLossLimit: Math.max(Number($("daily-loss-limit").value) || 0, 0),
    minBalanceProtection: Math.max(Number($("min-balance-protection").value) || 0, 0),
    tradeDirection: $("trade-direction").value,
    barrier: Number($("ou-barrier").value || 5),
    ouDirection: $("ou-direction").value || "DIGITOVER",
    ouMinBias: Math.min(90, Math.max(50, Number($("ou-min-bias").value) || 58)),
    ouSample: Math.min(50, Math.max(10, Number($("ou-sample").value) || 20)),
    differTrigger: Number($("differ-trigger").value || 4),
    sessionTargetProfit: Math.max(Number($("session-target-profit").value) || 0, 0),
    sessionMaxLoss: Math.max(Number($("session-max-loss").value) || 0, 0),
  };
}

function contractModeLabel(mode) {
  if (mode === "over_under") return "Over / Under";
  if (mode === "differ") return "Differ";
  return "Odd / Even";
}

function computeMarketAi(stat, settings) {
  const mode = settings.contractMode;
  if (mode === "odds_even") {
    const target = settings.preferredOdds;
    const progress = stat.oddStreak / Math.max(target, 1);
    const score = Math.min(100, Math.round(progress * 88 + (stat.digit === stat.repeatDigit ? 4 : 0)));
    return {
      score,
      progress: Math.min(100, Math.round(progress * 100)),
      signal: `${stat.oddStreak}/${target} Odds`,
      signalType: "ODDS",
      ready: stat.oddStreak >= target,
      entryLabel: settings.tradeDirection === "DIGITEVEN" ? "EVEN" : "ODD",
    };
  }

  if (mode === "differ") {
    const target = settings.differTrigger;
    const progress = stat.digitStreak / Math.max(target, 1);
    const score = Math.min(100, Math.round(progress * 92));
    return {
      score,
      progress: Math.min(100, Math.round(progress * 100)),
      signal: `${stat.digitStreak}x digit ${stat.repeatDigit ?? "--"}`,
      signalType: "DIFFER",
      ready: stat.digitStreak >= target,
      entryLabel: "DIFFER",
    };
  }

  const sample = stat.recentDigits.slice(-settings.ouSample);
  const total = sample.length || 1;
  const under = sample.filter((d) => d < settings.barrier).length;
  const over = sample.filter((d) => d > settings.barrier).length;
  const underPct = Math.round((under / total) * 100);
  const overPct = Math.round((over / total) * 100);
  const biasSide = underPct >= overPct ? "OVER" : "UNDER";
  const biasPct = Math.max(underPct, overPct);
  const score = Math.min(100, Math.round(Math.max(0, biasPct - 50) * 2.1));
  const ready = biasPct >= settings.ouMinBias;
  return {
    score,
    progress: score,
    signal: `${biasSide} ${biasPct}% vs ${settings.barrier}`,
    signalType: biasSide,
    ready,
    entryLabel: biasSide,
    underPct,
    overPct,
  };
}

function getRankedMarkets(settings) {
  return WATCHLIST
    .map(([symbol, name]) => {
      const stat = state.marketStats.get(symbol) || {
        digit: "--",
        oddStreak: 0,
        digitStreak: 0,
        repeatDigit: null,
        recentDigits: [],
        progress: 0,
      };
      const ai = computeMarketAi(stat, settings);
      return { symbol, name, stat, ai, watch: state.watch.get(symbol) };
    })
    .sort((a, b) => b.ai.score - a.ai.score || b.ai.progress - a.ai.progress);
}

function checkEntryReady(settings = getSettings()) {
  if (settings.contractMode === "odds_even") {
    return state.oddStreak >= settings.preferredOdds;
  }
  if (settings.contractMode === "differ") {
    return state.digitStreak >= settings.differTrigger;
  }
  const sample = state.digitHistory.slice(-settings.ouSample);
  if (sample.length < settings.ouSample) return false;
  const under = sample.filter((d) => d < settings.barrier).length;
  const over = sample.filter((d) => d > settings.barrier).length;
  const underPct = (under / sample.length) * 100;
  const overPct = (over / sample.length) * 100;
  if (settings.ouDirection === "DIGITOVER") return underPct >= settings.ouMinBias;
  return overPct >= settings.ouMinBias;
}

function buildProposalPayload(stake, settings) {
  const base = {
    proposal: 1,
    amount: stake,
    basis: "stake",
    currency: state.currency,
    duration: 1,
    duration_unit: "t",
    symbol: state.symbol,
  };
  if (settings.contractMode === "odds_even") {
    return { ...base, contract_type: settings.tradeDirection };
  }
  if (settings.contractMode === "differ") {
    return { ...base, contract_type: "DIGITDIFF", barrier: String(state.repeatDigit ?? state.lastDigit ?? 0) };
  }
  return { ...base, contract_type: settings.ouDirection, barrier: String(settings.barrier) };
}

function contractLabel(settings) {
  if (settings.contractMode === "odds_even") {
    return settings.tradeDirection === "DIGITEVEN" ? "EVEN" : "ODD";
  }
  if (settings.contractMode === "differ") return "DIFFER";
  return settings.ouDirection === "DIGITOVER" ? `OVER ${settings.barrier}` : `UNDER ${settings.barrier}`;
}

function simulateContractWin(digit, settings) {
  if (settings.contractMode === "odds_even") {
    const wantsEven = settings.tradeDirection === "DIGITEVEN";
    return wantsEven ? digit % 2 === 0 : digit % 2 === 1;
  }
  if (settings.contractMode === "differ") {
    const reference = state.tradeEntryDigit ?? state.repeatDigit;
    return digit !== reference;
  }
  if (settings.ouDirection === "DIGITOVER") return digit > settings.barrier;
  return digit < settings.barrier;
}

function setContractMode(mode) {
  $("contract-mode").value = mode;
  if ($("strategy-contract-mode")) $("strategy-contract-mode").value = mode;
  document.querySelectorAll(".contract-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.mode === mode);
  });
  document.querySelectorAll(".mode-panel").forEach((panel) => {
    panel.classList.toggle("hidden", panel.id !== `mode-${mode}`);
  });
  if ($("ou-analysis")) $("ou-analysis").classList.toggle("hidden", mode !== "over_under");
  if ($("differ-analysis")) $("differ-analysis").classList.toggle("hidden", mode !== "differ");
  if ($("active-contract-badge")) $("active-contract-badge").textContent = contractModeLabel(mode);
  localStorage.setItem("trade7smart_contract_mode", mode);
  updateDashboard();
}

function payoutRatio() {
  return 0.91;
}

function getRecoveryLadder() {
  const settings = getSettings();
  const ladder = [];
  let losses = 0;
  for (let index = 0; index < settings.maxRecoverySteps; index += 1) {
    const stake = index < settings.recoveryStartLosses
      ? settings.stake
      : Math.min((losses + settings.profitBuffer) / payoutRatio(), settings.maxStake);
    ladder.push(Number(stake.toFixed(2)));
    losses += stake;
  }
  return ladder;
}

function calculateNextStake() {
  const settings = getSettings();
  if (state.lossCount < settings.recoveryStartLosses) return settings.stake;
  return Math.min((state.cumulativeLoss + settings.profitBuffer) / payoutRatio(), settings.maxStake);
}

function startBot() {
  const settings = getSettings();
  if (!state.authorized) {
    toast("You must connect your API token first.", "danger");
    journal("Run blocked: API token not connected.", "loss");
    return;
  }

  if (settings.accountTarget === "real" && !$("real-confirm").checked) {
    toast("Tick the Real account safety box first.", "danger");
    journal("Real account run blocked by safety confirmation.", "loss");
    return;
  }

  if (settings.accountTarget === "real" && !state.realCountdownPassed) {
    startRealCountdown();
    return;
  }

  state.baseStake = settings.stake;
  state.currentStake = settings.stake;
  state.cycleRecoveryDepth = 0;
  state.running = true;
  state.realCountdownPassed = false;
  $("bot-state").textContent = "Running";
  toast("Bot running. Waiting for odds signal.", "good");
  journal(`Bot started on ${settings.accountTarget.toUpperCase()}. PreferredOdds=${settings.preferredOdds}, Stake=${settings.stake.toFixed(2)}.`, "trade");
  updateDashboard();
}

function startRealCountdown() {
  state.realCountdownActive = true;
  let seconds = 5;
  $("real-countdown").textContent = `${seconds}s`;
  $("real-lock-title").textContent = "Countdown active";
  toast("Real account starts after countdown.", "warn");
  const timer = setInterval(() => {
    seconds -= 1;
    $("real-countdown").textContent = `${seconds}s`;
    if (seconds <= 0) {
      clearInterval(timer);
      state.realCountdownActive = false;
      state.realCountdownPassed = true;
      $("real-countdown").textContent = "READY";
      startBot();
    }
  }, 1000);
}

function stopBot() {
  state.running = false;
  state.activeTrade = false;
  stopContractCursor();
  $("bot-state").textContent = "Stopped";
  toast("Bot stopped.");
  journal("Bot stopped.");
  updateDashboard();
}

function triggerTrade(isRecovery) {
  const settings = getSettings();
  if (!state.authorized) {
    toast("You must connect your API token first.", "danger");
    journal("Trade blocked: API token not connected.", "loss");
    return;
  }

  state.activeTrade = true;
  state.baseStake = settings.stake;

  if (!isRecovery && state.lossCount < settings.recoveryStartLosses) {
    state.currentStake = settings.stake;
  }

  const stake = Number(state.currentStake.toFixed(2));
  if (!canPlaceTrade(stake, settings)) return;

  const label = contractLabel(settings);
  state.tradeEntryDigit = state.lastDigit;
  state.tradeCursorDigit = state.lastDigit;
  state.tradeEndDigit = null;
  startContractCursor();
  journal({ signal: `${label} ${isRecovery ? "Recovery" : "Entry"}`, stake: `${stake.toFixed(2)} ${state.currency}`, result: "EXEC", level: state.lossCount }, "trade");
  playTone("trade");

  if (settings.executionMode === "paper") {
    simulateOutcome();
    return;
  }

  send(buildProposalPayload(stake, settings), "proposal");
}

function canPlaceTrade(stake, settings) {
  if (stake > settings.maxStake) {
    stopForRisk(`Max stake blocked trade: ${stake.toFixed(2)} > ${settings.maxStake.toFixed(2)}.`);
    return false;
  }
  if (state.lossCount >= settings.maxRecoverySteps) {
    stopForRisk("Max recovery steps reached.");
    return false;
  }
  if (settings.dailyProfitTarget > 0 && state.dailyProfit >= settings.dailyProfitTarget) {
    stopForRisk("Daily profit target reached.");
    return false;
  }
  if (settings.dailyLossLimit > 0 && state.dailyProfit <= -settings.dailyLossLimit) {
    stopForRisk("Daily loss limit reached.");
    return false;
  }
  if (settings.sessionTargetProfit > 0 && state.dailyProfit >= settings.sessionTargetProfit) {
    stopForRisk("Session profit target reached.");
    return false;
  }
  if (settings.sessionMaxLoss > 0 && state.dailyProfit <= -settings.sessionMaxLoss) {
    stopForRisk("Session max loss reached.");
    return false;
  }
  if (settings.minBalanceProtection > 0 && state.balance !== null && state.balance - stake < settings.minBalanceProtection) {
    stopForRisk("Minimum balance protection blocked the trade.");
    return false;
  }
  return true;
}

function stopForRisk(message) {
  state.running = false;
  state.activeTrade = false;
  stopContractCursor();
  $("bot-state").textContent = "Risk stop";
  toast(message, "danger");
  phoneNotify("Trade7Smart risk stop", message, "risk");
  journal(`Immediate retry blocked: ${message}`, "loss");
  updateDashboard();
}

function handleProposal(proposal) {
  send({ buy: proposal.id, price: Number(state.currentStake.toFixed(2)) }, "buy");
}

function handleBuy(buy) {
  journal(`Contract bought: ${buy.contract_id}.`, "trade");
  send({ proposal_open_contract: 1, contract_id: buy.contract_id, subscribe: 1 }, "contract");
}

function handleContract(contract) {
  if (!contract.is_sold || state.settledContracts.has(contract.contract_id)) return;
  state.settledContracts.add(contract.contract_id);
  const endDigit = extractContractEndDigit(contract);
  settleTrade(Number(contract.profit || 0), endDigit);
}

function simulateOutcome() {
  setTimeout(() => {
    const digit = Math.floor(Math.random() * 10);
    const settings = getSettings();
    const won = simulateContractWin(digit, settings);
    const profit = won ? state.currentStake * payoutRatio() : -state.currentStake;
    settleTrade(profit, digit);
  }, 450);
}

function extractContractEndDigit(contract) {
  const raw = contract.exit_tick ?? contract.sell_spot ?? contract.current_spot ?? contract.entry_tick;
  if (raw === undefined || raw === null) return state.lastDigit;
  const text = String(raw).replace(".", "");
  const digit = Number(text.slice(-1));
  return Number.isInteger(digit) ? digit : state.lastDigit;
}

function settleTrade(profit, endDigit = state.lastDigit) {
  state.activeTrade = false;
  state.tradeEndDigit = endDigit;
  state.tradeCursorDigit = endDigit;
  stopContractCursor();
  state.totalProfit += profit;
  state.dailyProfit += profit;
  state.totalTrades += 1;
  state.profitHistory.push(state.totalProfit);
  if (state.profitHistory.length > 60) state.profitHistory.shift();

  if (profit > 0) {
    state.wins += 1;
    state.cyclesCompleted += 1;
    state.longestRecovery = Math.max(state.longestRecovery, state.cycleRecoveryDepth);
    state.recoveryHistory.push(state.cycleRecoveryDepth);
    const label = contractLabel(getSettings());
    state.lastReplay = [...state.replayDigits, "->", label, "->", endDigit ?? "--", "->", "WIN"];
    playTone("win");
    toast(`WIN +${profit.toFixed(2)} ${state.currency}. Cycle reset.`, "good");
    phoneNotify("Trade7Smart WIN", `Profit ${profit.toFixed(2)} ${state.currency}. Cycle reset.`, "win");
    journal({ signal: "Trade result", stake: `${state.currentStake.toFixed(2)} ${state.currency}`, result: `WIN ${profit.toFixed(2)}`, level: state.cycleRecoveryDepth }, "win");
    state.lossCount = 0;
    state.cumulativeLoss = 0;
    state.currentStake = state.baseStake;
    state.oddStreak = 0;
    state.recentOdds = [];
    state.digitStreak = 0;
    state.repeatDigit = state.lastDigit;
    state.cycleRecoveryDepth = 0;
    enforceSessionAfterSettle();
    updateDashboard();
    return;
  }

  state.losses += 1;
  state.lossCount += 1;
  state.cycleRecoveryDepth += 1;
  state.cumulativeLoss += Math.abs(profit);
  const lossLabel = contractLabel(getSettings());
  state.lastReplay = [...state.replayDigits, "->", lossLabel, "->", endDigit ?? "--", "->", "LOSS"];
  journal({ signal: "Trade result", stake: `${state.currentStake.toFixed(2)} ${state.currency}`, result: `LOSS ${profit.toFixed(2)}`, level: state.cycleRecoveryDepth }, "loss");
  toast("Loss. Recovery logic active.", "danger");
  playTone(state.cycleRecoveryDepth >= getSettings().maxRecoverySteps - 1 ? "danger" : "loss");

  if (state.cumulativeLoss > getSettings().shield) {
    state.running = false;
    $("bot-state").textContent = "Shield hit";
    journal("Shield hit. Bot stopped to protect account.", "loss");
    toast("Shield hit. Bot stopped.", "danger");
    updateDashboard();
    return;
  }

  if (state.lossCount >= getSettings().recoveryStartLosses) {
    state.currentStake = calculateNextStake();
    journal(`Recovery stake calculated: ${state.currentStake.toFixed(2)} ${state.currency}.`, "trade");
  } else {
    state.currentStake = state.baseStake;
  }

  enforceSessionAfterSettle();
  if (state.running) {
    $("bot-state").textContent = "Instant recovery";
    triggerTrade(state.lossCount >= getSettings().recoveryStartLosses);
  }
  updateDashboard();
}

function enforceSessionAfterSettle() {
  const settings = getSettings();
  if (settings.sessionTargetProfit > 0 && state.dailyProfit >= settings.sessionTargetProfit) {
    state.running = false;
    $("bot-state").textContent = "Target hit";
    toast("Session profit target reached. Bot stopped.", "good");
    journal("Session target reached. Bot stopped.", "win");
  }
  if (settings.sessionMaxLoss > 0 && state.dailyProfit <= -settings.sessionMaxLoss) {
    state.running = false;
    $("bot-state").textContent = "Session stop";
    toast("Session max loss reached. Bot stopped.", "danger");
    journal("Session max loss reached. Bot stopped.", "loss");
  }
}

function handleError(data) {
  const type = state.requestMap.get(data.req_id);
  const message = data.error?.message || "Request failed";
  if (type === "authorize") {
    state.authorized = false;
    $("connect-button").disabled = false;
    $("connect-button").textContent = "Connect";
    toast("Login failed. Check your API token.", "danger");
    journal("Login failed. Check token permissions.", "loss");
    updateDashboard();
    return;
  }
  state.activeTrade = false;
  stopContractCursor();
  toast(message, "danger");
  journal(message, "loss");
  updateDashboard();
}

function updateDashboard() {
  const settings = getSettings();
  const status = $("connection-state");
  status.className = "status-pill";
  if (state.authorized) {
    status.textContent = state.accountTarget === "demo" ? "Demo online" : "Real online";
    status.classList.add("online");
  } else if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    status.textContent = state.scannerOnly ? "Scanner live" : "Scanning";
    status.classList.add("scanning");
  } else {
    status.textContent = "Offline";
  }

  $("account-badge").textContent = settings.accountTarget.toUpperCase();
  $("balance").textContent = state.balance === null ? "--" : `${state.balance.toFixed(2)} ${state.currency}`;
  $("tick-display").textContent = state.lastQuote;
  $("digit-display").textContent = `Digit ${state.lastDigit ?? "--"}`;
  $("odd-streak").textContent = state.oddStreak;
  if ($("digit-streak")) $("digit-streak").textContent = state.digitStreak;
  $("loss-count").textContent = state.lossCount;
  $("cum-loss").textContent = state.cumulativeLoss.toFixed(2);
  $("next-stake").textContent = state.currentStake.toFixed(2);
  $("bot-state").textContent = state.running ? (state.activeTrade ? "Trading" : "Running") : $("bot-state").textContent || "Waiting";

  updateAnalyzer(settings);
  renderWatchlist();
  renderStreakTracker(settings);
  renderRecoveryLadder();
  renderStats();
  if ($("digit-heatmap")) renderDigitHeatmap();
  if ($("digit-strip")) renderDigitAnalysis();
  renderAiMarketGrid(settings);
  renderScannerInsight(settings);
  renderDifferAnalysis(settings);
  renderScanner();
  renderSetupQueue();
  renderSimulator();
  renderRiskMeter();
  renderFloatingPerformance();
  renderBestMarket();
  renderTradeReplay();
  renderContractCursor();
  renderSessionGoal();
  drawCharts();
}

function updateAnalyzer(settings) {
  const preferred = settings.preferredOdds;
  const stat = state.marketStats.get(state.symbol) || {
    oddStreak: state.oddStreak,
    digitStreak: state.digitStreak,
    repeatDigit: state.repeatDigit,
    recentDigits: state.digitHistory.slice(-settings.ouSample),
    digit: state.lastDigit,
  };
  const ai = computeMarketAi(stat, settings);
  const score = ai.score;
  $("signal-score").textContent = `${score}%`;
  if ($("ring-fill")) {
    const circumference = 326.7;
    $("ring-fill").style.strokeDashoffset = String(circumference - (score / 100) * circumference);
  }

  if ($("signal-type-tag")) $("signal-type-tag").textContent = ai.signalType;
  if ($("signal-market-tag")) $("signal-market-tag").textContent = state.symbol;

  const ready = checkEntryReady(settings);
  if ($("entry-ready")) {
    $("entry-ready").textContent = ready ? "ENTRY READY" : "WAITING";
    $("entry-ready").classList.toggle("ready", ready);
  }

  if (settings.contractMode === "odds_even") {
    if (state.oddStreak >= preferred) {
      $("signal-title").textContent = "Strong odds signal";
      $("signal-copy").textContent = `${state.oddStreak} straight Odds detected. ${contractLabel(settings)} trade is ready when Run Bot is active.`;
    } else if (state.oddStreak >= Math.max(preferred - 1, 1)) {
      $("signal-title").textContent = "Signal building";
      $("signal-copy").textContent = `${state.oddStreak}/${preferred} Odds. One more Odd can complete your setup.`;
    } else {
      $("signal-title").textContent = "Scanning odds pressure";
      $("signal-copy").textContent = `Waiting for a clean ${preferred} Odds streak before ${contractLabel(settings)} entry.`;
    }
  } else if (settings.contractMode === "differ") {
    if (state.digitStreak >= settings.differTrigger) {
      $("signal-title").textContent = "Differ trigger locked";
      $("signal-copy").textContent = `Digit ${state.repeatDigit} repeated ${state.digitStreak}x. Differ recovery trade is ready.`;
    } else {
      $("signal-title").textContent = "Tracking digit repeats";
      $("signal-copy").textContent = `${state.digitStreak}/${settings.differTrigger} repeats on digit ${state.repeatDigit ?? "--"}.`;
    }
  } else {
    const sample = state.digitHistory.slice(-settings.ouSample);
    const under = sample.filter((d) => d < settings.barrier).length;
    const over = sample.filter((d) => d > settings.barrier).length;
    const total = sample.length || 1;
    const underPct = Math.round((under / total) * 100);
    const overPct = Math.round((over / total) * 100);
    if ($("ou-under-bar")) $("ou-under-bar").style.width = `${underPct}%`;
    if ($("ou-over-bar")) $("ou-over-bar").style.width = `${overPct}%`;
    if ($("ou-under-pct")) $("ou-under-pct").textContent = `${underPct}%`;
    if ($("ou-over-pct")) $("ou-over-pct").textContent = `${overPct}%`;
    if ($("ou-analysis-copy")) {
      $("ou-analysis-copy").textContent = `Barrier ${settings.barrier}: under ${underPct}% | over ${overPct}%. Target ${contractLabel(settings)}.`;
    }
    if ($("ou-recommendation")) {
      const rec = suggestOverUnder(settings, sample);
      $("ou-recommendation").textContent = rec;
    }
    $("signal-title").textContent = ready ? "Barrier bias confirmed" : "Over/Under analysis";
    $("signal-copy").textContent = ai.signal + (ready ? " — entry quality is high." : " — waiting for stronger bias.");
  }

  const ranked = getRankedMarkets(settings);
  const rankIndex = ranked.findIndex((item) => item.symbol === state.symbol);
  if ($("market-rank")) $("market-rank").textContent = rankIndex >= 0 ? `#${rankIndex + 1}` : "--";
}

function suggestOverUnder(settings, sample = state.digitHistory.slice(-settings.ouSample)) {
  if (sample.length < 10) return "Collecting tick sample for AI barrier analysis…";
  let best = { barrier: 5, side: "OVER", pct: 0 };
  for (let barrier = 0; barrier <= 9; barrier += 1) {
    const under = sample.filter((d) => d < barrier).length;
    const over = sample.filter((d) => d > barrier).length;
    const underPct = (under / sample.length) * 100;
    const overPct = (over / sample.length) * 100;
    if (underPct > best.pct) best = { barrier, side: "OVER", pct: underPct };
    if (overPct > best.pct) best = { barrier, side: "UNDER", pct: overPct };
  }
  const contract = best.side === "OVER" ? `OVER ${best.barrier}` : `UNDER ${best.barrier}`;
  return `AI recommends ${contract} at ${Math.round(best.pct)}% bias (${sample.length} ticks).`;
}

function pickAutoBarrier() {
  const settings = getSettings();
  const sample = state.digitHistory.slice(-settings.ouSample);
  if (sample.length < 10) {
    toast("Need more ticks before AI can pick a barrier.", "warn");
    return;
  }
  let best = { barrier: 5, side: "DIGITOVER", pct: 0 };
  for (let barrier = 0; barrier <= 9; barrier += 1) {
    const under = sample.filter((d) => d < barrier).length;
    const over = sample.filter((d) => d > barrier).length;
    const underPct = (under / sample.length) * 100;
    const overPct = (over / sample.length) * 100;
    if (underPct > best.pct) best = { barrier, side: "DIGITOVER", pct: underPct };
    if (overPct > best.pct) best = { barrier, side: "DIGITUNDER", pct: overPct };
  }
  $("ou-barrier").value = String(best.barrier);
  $("ou-direction").value = best.side;
  toast(`AI picked ${best.side === "DIGITOVER" ? "OVER" : "UNDER"} ${best.barrier} (${Math.round(best.pct)}% bias).`, "good");
  updateDashboard();
}

function renderScannerInsight(settings) {
  const el = $("scanner-insight");
  if (!el) return;
  const ranked = getRankedMarkets(settings);
  const ready = ranked.filter((item) => item.ai.ready);
  const best = ranked[0];
  if (!best || !best.watch) {
    el.textContent = "Connecting to Deriv volatility tick stream… Scanner loads Vol 10–100 automatically.";
    return;
  }
  if (ready.length) {
    el.textContent = `${ready.length} market${ready.length > 1 ? "s" : ""} at ENTRY READY — top pick ${ready[0].name}: ${ready[0].ai.signal}. Tap a card or Use best market.`;
    return;
  }
  el.textContent = `Best setup: ${best.name} at ${best.ai.score}% — ${best.ai.signal}. ${contractModeLabel(settings.contractMode)} mode active.`;
}

function renderDifferAnalysis(settings) {
  if (!$("differ-analysis")) return;
  const trigger = settings.differTrigger;
  const ready = state.digitStreak >= trigger;
  if ($("differ-display-digit")) $("differ-display-digit").textContent = state.repeatDigit ?? "--";
  if ($("differ-display-count")) $("differ-display-count").textContent = `${state.digitStreak}/${trigger}`;
  if ($("differ-recovery-step")) $("differ-recovery-step").textContent = String(state.lossCount);
  const pill = $("differ-status-pill");
  if (pill) {
    pill.textContent = ready ? "TRIGGER READY" : state.digitStreak >= trigger - 1 ? "Almost" : "Watching";
    pill.classList.toggle("ready", ready);
  }
  const visual = $("differ-repeat-visual");
  if (visual) {
    visual.innerHTML = "";
    for (let i = 0; i < state.digitStreak; i += 1) {
      const chip = document.createElement("i");
      chip.textContent = state.repeatDigit ?? "?";
      if (i === state.digitStreak - 1 && ready) chip.classList.add("trigger");
      visual.appendChild(chip);
    }
  }
  if ($("differ-analysis-copy")) {
    $("differ-analysis-copy").textContent = ready
      ? `Digit ${state.repeatDigit} hit ${trigger}x — Differ entry armed. Recovery step ${state.lossCount} uses ladder stake ${state.currentStake.toFixed(2)}.`
      : `When digit ${state.repeatDigit ?? "--"} hits ${trigger} times, bot trades DIFFER with recovery from step ${settings.recoveryStartLosses}.`;
  }
}

function renderAiMarketGrid(settings) {
  const holder = $("ai-market-grid");
  if (!holder) return;
  holder.innerHTML = "";
  const ranked = getRankedMarkets(settings);
  ranked.forEach((item, index) => {
    const card = document.createElement("article");
    card.className = `ai-market-card ${item.symbol === state.symbol ? "active-market" : ""} ${item.ai.ready ? "ready" : ""}`;
    card.innerHTML = `
      <span class="rank">#${index + 1}</span>
      <strong>${item.name}</strong>
      <div class="quote">${item.watch?.display || "--"}</div>
      <div class="meta">
        <span>Digit ${item.stat.digit ?? "--"}</span>
        <span>${item.ai.signal}</span>
        <span>Score ${item.ai.score}%</span>
      </div>
      <div class="score-bar"><i style="width:${item.ai.score}%"></i></div>
      <span class="signal-pill">${item.ai.ready ? "ENTRY READY" : item.ai.entryLabel}</span>
    `;
    card.addEventListener("click", () => {
      $("symbol").value = item.symbol;
      applyConnectionSettings();
      toast(`Focused ${item.name}.`, "good");
    });
    holder.appendChild(card);
  });
}

function renderBestMarket() {
  const settings = getSettings();
  const best = getRankedMarkets(settings)[0];
  if (!best) return;
  $("best-market-title").textContent = `${best.name} ${best.ai.ready ? "READY" : best.ai.score + "%"}`;
  $("best-market-copy").textContent = `${best.ai.signal} | AI score ${best.ai.score}% on ${best.symbol}.`;
}

function renderTradeReplay() {
  const holder = $("trade-replay");
  holder.innerHTML = "";
  const replay = state.lastReplay.length ? state.lastReplay : state.replayDigits;
  replay.slice(-12).forEach((item) => {
    const chip = document.createElement("i");
    chip.textContent = item;
    holder.appendChild(chip);
  });
  $("replay-title").textContent = state.lastReplay.length ? "Last cycle" : "Current setup";
}

function renderContractCursor() {
  const holder = $("digit-cursor-track");
  if (!holder) return;
  holder.innerHTML = "";
  const activeDigit = state.activeTrade
    ? state.tradeCursorDigit
    : state.tradeEndDigit ?? state.lastDigit;
  for (let digit = 0; digit <= 9; digit += 1) {
    const item = document.createElement("i");
    item.textContent = digit;
    item.className = [
      digit % 2 === 1 ? "odd" : "even",
      activeDigit === digit ? "active" : "",
      state.tradeEndDigit === digit ? "ended" : "",
    ].filter(Boolean).join(" ");
    if (state.activeTrade && activeDigit === digit) {
      item.setAttribute("data-badge", "1/1");
    } else if (!state.activeTrade && state.tradeEndDigit === digit) {
      item.setAttribute("data-badge", state.tradeEndDigit % 2 === 0 ? "EVEN" : "ODD");
    }
    holder.appendChild(item);
  }
  $("contract-cursor-copy").textContent = state.activeTrade
    ? `Buying contract... moving digit ${state.tradeCursorDigit ?? "--"}`
    : state.tradeEndDigit === null
      ? "Waiting for contract entry"
      : `Contract ended on digit ${state.tradeEndDigit}`;
  $("contract-end-digit").textContent = state.tradeEndDigit === null ? "End digit --" : `End digit ${state.tradeEndDigit}`;
}

function startContractCursor() {
  stopContractCursor();
  state.tradeCursorDigit = Number.isInteger(state.tradeEntryDigit) ? state.tradeEntryDigit : 0;
  renderContractCursor();
  state.tradeCursorTimer = setInterval(() => {
    if (!state.activeTrade) {
      stopContractCursor();
      return;
    }
    state.tradeCursorDigit = ((Number(state.tradeCursorDigit) || 0) + 1) % 10;
    renderContractCursor();
  }, 120);
}

function stopContractCursor() {
  if (state.tradeCursorTimer) {
    clearInterval(state.tradeCursorTimer);
    state.tradeCursorTimer = null;
  }
  renderContractCursor();
}

function renderSessionGoal() {
  const settings = getSettings();
  $("session-copy").textContent = `Today ${state.dailyProfit.toFixed(2)} ${state.currency}. Target ${settings.sessionTargetProfit.toFixed(2)}, max loss ${settings.sessionMaxLoss.toFixed(2)}.`;
  $("real-lock-title").textContent = getSettings().accountTarget === "real" ? "Real guarded" : "Demo mode";
  if (getSettings().accountTarget !== "real") $("real-countdown").textContent = "--";
}

function renderWatchlist() {
  const list = $("watchlist");
  list.innerHTML = "";
  WATCHLIST.forEach(([symbol, name]) => {
    const row = document.createElement("div");
    const item = state.watch.get(symbol);
    row.className = `market-row ${item?.direction === "down" ? "down" : ""}`;
    row.innerHTML = `<div><strong>${name}</strong><span>${symbol}</span></div><b>${item?.display || "--"}</b>`;
    list.appendChild(row);
  });
}

function renderStreakTracker(settings) {
  const preferred = settings.preferredOdds;
  const holder = $("streak-digits");
  holder.innerHTML = "";

  if (settings.contractMode === "differ") {
    for (let i = 0; i < state.digitStreak; i += 1) {
      const item = document.createElement("i");
      item.textContent = state.repeatDigit ?? "?";
      holder.appendChild(item);
    }
    $("streak-progress").textContent = `${state.digitStreak}/${settings.differTrigger} repeats`;
    return;
  }

  if (settings.contractMode === "over_under") {
    const sample = state.digitHistory.slice(-settings.ouSample);
    sample.forEach((digit) => {
      const item = document.createElement("i");
      item.textContent = digit;
      if (digit < settings.barrier) item.style.borderColor = "rgba(59,130,246,0.5)";
      if (digit > settings.barrier) item.style.borderColor = "rgba(34,197,94,0.5)";
      holder.appendChild(item);
    });
    $("streak-progress").textContent = `Barrier ${settings.barrier} sample`;
    return;
  }

  const digits = state.recentOdds.slice(-preferred);
  digits.forEach((digit) => {
    const item = document.createElement("i");
    item.textContent = digit;
    holder.appendChild(item);
  });
  $("streak-progress").textContent = `${Math.min(state.oddStreak, preferred)}/${preferred} Odds Found`;
}

function renderRecoveryLadder() {
  const settings = getSettings();
  const ladder = getRecoveryLadder();
  const holder = $("recovery-ladder");
  holder.innerHTML = "";
  ladder.forEach((stake, index) => {
    const item = document.createElement("div");
    item.className = `ladder-item ${index === Math.min(state.lossCount, ladder.length - 1) ? "current" : ""}`;
    item.innerHTML = `<span>${index + 1}</span><b>${stake.toFixed(2)}</b><small>${index < settings.recoveryStartLosses ? "Base" : "Recovery"}</small>`;
    holder.appendChild(item);
  });
  $("ladder-summary").textContent = `${settings.maxRecoverySteps} steps | buffer ${settings.profitBuffer.toFixed(2)}`;
  $("ladder-current").textContent = state.currentStake.toFixed(2);
  $("ladder-next").textContent = calculateNextStake().toFixed(2);
  $("ladder-losses").textContent = state.cumulativeLoss.toFixed(2);
}

function renderStats() {
  const winRate = state.totalTrades ? (state.wins / state.totalTrades) * 100 : 0;
  const avgRecovery = state.recoveryHistory.length
    ? state.recoveryHistory.reduce((sum, value) => sum + value, 0) / state.recoveryHistory.length
    : 0;
  $("stat-total-trades").textContent = state.totalTrades;
  $("stat-wins").textContent = state.wins;
  $("stat-losses").textContent = state.losses;
  $("stat-win-rate").textContent = `${winRate.toFixed(1)}%`;
  $("stat-net-profit").textContent = state.totalProfit.toFixed(2);
  $("stat-longest-recovery").textContent = state.longestRecovery;
  $("stat-average-recovery").textContent = avgRecovery.toFixed(1);
  $("stat-cycles").textContent = state.cyclesCompleted;
}

function renderAiRecommendation(digits) {
  const last20 = digits.slice(-20);
  const evenPct = (last20.filter((d) => d % 2 === 0).length / last20.length) * 100;
  const underPct = (last20.filter((d) => d <= 4).length / last20.length) * 100;

  let eoStreak = 1;
  const lastParity = digits[digits.length - 1] % 2;
  for (let i = digits.length - 2; i >= 0; i--) {
    if (digits[i] % 2 === lastParity) eoStreak++;
    else break;
  }

  const eoSkew = Math.abs(evenPct - 50);
  const ouSkew = Math.abs(underPct - 50);
  const streakBoost = Math.min(eoStreak * 6, 30);
  const score = Math.min(96, Math.round(eoSkew * 1.2 + ouSkew * 0.6 + streakBoost));

  let recommend = "WAITING";
  let reason = "No strong pattern yet — keep scanning.";
  if (score >= 55) {
    if (eoStreak >= 4) {
      recommend = lastParity === 1 ? "EVEN (streak break)" : "ODD (streak break)";
      reason = `${eoStreak} consecutive ${lastParity === 1 ? "odd" : "even"} digits — reversal likely.`;
    } else if (eoSkew >= ouSkew) {
      recommend = evenPct > 50 ? "EVEN" : "ODD";
      reason = `${evenPct > 50 ? evenPct.toFixed(0) : (100 - evenPct).toFixed(0)}% bias over last 20 ticks.`;
    } else {
      recommend = underPct > 50 ? "UNDER (0-4)" : "OVER (5-9)";
      reason = `${underPct > 50 ? underPct.toFixed(0) : (100 - underPct).toFixed(0)}% bias over last 20 ticks.`;
    }
  }

  $("da-ai-score").textContent = `${score}%`;
  $("da-ai-recommend").textContent = `Recommend: ${recommend}`;
  $("da-ai-reason").textContent = reason;
  $("da-ai-confidence-tag").textContent = score >= 70 ? "HIGH" : score >= 45 ? "MEDIUM" : "BETA";

  const ring = $("da-ai-ring");
  const circumference = 2 * Math.PI * 34;
  ring.style.strokeDasharray = `${circumference}`;
  ring.style.strokeDashoffset = `${circumference - (score / 100) * circumference}`;

  const card = $("da-ai-card");
  card.classList.toggle("ready", score >= 55);
}

function renderDigitAnalysis() {
  const digits = state.digitHistory.slice(-100);
  if (!digits.length) return;

  renderAiRecommendation(digits);

  // recent digit strip (last 30, newest on the right)
  const strip = $("digit-strip");
  strip.innerHTML = "";
  digits.slice(-30).forEach((d) => {
    const cell = document.createElement("span");
    cell.className = `da-digit ${d % 2 === 1 ? "odd" : "even"} ${d >= 5 ? "high" : "low"}`;
    cell.textContent = d;
    strip.appendChild(cell);
  });

  // even/odd streak
  let eoStreak = 1;
  const lastParity = digits[digits.length - 1] % 2;
  for (let i = digits.length - 2; i >= 0; i--) {
    if (digits[i] % 2 === lastParity) eoStreak++;
    else break;
  }
  $("da-eo-streak").textContent = `${eoStreak}x ${lastParity === 1 ? "Odd" : "Even"}`;

  // high/low streak
  let hlStreak = 1;
  const lastHL = digits[digits.length - 1] >= 5 ? "high" : "low";
  for (let i = digits.length - 2; i >= 0; i--) {
    const hl = digits[i] >= 5 ? "high" : "low";
    if (hl === lastHL) hlStreak++;
    else break;
  }
  $("da-hl-streak").textContent = `${hlStreak}x ${lastHL === "high" ? "High" : "Low"}`;

  // even/odd prediction
  const evenCount = digits.filter((d) => d % 2 === 0).length;
  const oddCount = digits.length - evenCount;
  const evenPct = Math.round((evenCount / digits.length) * 100);
  const oddPct = 100 - evenPct;
  $("da-even-bar").style.width = `${evenPct}%`;
  $("da-odd-bar").style.width = `${oddPct}%`;
  $("da-even-pct").textContent = `${evenPct}%`;
  $("da-odd-pct").textContent = `${oddPct}%`;
  const eoSkew = Math.abs(evenPct - 50);
  $("da-eo-confidence").textContent = `Confidence: ${eoSkew >= 15 ? "High" : eoSkew >= 7 ? "Medium" : "Low"}`;

  // over/under prediction
  const underCount = digits.filter((d) => d <= 4).length;
  const overCount = digits.length - underCount;
  const underPct = Math.round((underCount / digits.length) * 100);
  const overPct = 100 - underPct;
  $("da-under-bar").style.width = `${underPct}%`;
  $("da-over-bar").style.width = `${overPct}%`;
  $("da-under-pct").textContent = `${underPct}%`;
  $("da-over-pct").textContent = `${overPct}%`;
  const ouSkew = Math.abs(underPct - 50);
  $("da-ou-confidence").textContent = `Confidence: ${ouSkew >= 15 ? "High" : ouSkew >= 7 ? "Medium" : "Low"}`;

  // trend
  const last10 = digits.slice(-10);
  const avg = last10.reduce((a, b) => a + b, 0) / last10.length;
  const counts = {};
  digits.forEach((d) => (counts[d] = (counts[d] || 0) + 1));
  const mode = Object.keys(counts).reduce((a, b) => (counts[a] > counts[b] ? a : b));
  $("da-last-digit").textContent = digits[digits.length - 1];
  $("da-avg-digit").textContent = avg.toFixed(1);
  $("da-mode-digit").textContent = mode;
  const firstHalfAvg = last10.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  const secondHalfAvg = last10.slice(5).reduce((a, b) => a + b, 0) / 5;
  const diff = secondHalfAvg - firstHalfAvg;
  $("da-trend-copy").textContent =
    diff > 0.8 ? "Rising trend - digits trending higher" : diff < -0.8 ? "Falling trend - digits trending lower" : "Flat trend - no clear direction";

  renderDigitPatternHeatmap(digits);
}

function renderDigitPatternHeatmap(digits) {
  const holder = $("digit-pattern-heatmap");
  if (!holder) return;
  const pairCounts = {};
  for (let i = 0; i < digits.length - 1; i++) {
    const key = `${digits[i]}${digits[i + 1]}`;
    pairCounts[key] = (pairCounts[key] || 0) + 1;
  }
  const max = Math.max(...Object.values(pairCounts), 1);
  holder.innerHTML = "";
  for (let row = 0; row <= 9; row++) {
    for (let col = 0; col <= 9; col++) {
      const key = `${row}${col}`;
      const count = pairCounts[key] || 0;
      const intensity = count / max;
      const cell = document.createElement("div");
      cell.className = "pattern-cell";
      cell.style.background = count ? `rgba(34, 211, 238, ${0.15 + intensity * 0.7})` : "rgba(255,255,255,0.03)";
      cell.title = `${key}: ${count}x`;
      cell.textContent = count > 0 ? count : "";
      holder.appendChild(cell);
    }
  }
}


function renderDigitHeatmap() {
  const holder = $("digit-heatmap");
  holder.innerHTML = "";
  const max = Math.max(...state.digitCounts, 1);
  state.digitCounts.forEach((count, digit) => {
    const cell = document.createElement("div");
    cell.className = `digit-cell ${digit % 2 === 1 ? "odd" : ""}`;
    const height = Math.max(4, Math.round((count / max) * 48));
    cell.innerHTML = `<i style="height:${height}px"></i><b>${digit}</b><span>${count}</span>`;
    holder.appendChild(cell);
  });
}

function renderScanner() {
  const settings = getSettings();
  const holder = $("scanner-list");
  holder.innerHTML = "";
  getRankedMarkets(settings).forEach((item, index) => {
    const row = document.createElement("div");
    row.className = `scanner-row ${item.ai.ready ? "ready" : ""}`;
    row.innerHTML = `<div><strong>#${index + 1} ${item.name}</strong><span>${item.ai.signal} | Score ${item.ai.score}%</span></div><b>${item.ai.ready ? "READY" : item.ai.entryLabel}</b>`;
    holder.appendChild(row);
  });
}

function renderSetupQueue() {
  const settings = getSettings();
  const holder = $("setup-queue");
  holder.innerHTML = "";
  getRankedMarkets(settings)
    .slice(0, 5)
    .forEach((item) => {
      const row = document.createElement("div");
      row.className = `queue-row ${item.ai.ready ? "ready" : ""}`;
      row.innerHTML = `<div><strong>${item.name}</strong><span>${item.symbol} | ${item.ai.signal}</span></div><b>${item.ai.ready ? "ENTRY" : item.ai.score + "%"}</b>`;
      holder.appendChild(row);
    });
}

function renderSimulator() {
  const ladder = getRecoveryLadder();
  const exposure = ladder.reduce((sum, stake) => sum + stake, 0);
  $("sim-max-exposure").textContent = exposure.toFixed(2);
  $("sim-recommended-balance").textContent = (exposure * 3).toFixed(2);
  const holder = $("sim-ladder");
  holder.innerHTML = "";
  ladder.slice(0, 8).forEach((stake, index) => {
    const item = document.createElement("div");
    item.className = "sim-item";
    item.innerHTML = `<span>Step ${index + 1}</span><b>${stake.toFixed(2)}</b>`;
    holder.appendChild(item);
  });
}

function renderRiskMeter() {
  const settings = getSettings();
  const ladder = getRecoveryLadder();
  const exposure = ladder.reduce((sum, stake) => sum + stake, 0);
  const balanceBase = state.balance || Math.max(exposure * 3, 1);
  const exposureScore = Math.min(100, Math.round((exposure / balanceBase) * 100));
  const depthScore = Math.min(100, Math.round((state.lossCount / Math.max(settings.maxRecoverySteps, 1)) * 100));
  const score = Math.max(exposureScore, depthScore);
  const label = score >= 70 ? "HIGH" : score >= 35 ? "MEDIUM" : "LOW";
  $("risk-label").textContent = label;
  $("risk-score").textContent = `${score}%`;
  $("risk-bar").style.width = `${score}%`;
  $("risk-bar").style.background = label === "HIGH" ? "var(--danger)" : label === "MEDIUM" ? "var(--warn)" : "var(--good)";
  $("risk-copy").textContent = `Exposure ${exposure.toFixed(2)} ${state.currency}; max stake ${settings.maxStake.toFixed(2)}.`;
}

function renderFloatingPerformance() {
  const winRate = state.totalTrades ? (state.wins / state.totalTrades) * 100 : 0;
  $("float-profit").textContent = state.dailyProfit.toFixed(2);
  $("float-profit").style.color = state.dailyProfit >= 0 ? "var(--good)" : "var(--danger)";
  $("float-win-rate").textContent = `${winRate.toFixed(1)}%`;
  $("float-cycles").textContent = state.cyclesCompleted;
}

function drawCharts() {
  if ($("tick-chart")) drawLineChart($("tick-chart"), state.tickHistory);
  if ($("digit-chart")) drawBarChart($("digit-chart"), state.digitCounts);
  if ($("profit-chart")) drawLineChart($("profit-chart"), state.profitHistory, true);
}

function prepCanvas(canvas) {
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.max(320, Math.floor(rect.width * scale));
  canvas.height = Math.max(180, Math.floor(rect.height * scale));
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const width = canvas.width / scale;
  const height = canvas.height / scale;
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height };
}

function drawGrid(ctx, width, height) {
  ctx.strokeStyle = "#1b2738";
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i += 1) {
    const y = (height / 4) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
}

function drawLineChart(canvas, values, profitMode = false) {
  const { ctx, width, height } = prepCanvas(canvas);
  drawGrid(ctx, width, height);
  if (values.length < 2) return;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values.map((value, index) => ({
    x: (index / (values.length - 1)) * width,
    y: height - ((value - min) / range) * (height - 18) - 9,
  }));

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, profitMode ? "rgba(34,197,94,0.36)" : "rgba(35,131,255,0.34)");
  gradient.addColorStop(1, "rgba(35,131,255,0)");

  ctx.beginPath();
  ctx.moveTo(points[0].x, height);
  points.forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.lineTo(points[points.length - 1].x, height);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.strokeStyle = profitMode ? "#22c55e" : "#2383ff";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawBarChart(canvas, values) {
  const { ctx, width, height } = prepCanvas(canvas);
  drawGrid(ctx, width, height);
  const max = Math.max(...values, 1);
  const gap = 5;
  const barWidth = (width - gap * 11) / 10;

  values.forEach((value, digit) => {
    const h = (value / max) * (height - 32);
    const x = gap + digit * (barWidth + gap);
    const y = height - h - 20;
    ctx.fillStyle = digit % 2 === 0 ? "#2383ff" : "#22d3ee";
    ctx.fillRect(x, y, barWidth, h);
    ctx.fillStyle = "#7f8da3";
    ctx.font = "11px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(String(digit), x + barWidth / 2, height - 5);
  });
}

function applyPreset() {
  const preset = $("strategy-preset").value;
  const presets = {
    verysafe: { trigger: 8, stake: 0.35, buffer: 0.35, start: 2, maxRecovery: 3, maxStake: 10 },
    normal: { trigger: 5, stake: 0.35, buffer: 0.35, start: 4, maxRecovery: 7, maxStake: 100 },
    fast: { trigger: 3, stake: 0.35, buffer: 0.35, start: 1, maxRecovery: 6, maxStake: 80 },
    immediate: { trigger: 3, stake: 0.35, buffer: 0.35, start: 1, maxRecovery: 9, maxStake: 250 },
    conservative: { trigger: 7, stake: 0.35, buffer: 0.35, start: 2, maxRecovery: 4, maxStake: 25 },
    balanced: { trigger: 5, stake: 0.35, buffer: 0.35, start: 4, maxRecovery: 7, maxStake: 100 },
    aggressive: { trigger: 3, stake: 0.5, buffer: 0.5, start: 0, maxRecovery: 9, maxStake: 250 },
    recovery3: { trigger: 5, stake: 0.35, buffer: 0.35, start: 3, maxRecovery: 7, maxStake: 100 },
    recovery5: { trigger: 5, stake: 0.35, buffer: 0.35, start: 5, maxRecovery: 8, maxStake: 150 },
  };
  const config = presets[preset];
  if (!config) return;
  $("preferred-odds").value = String(config.trigger);
  $("trigger-count").value = String(config.trigger);
  $("stake").value = config.stake;
  $("profit-buffer").value = config.buffer;
  $("strategy-profit-buffer").value = config.buffer;
  $("recovery-start-losses").value = config.start;
  $("strategy-recovery-start").value = config.start;
  $("max-recovery-steps").value = config.maxRecovery;
  $("strategy-max-recovery").value = config.maxRecovery;
  $("max-stake").value = config.maxStake;
  if (!state.running) state.currentStake = config.stake;
  updateDashboard();
}

function syncStrategyBuilder(source) {
  if (source === "builder") {
    $("preferred-odds").value = $("trigger-count").value;
    $("recovery-start-losses").value = $("strategy-recovery-start").value;
    $("max-recovery-steps").value = $("strategy-max-recovery").value;
    $("profit-buffer").value = $("strategy-profit-buffer").value;
    if ($("strategy-contract-mode")) setContractMode($("strategy-contract-mode").value);
  } else {
    $("trigger-count").value = $("preferred-odds").value;
    $("strategy-recovery-start").value = $("recovery-start-losses").value;
    $("strategy-max-recovery").value = $("max-recovery-steps").value;
    $("strategy-profit-buffer").value = $("profit-buffer").value;
    if ($("strategy-contract-mode")) $("strategy-contract-mode").value = $("contract-mode").value;
  }
  $("strategy-preset").value = "custom";
  updateDashboard();
}

function runBacktest() {
  const settings = getSettings();
  const ticks = state.digitHistory.length >= 50 ? state.digitHistory.slice() : generateBacktestDigits(250);
  let streak = 0;
  let digitStreak = 0;
  let repeatDigit = null;
  let active = false;
  let cumulativeLoss = 0;
  let lossCount = 0;
  let triggers = 0;
  let wins = 0;
  let losses = 0;
  let net = 0;
  let peak = 0;
  let maxDrawdown = 0;
  const recent = [];

  ticks.forEach((digit) => {
    recent.push(digit);
    if (recent.length > 30) recent.shift();

    if (!active) {
      if (settings.contractMode === "odds_even") {
        streak = digit % 2 === 1 ? streak + 1 : 0;
        if (streak >= settings.preferredOdds) {
          active = true;
          triggers += 1;
        }
      } else if (settings.contractMode === "differ") {
        digitStreak = digit === repeatDigit ? digitStreak + 1 : 1;
        repeatDigit = digit;
        if (digitStreak >= settings.differTrigger) {
          active = true;
          triggers += 1;
        }
      } else {
        const sample = recent.slice(-settings.ouSample);
        if (sample.length >= settings.ouSample) {
          const under = sample.filter((d) => d < settings.barrier).length;
          const over = sample.filter((d) => d > settings.barrier).length;
          const underPct = (under / sample.length) * 100;
          const overPct = (over / sample.length) * 100;
          const ready = settings.ouDirection === "DIGITOVER"
            ? underPct >= settings.ouMinBias
            : overPct >= settings.ouMinBias;
          if (ready) {
            active = true;
            triggers += 1;
          }
        }
      }
      return;
    }

    const stake = lossCount < settings.recoveryStartLosses
      ? settings.stake
      : Math.min((cumulativeLoss + settings.profitBuffer) / payoutRatio(), settings.maxStake);
    const simSettings = { ...settings };
    if (settings.contractMode === "differ") {
      state.repeatDigit = repeatDigit;
    }
    const won = simulateContractWin(digit, simSettings);
    const profit = won ? stake * payoutRatio() : -stake;
    net += profit;
    peak = Math.max(peak, net);
    maxDrawdown = Math.max(maxDrawdown, peak - net);

    if (won) {
      wins += 1;
      active = false;
      cumulativeLoss = 0;
      lossCount = 0;
      streak = 0;
      digitStreak = 0;
    } else {
      losses += 1;
      cumulativeLoss += stake;
      lossCount += 1;
      if (lossCount >= settings.maxRecoverySteps) {
        active = false;
        cumulativeLoss = 0;
        lossCount = 0;
        streak = 0;
        digitStreak = 0;
      }
    }
  });

  const total = wins + losses;
  $("backtest-results").innerHTML = `
    <span>Triggers ${triggers}</span>
    <span>Wins ${wins}</span>
    <span>Losses ${losses}</span>
    <span>Win Rate ${total ? ((wins / total) * 100).toFixed(1) : "0.0"}%</span>
    <span>Net Profit ${net.toFixed(2)}</span>
    <span>Max Drawdown ${maxDrawdown.toFixed(2)}</span>
  `;
  journal(`Backtest complete: ${triggers} triggers, net ${net.toFixed(2)} ${state.currency}.`, "trade");
}

function generateBacktestDigits(count) {
  return Array.from({ length: count }, () => Math.floor(Math.random() * 10));
}

function toggleCompactMode() {
  document.body.classList.toggle("compact-mode");
  $("compact-toggle").textContent = document.body.classList.contains("compact-mode") ? "Comfort" : "Compact";
}

function toggleMiniMode() {
  document.body.classList.toggle("mini-mode");
  $("mini-toggle").textContent = document.body.classList.contains("mini-mode") ? "Full" : "Mini";
}

function toggleSound() {
  state.soundEnabled = !state.soundEnabled;
  $("sound-toggle").textContent = state.soundEnabled ? "Sound On" : "Sound Off";
  if (state.soundEnabled) playTone("info");
}

function toggleAiAuto() {
  state.aiAutoEnabled = !state.aiAutoEnabled;
  localStorage.setItem("trade7smart_ai_auto", state.aiAutoEnabled ? "1" : "0");
  $("ai-auto-toggle").textContent = state.aiAutoEnabled ? "AI On" : "AI Auto";
  toast(state.aiAutoEnabled ? "AI Auto market trading enabled." : "AI Auto disabled.", state.aiAutoEnabled ? "good" : "");
  if (state.aiAutoEnabled) aiRunBot();
}

function aiRunBot() {
  state.aiAutoEnabled = true;
  localStorage.setItem("trade7smart_ai_auto", "1");
  $("ai-auto-toggle").textContent = "AI On";
  toast("AI Run scanning. Ready markets will enter immediately.", "good");
  startBot();
  setTimeout(forceBestAiEntry, 60);
}

function forceBestAiEntry() {
  const settings = getSettings();
  if (!state.authorized || !state.running || state.activeTrade || state.lossCount > 0) return;
  const ready = getRankedMarkets(settings).find((item) => item.ai.ready);
  if (ready) {
    maybeTradeAiMarket(ready.symbol);
    return;
  }
  const best = getRankedMarkets(settings)[0];
  if (best) {
    $("symbol").value = best.symbol;
    state.symbol = best.symbol;
    $("bot-state").textContent = "AI scanning";
    journal(`AI Run scanning ${best.name}: ${best.ai.signal}.`, "trade");
  }
}

function startLiveClock() {
  const tick = () => {
    const el = $("live-clock");
    if (el) el.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };
  tick();
  setInterval(tick, 1000);
}

function initSectionNav() {
  document.querySelectorAll(".nav-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      document.querySelectorAll(".nav-pill").forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      const target = document.getElementById(pill.dataset.scroll);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function hideLoader() {
  document.body.classList.add("loaded");
}

function useBestMarket() {
  const best = getRankedMarkets(getSettings())[0];
  if (!best) return;
  $("symbol").value = best.symbol;
  applyConnectionSettings();
  toast(`Selected ${best.name}.`, "good");
}

function loadSavedSettings() {
  const savedToken = localStorage.getItem("trade7smart_token");
  if (savedToken) {
    $("api-token").value = savedToken;
    $("save-token").checked = true;
  }
  const savedAccount = localStorage.getItem("trade7smart_account_target");
  if (savedAccount) $("account-target").value = savedAccount;
  const savedAppId = localStorage.getItem("trade7smart_app_id");
  if (savedAppId) $("app-id").value = savedAppId;
  const savedSymbol = localStorage.getItem("trade7smart_symbol");
  if (savedSymbol) $("symbol").value = savedSymbol;
  state.notificationsEnabled = localStorage.getItem("trade7smart_notifications") === "1" && "Notification" in window && Notification.permission === "granted";
  $("notify-toggle").textContent = state.notificationsEnabled ? "Notify On" : "Notify";
  state.aiAutoEnabled = localStorage.getItem("trade7smart_ai_auto") === "1";
  $("ai-auto-toggle").textContent = state.aiAutoEnabled ? "AI On" : "AI Auto";
  const savedMode = localStorage.getItem("trade7smart_contract_mode");
  if (savedMode) setContractMode(savedMode);
  state.accountTarget = $("account-target").value;
  state.appId = $("app-id").value.trim() || "1089";
  state.symbol = $("symbol").value;
}

function applyConnectionSettings() {
  const nextSymbol = $("symbol").value;
  state.accountTarget = $("account-target").value;
  state.appId = $("app-id").value.trim() || "1089";
  $("account-badge").textContent = state.accountTarget.toUpperCase();

  if (nextSymbol !== state.symbol) {
    state.symbol = nextSymbol;
    state.oddStreak = 0;
    state.digitStreak = 0;
    state.repeatDigit = null;
    state.tickHistory = [];
    state.digitCounts = Array(10).fill(0);
    if (state.authorized) subscribeCoreStreams();
    journal(`Market switched to ${state.symbol}.`, "trade");
  }
  updateDashboard();
}

$("strategy-contract-mode").addEventListener("change", () => syncStrategyBuilder("builder"));
document.querySelectorAll(".contract-tab").forEach((tab) => {
  tab.addEventListener("click", () => setContractMode(tab.dataset.mode));
});
["ou-barrier", "ou-direction", "ou-min-bias", "ou-sample", "differ-trigger"].forEach((id) => {
  const el = $(id);
  if (el) el.addEventListener("input", updateDashboard);
  if (el) el.addEventListener("change", updateDashboard);
});
$("connect-button").addEventListener("click", connectAccount);
$("start-bot").addEventListener("click", startBot);
$("ai-run-bot").addEventListener("click", aiRunBot);
$("stop-bot").addEventListener("click", stopBot);
$("clear-journal").addEventListener("click", () => ($("journal").innerHTML = ""));
$("symbol").addEventListener("change", applyConnectionSettings);
$("account-target").addEventListener("change", applyConnectionSettings);
$("app-id").addEventListener("change", applyConnectionSettings);
$("preferred-odds").addEventListener("change", () => syncStrategyBuilder("main"));
$("stake").addEventListener("input", () => {
  if (!state.running) state.currentStake = getSettings().stake;
  updateDashboard();
});
$("shield").addEventListener("input", updateDashboard);
$("profit-buffer").addEventListener("input", () => syncStrategyBuilder("main"));
$("recovery-start-losses").addEventListener("input", () => syncStrategyBuilder("main"));
$("max-recovery-steps").addEventListener("input", () => syncStrategyBuilder("main"));
$("max-stake").addEventListener("input", updateDashboard);
$("daily-profit-target").addEventListener("input", updateDashboard);
$("daily-loss-limit").addEventListener("input", updateDashboard);
$("min-balance-protection").addEventListener("input", updateDashboard);
$("strategy-preset").addEventListener("change", applyPreset);
$("trigger-count").addEventListener("change", () => syncStrategyBuilder("builder"));
$("trade-direction").addEventListener("change", updateDashboard);
$("strategy-recovery-start").addEventListener("input", () => syncStrategyBuilder("builder"));
$("strategy-max-recovery").addEventListener("input", () => syncStrategyBuilder("builder"));
$("strategy-profit-buffer").addEventListener("input", () => syncStrategyBuilder("builder"));
$("run-backtest").addEventListener("click", runBacktest);
$("compact-toggle").addEventListener("click", toggleCompactMode);
$("mini-toggle").addEventListener("click", toggleMiniMode);
$("sound-toggle").addEventListener("click", toggleSound);
$("notify-toggle").addEventListener("click", requestNotifications);
$("ai-auto-toggle").addEventListener("click", toggleAiAuto);
$("use-best-market").addEventListener("click", useBestMarket);
if ($("ou-auto-barrier")) $("ou-auto-barrier").addEventListener("click", pickAutoBarrier);
$("session-target-profit").addEventListener("input", updateDashboard);
$("session-max-loss").addEventListener("input", updateDashboard);
$("save-token").addEventListener("change", () => {
  if (!$("save-token").checked) {
    localStorage.removeItem("trade7smart_token");
    toast("Saved token removed.");
  }
});

loadSavedSettings();
renderWatchlist();
syncStrategyBuilder("main");
updateDashboard();
startLiveClock();
initSectionNav();
connectPublicScanner();
setTimeout(hideLoader, 850);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js?v=cursor-ai-20260620")
    .then((registration) => registration.update?.())
    .catch(() => {});
}
