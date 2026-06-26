const WS_URL = "wss://ws.derivws.com/websockets/v3";
const WATCHLIST = [
  ["1HZ100V", "Volatility 100 (1s)"],
  ["1HZ75V", "Volatility 75 (1s)"],
  ["1HZ50V", "Volatility 50 (1s)"],
  ["1HZ25V", "Volatility 25 (1s)"],
  ["1HZ10V", "Volatility 10 (1s)"],
];

const state = {
  ws: null,
  scannerOnly: false,
  authorized: false,
  running: false,
  activeTrade: false,
  appId: "1089",
  symbol: "1HZ100V",
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

// Runs an init step in isolation so one bug (e.g. a missing element) can never
// stop the rest of startup from running and leave the app stuck behind the splash screen.
function safeInit(fn, label) {
  try {
    fn();
  } catch (err) {
    console.error(`[Trade7Smart] init step "${label}" failed:`, err);
  }
}

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
    if (data.msg_type === "candles") handleCandles(data);
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
  refreshRiseFallSignals();
  if (state.riseFallTimer) clearInterval(state.riseFallTimer);
  state.riseFallTimer = setInterval(refreshRiseFallSignals, 45000);
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
  maybeTriggerOverUnderTriple(symbol);
  if (symbol !== state.symbol) return;

  state.lastQuote = display;
  state.lastDigit = digit;
  state.tickHistory.push(quote);
  pushHomeChartTick(quote);
  state.digitHistory.push(digit);
  if (state.tickHistory.length > 80) state.tickHistory.shift();
  if (state.digitHistory.length > 400) state.digitHistory.shift();
  if (Number.isInteger(digit)) state.digitCounts[digit] += 1;

  // OUA analyzer hook
  if (typeof ouaOnTick === "function") ouaOnTick(digit);

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

function maybeTriggerOverUnderTriple(symbol) {
  const settings = getSettings();
  if (settings.contractMode !== "over_under" || !settings.ouAutoTripleEnabled) return;
  if (!state.running || state.activeTrade || !state.authorized) return;
  const stat = state.marketStats.get(symbol);
  if (!stat) return;
  const last3 = (stat.recentDigits || []).slice(-3);
  if (last3.length < 3) return;
  const isTriple1 = last3.every((d) => d === 1);
  const isTriple0 = last3.every((d) => d === 0);
  if (!isTriple1 && !isTriple0) return;
  const matchedDigit = isTriple1 ? 1 : 0;

  const key = `${symbol}:${matchedDigit}:${stat.recentDigits.length}`;
  if (state.lastTripleKey === key) return;
  state.lastTripleKey = key;

  state.symbol = symbol;
  if ($("symbol")) $("symbol").value = symbol;
  $("ou-barrier").value = "1";
  $("ou-direction").value = "DIGITOVER";
  state.currentStake = settings.stake;
  journal(`Triple-repeat: ${symbol} printed ${matchedDigit},${matchedDigit},${matchedDigit}. Firing OVER 1 for 1 tick.`, "trade");
  toast(`Found ${matchedDigit},${matchedDigit},${matchedDigit} on ${symbol} — buying Over 1.`, "good");
  if ($("digit-strip")) {
    const banner = $("triple-detect-banner");
    if (banner) {
      banner.textContent = `Detected ${matchedDigit},${matchedDigit},${matchedDigit} on ${symbol} → OVER 1 fired`;
      banner.classList.add("flash");
      setTimeout(() => banner.classList.remove("flash"), 1600);
    }
  }

  const stake = Number(settings.stake.toFixed(2));
  state.activeTrade = true;
  state.tradeEntryDigit = stat.digit;
  state.tradeEndDigit = null;
  startContractCursor();
  send(
    {
      proposal: 1,
      amount: stake,
      basis: "stake",
      currency: state.currency,
      duration: 1,
      duration_unit: "t",
      symbol,
      contract_type: "DIGITOVER",
      barrier: "1",
    },
    "proposal"
  );
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
    ticks: Math.min(10, Math.max(1, Number($("trade-ticks").value) || 1)),
    ouAutoTripleEnabled: $("ou-auto-triple-enable")?.checked || false,
    ouAutoTripleDigit: Number($("ou-auto-triple-digit")?.value ?? 1),
  };
}

function contractModeLabel(mode) {
  if (mode === "over_under") return "Over / Under";
  if (mode === "differ") return "Differ";
  if (mode === "rise_fall") return "Rise / Fall";
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
  if (settings.contractMode === "rise_fall") {
    return false; // rise_fall entries are driven by maybeTradeRiseFall(), not the tick-by-tick loop
  }
  if (settings.contractMode === "over_under" && settings.barrier === 0 && settings.ouDirection === "DIGITOVER") {
    // Over 0 wins on any digit 1-9 (only loses on 0) — no need to wait for bias, fire on every tick.
    return true;
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
    duration: settings.ticks || 1,
    duration_unit: "t",
    symbol: state.symbol,
  };
  if (settings.contractMode === "odds_even") {
    return { ...base, contract_type: settings.tradeDirection };
  }
  if (settings.contractMode === "differ") {
    return { ...base, contract_type: "DIGITDIFF", barrier: String(state.repeatDigit ?? state.lastDigit ?? 0) };
  }
  if (settings.contractMode === "rise_fall") {
    return { ...base, contract_type: state.riseFallDirection === "FALL" ? "PUT" : "CALL" };
  }
  return { ...base, contract_type: settings.ouDirection, barrier: String(settings.barrier) };
}

function contractLabel(settings) {
  if (settings.contractMode === "odds_even") {
    return settings.tradeDirection === "DIGITEVEN" ? "EVEN" : "ODD";
  }
  if (settings.contractMode === "differ") return "DIFFER";
  if (settings.contractMode === "rise_fall") return state.riseFallDirection === "FALL" ? "FALL" : "RISE";
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
  if (settings.contractMode === "rise_fall") return Math.random() > 0.48;
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
  // Run Bot: trade ONLY the currently selected market (no AI market switching)
  state.runBotMarketLocked = true;
  $("bot-state").textContent = "Running";
  toast(`Bot running on ${state.symbol}. Waiting for signal.`, "good");
  journal(`Bot started on ${settings.accountTarget.toUpperCase()} | Market: ${state.symbol} | Mode: ${settings.contractMode} | Stake: ${settings.stake.toFixed(2)}.`, "trade");
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
  if (state.activeStrategyId) {
    state.activeStrategyId = null;
    state.activeStrategyName = null;
    const tag = $("strategy-watch-tag");
    if (tag) tag.classList.add("hidden");
    renderStrategyBotGrid();
  }
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
  // Notify OUA analyzer of outcome
  if (typeof ouaNotifySettle === "function") ouaNotifySettle(profit);

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
    toast(`Session profit target of ${settings.sessionTargetProfit.toFixed(2)} reached! Resetting session to 0.`, "good");
    journal(`Session target reached (+${state.dailyProfit.toFixed(2)}). Session profit reset to 0.`, "win");
    state.dailyProfit = 0;
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
  if ($("price-chart")) renderPriceChart();
  if ($("digit-prob-row")) renderDigitProbabilityRow();
  syncHomeTab();
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
  const activeDigit = state.activeTrade ? state.tradeCursorDigit : null;
  for (let digit = 0; digit <= 9; digit += 1) {
    const item = document.createElement("i");
    item.textContent = digit;
    item.className = [
      digit % 2 === 1 ? "odd" : "even",
      activeDigit === digit ? "active" : "",
      state.tradeEndDigit === digit ? "ended" : "",
    ].filter(Boolean).join(" ");
    if (state.activeTrade && activeDigit === digit) {
      item.setAttribute("data-badge", "•");
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
  }, 450);
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
  if (!list) return; // no watchlist panel in this build, nothing to render into
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

const RISEFALL_TIMEFRAMES = [
  { granularity: 60, label: "1m" },
  { granularity: 120, label: "2m" },
  { granularity: 180, label: "3m" },
  { granularity: 300, label: "5m" },
  { granularity: 600, label: "10m" },
];

state.riseFallData = state.riseFallData || {}; // { symbol: { granularity: candles[] } }
state.riseFallReqMeta = state.riseFallReqMeta || {}; // { reqId: {symbol, granularity} }
state.lastCleanSignalKey = state.lastCleanSignalKey || null;

function requestCandles(symbol, granularity) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
  const reqId = send(
    {
      ticks_history: symbol,
      style: "candles",
      granularity,
      count: 60,
      end: "latest",
    },
    "candles"
  );
  if (reqId) state.riseFallReqMeta[reqId] = { symbol, granularity };
}

function refreshRiseFallSignals() {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
  WATCHLIST.forEach(([symbol]) => {
    RISEFALL_TIMEFRAMES.forEach(({ granularity }) => {
      requestCandles(symbol, granularity);
    });
  });
}

function handleCandles(data) {
  const meta = state.riseFallReqMeta[data.req_id];
  if (!meta || !data.candles) return;
  delete state.riseFallReqMeta[data.req_id];
  state.riseFallData[meta.symbol] = state.riseFallData[meta.symbol] || {};
  state.riseFallData[meta.symbol][meta.granularity] = data.candles;
  renderRiseFallPanel();
}

function emaSeries(values, period) {
  const k = 2 / (period + 1);
  const out = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(values[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

function computeMacd(closes) {
  if (closes.length < 30) return null;
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = emaSeries(macdLine, 9);
  const histogram = macdLine.map((v, i) => v - signalLine[i]);
  const last = histogram.length - 1;
  const direction = histogram[last] > 0 ? "RISE" : "FALL";
  const strengthening = Math.abs(histogram[last]) > Math.abs(histogram[last - 1] || 0);
  return { direction, histogram: histogram[last], strengthening };
}

function analyzeSymbolTimeframes(symbol) {
  const data = state.riseFallData[symbol] || {};
  const frames = RISEFALL_TIMEFRAMES.map(({ granularity, label }) => {
    const candles = data[granularity];
    if (!candles || candles.length < 30) return { label, signal: null };
    const closes = candles.map((c) => Number(c.close));
    const macd = computeMacd(closes);
    return { label, signal: macd };
  });
  const valid = frames.filter((f) => f.signal);
  const riseCount = valid.filter((f) => f.signal.direction === "RISE").length;
  const fallCount = valid.length - riseCount;
  const agreement = valid.length ? Math.max(riseCount, fallCount) / valid.length : 0;
  const direction = riseCount >= fallCount ? "RISE" : "FALL";
  const cleanSignal = valid.length === RISEFALL_TIMEFRAMES.length && agreement >= 0.8;
  return { frames, direction, agreement, cleanSignal, validCount: valid.length };
}

function renderRiseFallPanel() {
  const holder = $("risefall-grid");
  if (!holder) return;

  let best = null;
  const rows = WATCHLIST.map(([symbol, name]) => {
    const analysis = analyzeSymbolTimeframes(symbol);
    if (!best || analysis.agreement > best.analysis.agreement) best = { symbol, name, analysis };
    return { symbol, name, analysis };
  });

  holder.innerHTML = "";
  rows.forEach(({ symbol, name, analysis }) => {
    const row = document.createElement("div");
    row.className = "rf-row";
    const tfCells = RISEFALL_TIMEFRAMES.map(({ label }) => {
      const f = analysis.frames.find((x) => x.label === label);
      const cls = !f?.signal ? "rf-pending" : f.signal.direction === "RISE" ? "rf-rise" : "rf-fall";
      const txt = !f?.signal ? "..." : f.signal.direction === "RISE" ? "↑" : "↓";
      return `<span class="rf-tf ${cls}" title="${label}">${txt}</span>`;
    }).join("");
    row.innerHTML = `
      <span class="rf-name">${name}</span>
      <span class="rf-tfs">${tfCells}</span>
      <span class="rf-verdict ${analysis.direction === "RISE" ? "rf-rise" : "rf-fall"}">${analysis.direction}</span>
      <span class="rf-agreement">${Math.round(analysis.agreement * 100)}%</span>
    `;
    holder.appendChild(row);
  });

  if (best && $("rf-best-market")) {
    if ($("rf-best-market")) $("rf-best-market").textContent = best.name;
    if ($("rf-best-direction")) $("rf-best-direction").textContent = best.analysis.direction;
    if ($("rf-best-direction")) $("rf-best-direction").className = best.analysis.direction === "RISE" ? "rf-rise" : "rf-fall";
    if ($("rf-best-confidence")) $("rf-best-confidence").textContent = `${Math.round(best.analysis.agreement * 100)}% agreement across ${best.analysis.validCount}/5 timeframes`;
  }

  if (best && $("rf-engine-market")) {
    $("rf-engine-market").textContent = `${best.name} (${Math.round(best.analysis.agreement * 100)}% match)`;
    $("rf-engine-direction").textContent = best.analysis.cleanSignal
      ? `Clean ${best.analysis.direction} signal ready`
      : `Leaning ${best.analysis.direction}, waiting for full agreement`;
  }

  if (best && best.analysis.cleanSignal) {
    const key = `${best.symbol}:${best.analysis.direction}`;
    if (state.lastCleanSignalKey !== key) {
      state.lastCleanSignalKey = key;
      toast(`Clean ${best.analysis.direction} signal on ${best.name} (all 5 timeframes agree).`, "good");
      if (state.notificationsEnabled) {
        phoneNotify("Clean Rise/Fall entry", `${best.name}: ${best.analysis.direction} confirmed on 1m-10m MACD.`, "good");
      }
    }
    maybeTradeRiseFall(best);
  }
}

function maybeTradeRiseFall(best) {
  const settings = getSettings();
  if (settings.contractMode !== "rise_fall" || !state.running || state.activeTrade) return;
  if (!state.authorized) return;
  state.symbol = best.symbol;
  if ($("symbol")) $("symbol").value = best.symbol;
  state.riseFallDirection = best.analysis.direction;
  journal(`AI Run selected ${best.name}: clean ${best.analysis.direction} signal (1m-10m MACD agree).`, "trade");
  toast(`AI Run trading ${best.analysis.direction} on ${best.name}.`, "good");
  triggerTrade(false);
}

function buyRiseFall(direction) {
  if (!state.authorized) {
    toast("Connect your account first.", "danger");
    return;
  }
  if (state.activeTrade) {
    toast("Wait for the current contract to finish.", "warn");
    return;
  }
  const settings = getSettings();
  const stake = Math.max(settings.stake || 0.35, 0.35);
  state.currentStake = stake;
  state.activeTrade = true;
  state.tradeEndDigit = null;
  state.riseFallDirection = direction;
  startContractCursor();
  send(
    {
      proposal: 1,
      amount: stake,
      basis: "stake",
      currency: state.currency,
      duration: settings.ticks || 1,
      duration_unit: "t",
      symbol: state.symbol,
      contract_type: direction === "RISE" ? "CALL" : "PUT",
    },
    "proposal"
  );
  toast(`Buying ${direction} on ${state.symbol}...`, "good");
  journal(`Manual ${direction} (Rise/Fall) buy on ${state.symbol}, stake ${stake.toFixed(2)}.`, "trade");
  updateDashboard();
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

  if ($("da-ai-score")) $("da-ai-score").textContent = `${score}%`;
  if ($("da-ai-recommend")) $("da-ai-recommend").textContent = `Recommend: ${recommend}`;
  if ($("da-ai-reason")) $("da-ai-reason").textContent = reason;
  if ($("da-ai-confidence-tag")) $("da-ai-confidence-tag").textContent = score >= 70 ? "HIGH" : score >= 45 ? "MEDIUM" : "BETA";

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
  if ($("da-eo-streak")) $("da-eo-streak").textContent = `${eoStreak}x ${lastParity === 1 ? "Odd" : "Even"}`;

  // high/low streak
  let hlStreak = 1;
  const lastHL = digits[digits.length - 1] >= 5 ? "high" : "low";
  for (let i = digits.length - 2; i >= 0; i--) {
    const hl = digits[i] >= 5 ? "high" : "low";
    if (hl === lastHL) hlStreak++;
    else break;
  }
  if ($("da-hl-streak")) $("da-hl-streak").textContent = `${hlStreak}x ${lastHL === "high" ? "High" : "Low"}`;

  // even/odd prediction
  const evenCount = digits.filter((d) => d % 2 === 0).length;
  const oddCount = digits.length - evenCount;
  const evenPct = Math.round((evenCount / digits.length) * 100);
  const oddPct = 100 - evenPct;
  if ($("da-even-bar")) $("da-even-bar").style.width = `${evenPct}%`;
  if ($("da-odd-bar")) $("da-odd-bar").style.width = `${oddPct}%`;
  if ($("da-even-pct")) $("da-even-pct").textContent = `${evenPct}%`;
  if ($("da-odd-pct")) $("da-odd-pct").textContent = `${oddPct}%`;
  const eoSkew = Math.abs(evenPct - 50);
  if ($("da-eo-confidence")) $("da-eo-confidence").textContent = `Confidence: ${eoSkew >= 15 ? "High" : eoSkew >= 7 ? "Medium" : "Low"}`;

  // over/under prediction
  const underCount = digits.filter((d) => d <= 4).length;
  const overCount = digits.length - underCount;
  const underPct = Math.round((underCount / digits.length) * 100);
  const overPct = 100 - underPct;
  if ($("da-under-bar")) $("da-under-bar").style.width = `${underPct}%`;
  if ($("da-over-bar")) $("da-over-bar").style.width = `${overPct}%`;
  if ($("da-under-pct")) $("da-under-pct").textContent = `${underPct}%`;
  if ($("da-over-pct")) $("da-over-pct").textContent = `${overPct}%`;
  const ouSkew = Math.abs(underPct - 50);
  if ($("da-ou-confidence")) $("da-ou-confidence").textContent = `Confidence: ${ouSkew >= 15 ? "High" : ouSkew >= 7 ? "Medium" : "Low"}`;

  // trend
  const last10 = digits.slice(-10);
  const avg = last10.reduce((a, b) => a + b, 0) / last10.length;
  const counts = {};
  digits.forEach((d) => (counts[d] = (counts[d] || 0) + 1));
  const mode = Object.keys(counts).reduce((a, b) => (counts[a] > counts[b] ? a : b));
  if ($("da-last-digit")) $("da-last-digit").textContent = digits[digits.length - 1];
  if ($("da-avg-digit")) $("da-avg-digit").textContent = avg.toFixed(1);
  if ($("da-mode-digit")) $("da-mode-digit").textContent = mode;
  const firstHalfAvg = last10.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  const secondHalfAvg = last10.slice(5).reduce((a, b) => a + b, 0) / 5;
  const diff = secondHalfAvg - firstHalfAvg;
  if ($("da-trend-copy")) $("da-trend-copy").textContent =
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


state.chartType = state.chartType || "area";

function drawCandlestickChart(canvas, candles) {
  const { ctx, width, height } = prepCanvas(canvas);
  drawGrid(ctx, width, height);
  if (!candles || candles.length < 2) {
    ctx.fillStyle = "#8b95a7";
    ctx.font = "12px sans-serif";
    ctx.fillText("Waiting for 1m candle data...", 12, height / 2);
    return;
  }
  const recent = candles.slice(-40);
  const highs = recent.map((c) => Number(c.high));
  const lows = recent.map((c) => Number(c.low));
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const range = max - min || 1;
  const slotWidth = width / recent.length;
  const bodyWidth = Math.max(2, slotWidth * 0.55);

  recent.forEach((c, i) => {
    const open = Number(c.open);
    const close = Number(c.close);
    const high = Number(c.high);
    const low = Number(c.low);
    const x = i * slotWidth + slotWidth / 2;
    const yOpen = height - ((open - min) / range) * (height - 18) - 9;
    const yClose = height - ((close - min) / range) * (height - 18) - 9;
    const yHigh = height - ((high - min) / range) * (height - 18) - 9;
    const yLow = height - ((low - min) / range) * (height - 18) - 9;
    const up = close >= open;
    ctx.strokeStyle = up ? "#22c55e" : "#f87171";
    ctx.fillStyle = up ? "#22c55e" : "#f87171";
    ctx.beginPath();
    ctx.moveTo(x, yHigh);
    ctx.lineTo(x, yLow);
    ctx.stroke();
    const bodyTop = Math.min(yOpen, yClose);
    const bodyHeight = Math.max(1, Math.abs(yClose - yOpen));
    ctx.fillRect(x - bodyWidth / 2, bodyTop, bodyWidth, bodyHeight);
  });
}

function renderPriceChart() {
  const canvas = $("price-chart");
  if (!canvas) return;
  if ($("price-chart-symbol-label")) {
    $("price-chart-symbol-label").textContent = `Live market chart — ${state.symbol}`;
  }
  if (state.chartType === "candles") {
    const candles = state.riseFallData?.[state.symbol]?.[60];
    drawCandlestickChart(canvas, candles);
    return;
  }
  drawLineChart(canvas, state.tickHistory, false);
  canvas.classList.toggle("line-only", state.chartType === "line");
}

function initChartTypeToggle() {
  document.querySelectorAll(".chart-type-btn[data-chart-type]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".chart-type-btn[data-chart-type]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.chartType = btn.dataset.chartType;
      renderPriceChart();
    });
  });
  document.querySelectorAll(".chart-type-btn[data-home-chart-type]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".chart-type-btn[data-home-chart-type]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.homeChartType = btn.dataset.homeChartType;
      renderHomeChart();
    });
  });
}

// ── HOME CHART ──────────────────────────────────────────────
const HOME_CHART_ZOOM_DEFAULT = 40; // candles visible by default
const HOME_CHART_ZOOM_MIN = 12;     // most zoomed in
const HOME_CHART_ZOOM_MAX = 120;    // most zoomed out (full buffer)
const HOME_CHART_ZOOM_STEP = 8;

function initHomeChart() {
  state.homeChartType = "candles";
  state.homeChartCandles = []; // {o,h,l,c,t}
  state.homeChartTickBuffer = [];
  state.homeChartCandleSeconds = 10; // build 10s candles from ticks
  state.homeChartZoom = HOME_CHART_ZOOM_DEFAULT;

  const zoomIn = $("home-chart-zoom-in");
  const zoomOut = $("home-chart-zoom-out");
  const zoomReset = $("home-chart-zoom-reset");
  if (zoomIn) {
    zoomIn.addEventListener("click", () => {
      state.homeChartZoom = Math.max(HOME_CHART_ZOOM_MIN, (state.homeChartZoom || HOME_CHART_ZOOM_DEFAULT) - HOME_CHART_ZOOM_STEP);
      renderHomeChart();
    });
  }
  if (zoomOut) {
    zoomOut.addEventListener("click", () => {
      state.homeChartZoom = Math.min(HOME_CHART_ZOOM_MAX, (state.homeChartZoom || HOME_CHART_ZOOM_DEFAULT) + HOME_CHART_ZOOM_STEP);
      renderHomeChart();
    });
  }
  if (zoomReset) {
    zoomReset.addEventListener("click", () => {
      state.homeChartZoom = HOME_CHART_ZOOM_DEFAULT;
      renderHomeChart();
    });
  }

  const sel = $("home-market-select");
  if (sel) {
    sel.addEventListener("change", () => {
      const sym = sel.value;
      state.homeChartSymbol = sym;
      $("home-chart-symbol-label").textContent = sel.options[sel.selectedIndex].text;
      // If connected, subscribe to this symbol for chart only
      if ($("symbol")) $("symbol").value = sym;
      state.symbol = sym;
      state.homeChartCandles = [];
      state.homeChartTickBuffer = [];
      renderHomeChart();
    });
  }
}

function pushHomeChartTick(price) {
  const now = Date.now();
  const candleSecs = state.homeChartCandleSeconds || 10;
  const bucketId = Math.floor(now / (candleSecs * 1000));

  if (!state.homeChartTickBuffer) state.homeChartTickBuffer = [];
  if (!state.homeChartCandles) state.homeChartCandles = [];

  const last = state.homeChartCandles[state.homeChartCandles.length - 1];
  if (last && last._bucketId === bucketId) {
    last.h = Math.max(last.h, price);
    last.l = Math.min(last.l, price);
    last.c = price;
    last.t = now;
  } else {
    state.homeChartCandles.push({ o: price, h: price, l: price, c: price, t: now, _bucketId: bucketId });
    if (state.homeChartCandles.length > 120) state.homeChartCandles.shift();
  }
  renderHomeChart();
}

function computeMACD(closes, fast = 12, slow = 26, signal = 9) {
  function ema(arr, period) {
    const k = 2 / (period + 1);
    const result = [];
    let prev = arr.slice(0, period).reduce((a, b) => a + b, 0) / period;
    result.push(prev);
    for (let i = period; i < arr.length; i++) {
      prev = arr[i] * k + prev * (1 - k);
      result.push(prev);
    }
    return result;
  }
  if (closes.length < slow + signal) return null;
  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);
  const macdLine = fastEma.slice(fastEma.length - slowEma.length).map((v, i) => v - slowEma[i]);
  const signalLine = ema(macdLine, signal);
  const histogram = macdLine.slice(macdLine.length - signalLine.length).map((v, i) => v - signalLine[i]);
  return { macdLine: macdLine.slice(-histogram.length), signalLine, histogram };
}

function computeChandelierExit(candles, period = 22, multiplier = 3) {
  if (candles.length < period) return null;
  const recent = candles.slice(-period);
  const highestHigh = Math.max(...recent.map((c) => c.h));
  const lowestLow = Math.min(...recent.map((c) => c.l));
  // Average True Range approximation
  let atrSum = 0;
  for (let i = 1; i < recent.length; i++) {
    const tr = Math.max(recent[i].h - recent[i].l, Math.abs(recent[i].h - recent[i - 1].c), Math.abs(recent[i].l - recent[i - 1].c));
    atrSum += tr;
  }
  const atr = atrSum / (recent.length - 1);
  const longStop = highestHigh - multiplier * atr;
  const shortStop = lowestLow + multiplier * atr;
  const lastClose = candles[candles.length - 1].c;
  const direction = lastClose > longStop ? "LONG" : "SHORT";
  return { longStop, shortStop, atr, direction, lastClose };
}

function renderHomeChart() {
  const canvas = $("home-price-chart");
  const macdCanvas = $("home-macd-chart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const allCandles = state.homeChartCandles || [];
  const zoomWindow = Math.max(HOME_CHART_ZOOM_MIN, Math.min(state.homeChartZoom || HOME_CHART_ZOOM_DEFAULT, HOME_CHART_ZOOM_MAX));
  const candles = allCandles.slice(-zoomWindow);

  const W = canvas.offsetWidth || 380;
  const H = canvas.height || 200;
  canvas.width = W;
  ctx.clearRect(0, 0, W, H);

  if (candles.length < 2) {
    ctx.fillStyle = "rgba(100,116,139,0.5)";
    ctx.font = "13px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Waiting for price data...", W / 2, H / 2);
    return;
  }

  const prices = candles.map((c) => c.c);
  const highs = candles.map((c) => c.h);
  const lows = candles.map((c) => c.l);
  const minP = Math.min(...lows);
  const maxP = Math.max(...highs);
  const range = maxP - minP || 1;
  const pad = { t: 16, b: 20, l: 8, r: 60 };
  const chartW = W - pad.l - pad.r;
  const chartH = H - pad.t - pad.b;

  const xOf = (i) => pad.l + (i / (candles.length - 1)) * chartW;
  const yOf = (p) => pad.t + chartH - ((p - minP) / range) * chartH;

  const type = state.homeChartType || "candles";

  if (type === "candles") {
    const cw = Math.max(2, Math.floor(chartW / candles.length) - 1);
    candles.forEach((c, i) => {
      const x = pad.l + (i / Math.max(candles.length - 1, 1)) * chartW;
      const isUp = c.c >= c.o;
      ctx.strokeStyle = isUp ? "#22c55e" : "#ef4444";
      ctx.fillStyle = isUp ? "rgba(34,197,94,0.7)" : "rgba(239,68,68,0.7)";
      // Wick
      ctx.beginPath();
      ctx.lineWidth = 1;
      ctx.moveTo(x, yOf(c.h));
      ctx.lineTo(x, yOf(c.l));
      ctx.stroke();
      // Body
      const top = yOf(Math.max(c.o, c.c));
      const bot = yOf(Math.min(c.o, c.c));
      const bodyH = Math.max(1, bot - top);
      ctx.fillRect(x - cw / 2, top, cw, bodyH);
    });
  } else if (type === "area") {
    const grad = ctx.createLinearGradient(0, pad.t, 0, H - pad.b);
    grad.addColorStop(0, "rgba(59,130,246,0.35)");
    grad.addColorStop(1, "rgba(59,130,246,0.02)");
    ctx.beginPath();
    prices.forEach((p, i) => i === 0 ? ctx.moveTo(xOf(i), yOf(p)) : ctx.lineTo(xOf(i), yOf(p)));
    ctx.lineTo(xOf(prices.length - 1), H - pad.b);
    ctx.lineTo(xOf(0), H - pad.b);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.beginPath();
    prices.forEach((p, i) => i === 0 ? ctx.moveTo(xOf(i), yOf(p)) : ctx.lineTo(xOf(i), yOf(p)));
    ctx.strokeStyle = "#3b82f6";
    ctx.lineWidth = 2;
    ctx.stroke();
  } else {
    ctx.beginPath();
    prices.forEach((p, i) => i === 0 ? ctx.moveTo(xOf(i), yOf(p)) : ctx.lineTo(xOf(i), yOf(p)));
    ctx.strokeStyle = "#22d3ee";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Price labels on right axis
  ctx.fillStyle = "#94a3b8";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "left";
  [0, 0.25, 0.5, 0.75, 1].forEach((frac) => {
    const p = minP + frac * range;
    const y = yOf(p);
    ctx.fillText(p.toFixed(2), W - pad.r + 4, y + 3);
    ctx.strokeStyle = "rgba(148,163,184,0.1)";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(W - pad.r, y);
    ctx.stroke();
  });

  // Chandelier Exit
  const chandelier = computeChandelierExit(candles);
  if (chandelier) {
    const stopLevel = chandelier.direction === "LONG" ? chandelier.longStop : chandelier.shortStop;
    const stopY = yOf(stopLevel);
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = chandelier.direction === "LONG" ? "#22c55e" : "#ef4444";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pad.l, stopY);
    ctx.lineTo(W - pad.r, stopY);
    ctx.stroke();
    ctx.setLineDash([]);

    const el = $("home-chandelier-signal");
    const elV = $("home-chandelier-value");
    if (el) {
      el.textContent = chandelier.direction === "LONG" ? "▲ LONG" : "▼ SHORT";
      el.className = `home-chandelier-signal ${chandelier.direction === "LONG" ? "long" : "short"}`;
    }
    if (elV) elV.textContent = `Stop: ${stopLevel.toFixed(2)} | ATR: ${chandelier.atr.toFixed(3)}`;
  }

  // MACD sub-chart
  if (macdCanvas) {
    const mW = macdCanvas.offsetWidth || 380;
    const mH = macdCanvas.height || 70;
    macdCanvas.width = mW;
    const mCtx = macdCanvas.getContext("2d");
    mCtx.clearRect(0, 0, mW, mH);
    const closes = candles.map((c) => c.c);
    const macdData = computeMACD(closes);
    if (macdData) {
      const hist = macdData.histogram;
      const maxH = Math.max(...hist.map(Math.abs), 0.0001);
      const mPad = { t: 4, b: 4, l: 8, r: 60 };
      const mCW = mW - mPad.l - mPad.r;
      const mCH = mH - mPad.t - mPad.b;
      const barW = Math.max(1, mCW / hist.length - 1);
      hist.forEach((v, i) => {
        const x = mPad.l + (i / Math.max(hist.length - 1, 1)) * mCW;
        const barH = (Math.abs(v) / maxH) * (mCH / 2);
        const y = v >= 0 ? mH / 2 - barH : mH / 2;
        mCtx.fillStyle = v >= 0 ? "rgba(34,197,94,0.7)" : "rgba(239,68,68,0.7)";
        mCtx.fillRect(x - barW / 2, y, barW, barH);
      });
      // Zero line
      mCtx.strokeStyle = "rgba(148,163,184,0.3)";
      mCtx.lineWidth = 0.5;
      mCtx.beginPath();
      mCtx.moveTo(mPad.l, mH / 2);
      mCtx.lineTo(mW - mPad.r, mH / 2);
      mCtx.stroke();
      // Signal label
      const lastHist = hist[hist.length - 1] || 0;
      mCtx.fillStyle = "#94a3b8";
      mCtx.font = "10px sans-serif";
      mCtx.textAlign = "left";
      mCtx.fillText(`MACD ${lastHist >= 0 ? "▲" : "▼"} ${lastHist.toFixed(4)}`, mW - mPad.r + 4, mH / 2 + 4);
    } else {
      mCtx.fillStyle = "rgba(100,116,139,0.4)";
      mCtx.font = "10px sans-serif";
      mCtx.textAlign = "center";
      mCtx.fillText("Collecting candle data for MACD...", mW / 2, mH / 2 + 4);
    }
  }
}
// ── END HOME CHART ───────────────────────────────────────────



function renderDigitProbabilityRow() {
  const row = $("digit-prob-row");
  if (!row) return;
  const total = state.digitCounts.reduce((a, b) => a + b, 0) || 1;
  const existing = row.querySelectorAll(".digit-prob-cell");
  if (existing.length !== 10) {
    row.querySelectorAll(".digit-prob-cell").forEach((el) => el.remove());
    for (let d = 0; d <= 9; d++) {
      const cell = document.createElement("div");
      cell.className = "digit-prob-cell";
      cell.id = `digit-prob-${d}`;
      cell.innerHTML = `
        <svg viewBox="0 0 44 44">
          <circle class="dp-track" cx="22" cy="22" r="18" />
          <circle class="dp-fill" cx="22" cy="22" r="18" />
        </svg>
        <span class="dp-digit">${d}</span>
        <small class="dp-pct">--</small>
      `;
      row.appendChild(cell);
    }
  }
  for (let d = 0; d <= 9; d++) {
    const pct = (state.digitCounts[d] / total) * 100;
    const cell = $(`digit-prob-${d}`);
    if (!cell) continue;
    const fill = cell.querySelector(".dp-fill");
    const circumference = 2 * Math.PI * 18;
    fill.style.strokeDasharray = `${circumference}`;
    fill.style.strokeDashoffset = `${circumference - (Math.min(pct, 100) / 100) * circumference}`;
    fill.style.stroke = pct >= 12 ? "#22d3ee" : pct <= 8 ? "#f87171" : "#475569";
    cell.querySelector(".dp-pct").textContent = `${pct.toFixed(1)}%`;
  }

  const cursor = $("digit-prob-cursor");
  if (cursor && state.lastDigit !== undefined && state.lastDigit !== null) {
    const targetCell = $(`digit-prob-${state.lastDigit}`);
    if (targetCell) {
      cursor.style.left = `${targetCell.offsetLeft + targetCell.offsetWidth / 2}px`;
      cursor.classList.add("visible");
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
  if ($("backtest-results")) $("backtest-results").innerHTML = `
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
  const settings = getSettings();
  if (!state.authorized) {
    toast("Connect your account first.", "danger");
    return;
  }
  state.aiAutoEnabled = true;
  state.runBotMarketLocked = false; // AI Run is allowed to switch markets
  localStorage.setItem("trade7smart_ai_auto", "1");
  $("ai-auto-toggle").textContent = "AI On";

  // Pick best market immediately
  const ranked = getRankedMarkets(settings);
  if (ranked && ranked.length) {
    const best = ranked.find((m) => m.ai.ready) || ranked[0];
    $("symbol").value = best.symbol;
    state.symbol = best.symbol;
    toast(`AI Run: scanning best market → ${best.name}. Auto-trading first clean signal.`, "good");
    journal(`AI Run started. Best market: ${best.name} (${best.symbol}) | Signal: ${best.ai.signal}.`, "trade");
  } else {
    toast("AI Run scanning. Ready markets will enter immediately.", "good");
  }

  state.baseStake = settings.stake;
  state.currentStake = settings.stake;
  state.cycleRecoveryDepth = 0;
  state.running = true;
  $("bot-state").textContent = "AI Scanning";
  updateDashboard();
  setTimeout(forceBestAiEntry, 200);
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

const TAB_GROUPS = {
  "home-tab-key": ["home-tab"],
  "ai-scanner-hero": ["ai-scanner-hero"],
  "hero-grid": ["hero-grid"],
  "charts-section": ["charts-section"],
  recovery: ["pro-grid", "risk-grid"],
  stats: ["analytics-grid", "scanner-grid", "bottom-grid"],
  strategy: ["strategy"],
};

function initSectionNav() {
  const allSectionIds = Object.values(TAB_GROUPS).flat();

  function showTab(tabKey) {
    const activeIds = TAB_GROUPS[tabKey] || [];
    allSectionIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle("tab-hidden", !activeIds.includes(id));
    });
    document.querySelectorAll(".nav-pill").forEach((p) => p.classList.toggle("active", p.dataset.tab === tabKey));
    document.querySelectorAll(".bt-tab").forEach((p) => p.classList.toggle("active", p.dataset.tab === tabKey));
    const shell = document.querySelector(".terminal-shell");
    if (shell) shell.scrollTo({ top: 0 });
  }

  document.querySelectorAll(".nav-pill, .bt-tab").forEach((pill) => {
    pill.addEventListener("click", () => showTab(pill.dataset.tab));
  });

  showTab("home-tab-key");
}



function hideLoader() {
  document.body.classList.add("loaded");
}

function initButubaPreloader() {
  const letters = "BUTUBA".split("");
  const holder = $("bp-letters");
  if (!holder) return;
  letters.forEach((ch, i) => {
    const span = document.createElement("span");
    span.textContent = ch;
    span.style.animationDelay = `${i * 0.12}s`;
    holder.appendChild(span);
  });
  setTimeout(() => {
    const pre = $("butuba-preloader");
    if (pre) {
      pre.classList.add("hide");
      setTimeout(() => pre.remove(), 600);
    }
  }, 5000);
}

function initConnectionDrawer() {
  const toggle = $("connection-drawer-toggle");
  const drawer = $("connection-drawer");
  if (!toggle || !drawer) return;
  toggle.addEventListener("click", () => drawer.classList.toggle("open"));
  const homeBtn = $("home-connect-button");
  if (homeBtn) {
    homeBtn.addEventListener("click", () => {
      drawer.classList.add("open");
      const real = $("connect-button");
      if (real) real.click();
    });
  }
}

function initOptionsMenu() {
  const toggle = $("options-menu-toggle");
  const menu = $("options-menu");
  if (!toggle || !menu) return;
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.classList.toggle("open");
  });
  document.addEventListener("click", (e) => {
    if (!menu.contains(e.target) && e.target !== toggle) menu.classList.remove("open");
  });
}

function initThemeToggle() {
  const btn = $("theme-toggle");
  if (!btn) return;
  const saved = localStorage.getItem("trade7smart_theme");
  if (saved === "light") {
    document.body.classList.add("light-theme");
    btn.textContent = "☀️";
  }
  btn.addEventListener("click", () => {
    document.body.classList.toggle("light-theme");
    const isLight = document.body.classList.contains("light-theme");
    btn.textContent = isLight ? "☀️" : "🌙";
    localStorage.setItem("trade7smart_theme", isLight ? "light" : "dark");
  });
}

function initQuickActions() {
  const fab = $("quick-actions-toggle");
  const menu = $("quick-actions-menu");
  if (!fab || !menu) return;
  fab.addEventListener("click", () => menu.classList.toggle("open"));

  $("qa-buy-rise")?.addEventListener("click", () => {
    buyRiseFall("RISE");
    menu.classList.remove("open");
  });
  $("qa-buy-fall")?.addEventListener("click", () => {
    buyRiseFall("FALL");
    menu.classList.remove("open");
  });
  $("qa-stop-bot")?.addEventListener("click", () => {
    state.running = false;
    $("bot-state") && ($("bot-state").textContent = "Stopped");
    toast("Bot stopped.", "warn");
    journal("Bot stopped via Quick Actions.", "warn");
    updateDashboard();
    menu.classList.remove("open");
  });
}

function updateRiskGauge(pct) {
  const fill = $("risk-gauge-fill");
  const label = $("risk-gauge-value");
  if (!fill || !label) return;
  const clamped = Math.max(0, Math.min(100, pct || 0));
  const length = 157; // approx path length of the arc
  fill.style.strokeDasharray = `${length}`;
  fill.style.strokeDashoffset = `${length - (clamped / 100) * length}`;
  fill.style.stroke = clamped > 70 ? "#f87171" : clamped > 40 ? "#fbbf24" : "#22d3ee";
  label.textContent = `${Math.round(clamped)}%`;
}

function syncHomeTab() {
  const balanceEl = $("balance");
  if (balanceEl && $("home-balance")) $("home-balance").textContent = balanceEl.textContent;
  if ($("home-account-type")) {
    const acc = $("account-target");
    $("home-account-type").textContent = acc && acc.value === "real" ? "Real account" : "Demo account";
  }
  if ($("da-ai-recommend") && $("home-ai-recommend")) {
    $("home-ai-recommend").textContent = $("da-ai-recommend").textContent;
  }
  if ($("da-ai-confidence-tag") && $("home-ai-confidence")) {
    $("home-ai-confidence").textContent = `Confidence: ${$("da-ai-confidence-tag").textContent}`;
  }
  if ($("signal-copy") && $("home-signal-copy")) {
    $("home-signal-copy").textContent = $("signal-copy").textContent;
  }
  const maxLossEl = $("session-max-loss");
  const lossSoFarEl = $("float-profit");
  if (maxLossEl && lossSoFarEl) {
    const maxLoss = parseFloat(maxLossEl.value) || 1;
    const lossSoFar = Math.abs(Math.min(0, parseFloat(lossSoFarEl.textContent) || 0));
    updateRiskGauge((lossSoFar / maxLoss) * 100);
  }
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

if ($("strategy-contract-mode")) $("strategy-contract-mode").addEventListener("change", () => syncStrategyBuilder("builder"));
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
if($("run-backtest")) $("run-backtest").addEventListener("click", runBacktest);
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

// Dismiss the splash/loader screens unconditionally and first, so a failure in any
// step below can never leave the user stuck looking at them.
safeInit(initButubaPreloader, "initButubaPreloader");
setTimeout(hideLoader, 850);

safeInit(loadSavedSettings, "loadSavedSettings");
safeInit(renderWatchlist, "renderWatchlist");
safeInit(() => syncStrategyBuilder("main"), "syncStrategyBuilder");
safeInit(updateDashboard, "updateDashboard");
safeInit(startLiveClock, "startLiveClock");
safeInit(initSectionNav, "initSectionNav");
safeInit(initConnectionDrawer, "initConnectionDrawer");
safeInit(initOptionsMenu, "initOptionsMenu");
safeInit(initThemeToggle, "initThemeToggle");
safeInit(initQuickActions, "initQuickActions");

const STRATEGY_BOTS = [
  {
    id: "bearish_macd_grind",
    name: "Bearish Rise/Fall MACD Progression Grind",
    source: "bearish_rise_fall_macd_progression_grind.xml",
    tags: ["Rise/Fall", "MACD", "Progression"],
    description: "Watches MACD across timeframes for a bearish bias, grinds entries with a progression stake step.",
    apply: () => {
      setContractMode("rise_fall");
      state.riseFallBias = "FALL";
    },
  },
  {
    id: "under9_filter",
    name: "Under 9 Balanced 9-Count Filter",
    source: "under9_balanced_9count_filter.xml",
    tags: ["Over/Under", "V100 (1s)", "Filter"],
    description: "Waits for a 9-count digit filter on Volatility 100 (1s) before buying Under 9.",
    apply: () => {
      setContractMode("over_under");
      state.symbol = "1HZ100V";
      if ($("symbol")) $("symbol").value = "1HZ100V";
      $("ou-barrier").value = "9";
      $("ou-direction").value = "DIGITUNDER";
      $("ou-min-bias").value = "65";
      $("ou-sample").value = "20";
    },
  },
  {
    id: "v100_progression_summary",
    name: "Rise/Fall V100 (1s) Progression Daily Summary",
    source: "rise_fall_v100_1s_progression_daily_summary.xml",
    tags: ["Rise/Fall Equals", "V100 (1s)", "Progression"],
    description: "Runs Rise/Fall Equals on Volatility 100 (1s) with a progression stake ladder and daily P&L summary.",
    apply: () => {
      setContractMode("rise_fall");
      state.symbol = "1HZ100V";
      if ($("symbol")) $("symbol").value = "1HZ100V";
    },
  },
  {
    id: "digit_momentum_balanced",
    name: "Rise/Fall Digit Momentum Balanced",
    source: "rise_fall_digit_momentum_balanced.xml",
    tags: ["Rise/Fall Equals", "V100 (1s)", "Momentum"],
    description: "Tracks digit momentum (current vs previous ticks) on V100 (1s) for balanced Rise/Fall entries.",
    apply: () => {
      setContractMode("rise_fall");
      state.symbol = "1HZ100V";
      if ($("symbol")) $("symbol").value = "1HZ100V";
    },
  },
  {
    id: "five_odds_pullback",
    name: "Five Odds Break Pullback Even",
    source: "use_trade7smart-five-odds-break-pullback-even-dbot.xml",
    tags: ["Odd/Even", "5 Odds", "Pullback"],
    description: "Classic 5-odds-streak pullback into Even — this matches Trade7Smart's built-in Odd/Even engine directly.",
    apply: () => {
      setContractMode("odds_even");
      $("preferred-odds").value = "5";
      $("trade-direction").value = "DIGITEVEN";
    },
  },
  {
    id: "i_digit_v2",
    name: "I-Digit V2.0 Update",
    source: "I_DIGIT_V2_0_UPDATE.xml",
    tags: ["Over/Under", "R_100", "Prediction"],
    description: "Digit-prediction Over/Under bot with martingale-style staking on R_100.",
    apply: () => {
      setContractMode("over_under");
      $("ou-barrier").value = "5";
      $("ou-direction").value = "DIGITOVER";
      $("ou-min-bias").value = "60";
    },
  },
  {
    id: "tick_pip_rf",
    name: "Tick-Pip Rise/Fall",
    source: "Tick-Pip_Rf.xml",
    tags: ["Rise/Fall", "Tick analysis"],
    description: "Measures pip movement per tick to confirm direction before a Rise/Fall entry.",
    apply: () => {
      setContractMode("rise_fall");
    },
  },
];

// Per-bot editable settings (overrides defaults when set)
const strategyBotOverrides = {};

function renderStrategyBotGrid() {
  const holder = $("strategy-bot-grid");
  if (!holder) return;
  holder.innerHTML = "";
  STRATEGY_BOTS.forEach((bot) => {
    const card = document.createElement("article");
    card.className = "panel strategy-card";
    const isActive = state.activeStrategyId === bot.id;
    const ov = strategyBotOverrides[bot.id] || {};
    const stake = ov.stake ?? 0.35;
    const ticks = ov.ticks ?? 1;
    const market = ov.market ?? "1HZ100V";
    const recovStart = ov.recoveryStart ?? 4;
    const maxRecov = ov.maxRecovery ?? 7;
    const editOpen = ov._editOpen || false;

    card.innerHTML = `
      <div class="strategy-card-head">
        <strong>${bot.name}</strong>
        ${isActive ? '<span class="strategy-live-tag">LIVE</span>' : ""}
      </div>
      <p class="strategy-card-desc">${bot.description}</p>
      <div class="strategy-tags">${bot.tags.map((t) => `<span>${t}</span>`).join("")}</div>
      <div class="strategy-edit-panel ${editOpen ? "" : "hidden"}" id="edit-panel-${bot.id}">
        <div class="strategy-edit-grid">
          <label><span>Market</span>
            <select class="se-market">
              <option value="1HZ100V" ${market === "1HZ100V" ? "selected" : ""}>Vol 100 (1s)</option>
              <option value="1HZ75V" ${market === "1HZ75V" ? "selected" : ""}>Vol 75 (1s)</option>
              <option value="1HZ50V" ${market === "1HZ50V" ? "selected" : ""}>Vol 50 (1s)</option>
              <option value="1HZ25V" ${market === "1HZ25V" ? "selected" : ""}>Vol 25 (1s)</option>
              <option value="1HZ10V" ${market === "1HZ10V" ? "selected" : ""}>Vol 10 (1s)</option>
            </select>
          </label>
          <label><span>Stake</span><input class="se-stake" type="number" min="0.35" step="0.01" value="${stake}" /></label>
          <label><span>Ticks</span>
            <select class="se-ticks">
              ${[1,2,3,4,5,6,7,8,9,10].map((n) => `<option value="${n}" ${ticks === n ? "selected" : ""}>${n} tick${n > 1 ? "s" : ""}</option>`).join("")}
            </select>
          </label>
          <label><span>Recovery Start</span><input class="se-recovery-start" type="number" min="0" max="5" value="${recovStart}" /></label>
          <label><span>Max Recovery</span><input class="se-max-recovery" type="number" min="1" value="${maxRecov}" /></label>
        </div>
        <div class="strategy-edit-actions">
          <button type="button" class="ghost-button se-save-btn" data-bot="${bot.id}">Save Settings</button>
          <button type="button" class="run-button se-run-btn" data-bot="${bot.id}">Run with These Settings</button>
        </div>
      </div>
      <div class="strategy-card-actions">
        <button type="button" class="ghost-button strategy-edit-btn" data-bot="${bot.id}">${editOpen ? "Close Edit" : "Edit"}</button>
        <button type="button" class="ghost-button strategy-run-btn" data-bot="${bot.id}">${isActive ? "Stop" : "Run"}</button>
      </div>
    `;
    holder.appendChild(card);
  });

  // Edit toggle
  holder.querySelectorAll(".strategy-edit-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.bot;
      if (!strategyBotOverrides[id]) strategyBotOverrides[id] = {};
      strategyBotOverrides[id]._editOpen = !strategyBotOverrides[id]._editOpen;
      renderStrategyBotGrid();
    });
  });

  // Save overrides
  holder.querySelectorAll(".se-save-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.bot;
      const panel = document.getElementById(`edit-panel-${id}`);
      if (!strategyBotOverrides[id]) strategyBotOverrides[id] = {};
      strategyBotOverrides[id].stake = Number(panel.querySelector(".se-stake").value) || 0.35;
      strategyBotOverrides[id].ticks = Number(panel.querySelector(".se-ticks").value) || 1;
      strategyBotOverrides[id].market = panel.querySelector(".se-market").value;
      strategyBotOverrides[id].recoveryStart = Number(panel.querySelector(".se-recovery-start").value) || 4;
      strategyBotOverrides[id].maxRecovery = Number(panel.querySelector(".se-max-recovery").value) || 7;
      toast("Settings saved for this bot.", "good");
    });
  });

  // Run with custom settings
  holder.querySelectorAll(".se-run-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.bot;
      const panel = document.getElementById(`edit-panel-${id}`);
      if (!strategyBotOverrides[id]) strategyBotOverrides[id] = {};
      strategyBotOverrides[id].stake = Number(panel.querySelector(".se-stake").value) || 0.35;
      strategyBotOverrides[id].ticks = Number(panel.querySelector(".se-ticks").value) || 1;
      strategyBotOverrides[id].market = panel.querySelector(".se-market").value;
      strategyBotOverrides[id].recoveryStart = Number(panel.querySelector(".se-recovery-start").value) || 4;
      strategyBotOverrides[id].maxRecovery = Number(panel.querySelector(".se-max-recovery").value) || 7;
      const bot = STRATEGY_BOTS.find((b) => b.id === id);
      if (bot) runStrategyBot(bot, strategyBotOverrides[id]);
    });
  });

  // Run / Stop
  holder.querySelectorAll(".strategy-run-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const bot = STRATEGY_BOTS.find((b) => b.id === btn.dataset.bot);
      if (!bot) return;
      if (state.activeStrategyId === bot.id) {
        stopStrategyBot();
      } else {
        runStrategyBot(bot, strategyBotOverrides[bot.id] || {});
      }
    });
  });
}

function runStrategyBot(bot, overrides = {}) {
  if (!state.authorized) {
    toast("Connect your account first.", "danger");
    return;
  }
  bot.apply();
  // Apply overrides
  if (overrides.market) {
    state.symbol = overrides.market;
    if ($("symbol")) $("symbol").value = overrides.market;
  }
  if (overrides.stake && $("stake")) $("stake").value = String(overrides.stake);
  if (overrides.ticks && $("trade-ticks")) $("trade-ticks").value = String(overrides.ticks);
  if (overrides.recoveryStart && $("recovery-start-losses")) $("recovery-start-losses").value = String(overrides.recoveryStart);
  if (overrides.maxRecovery && $("max-recovery-steps")) $("max-recovery-steps").value = String(overrides.maxRecovery);

  state.activeStrategyId = bot.id;
  state.activeStrategyName = bot.name;
  const tag = $("strategy-watch-tag");
  if (tag) {
    tag.textContent = `Watching: ${bot.name}`;
    tag.classList.remove("hidden");
  }
  toast(`Running strategy: ${bot.name}`, "good");
  journal(`Strategy Bot started: ${bot.name} | Market: ${state.symbol} | Stake: ${$("stake")?.value ?? "--"}.`, "trade");
  startBot();
  renderStrategyBotGrid();
}

function stopStrategyBot() {
  state.activeStrategyId = null;
  state.activeStrategyName = null;
  const tag = $("strategy-watch-tag");
  if (tag) tag.classList.add("hidden");
  stopBot();
  renderStrategyBotGrid();
}

function initRiseFallButtons() {
  $("rf-buy-rise")?.addEventListener("click", () => buyRiseFall("RISE"));
  $("rf-buy-fall")?.addEventListener("click", () => buyRiseFall("FALL"));
}
initRiseFallButtons();
safeInit(renderStrategyBotGrid, "renderStrategyBotGrid");
safeInit(initChartTypeToggle, "initChartTypeToggle");
safeInit(initHomeChart, "initHomeChart");

safeInit(connectPublicScanner, "connectPublicScanner");

/* ═══════════════════════════════════════════════════════════════
   OVER/UNDER COMBINED STRATEGY ANALYZER — standalone module
   No function redeclarations. Hooks via ouaOnTick + ouaNotifySettle.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  // ── Module state ──────────────────────────────────────────────
  const oua = {
    running: false,
    digitBuf: [],      // up to 30 digits
    s1PauseTicks: 0,
    s3PauseTicks: 0,
    s2Leg: "over0",    // "over0" | "under7"
    s2Step: 0,
    lastStratLabel: "",
    tradePending: false,
    feed: [],
  };

  // ── Helpers ───────────────────────────────────────────────────
  function streakGt0(arr) {
    let n = 0;
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i] > 0) n++; else break;
    }
    return n;
  }

  function streakMatchLeg(arr, leg) {
    let n = 0;
    for (let i = arr.length - 1; i >= 0; i--) {
      const ok = leg === "over0" ? arr[i] > 0 : arr[i] <= 6;
      if (ok) n++; else break;
    }
    return n;
  }

  function gapSinceLast0(arr) {
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i] === 0) return arr.length - 1 - i;
    }
    return arr.length;
  }

  function el(id) { return document.getElementById(id); }

  function setPill(id, text, cls) {
    const e = el(id); if (!e) return;
    e.textContent = text;
    e.className = "oua-strat-pill" + (cls ? " " + cls : "");
  }

  function setCard(id, cls) {
    const e = el(id); if (!e) return;
    e.className = "oua-strat-card" + (cls ? " " + cls : "");
  }

  function buildStrip(id, digits, highlightFn) {
    const e = el(id); if (!e) return;
    e.innerHTML = "";
    digits.forEach((d, i) => {
      const chip = document.createElement("i");
      chip.textContent = d;
      const c = highlightFn(d, i, digits);
      if (c) chip.className = c;
      e.appendChild(chip);
    });
  }

  function setArrow(dir) {
    const a = el("oua-arrow"); if (!a) return;
    if (dir === "up") { a.textContent = "↑"; a.className = "oua-arrow up"; }
    else if (dir === "dn") { a.textContent = "↓"; a.className = "oua-arrow dn"; }
    else { a.textContent = "→"; a.className = "oua-arrow"; }
  }

  function setTxt(id, txt) { const e = el(id); if (e) e.textContent = txt; }

  function setBadge(mode) {
    const e = el("oua-status-badge"); if (!e) return;
    const map = {
      stopped:  ["STOPPED",  "oua-badge oua-badge--stopped"],
      scanning: ["SCANNING", "oua-badge oua-badge--scanning"],
      ready:    ["READY",    "oua-badge oua-badge--ready"],
      trading:  ["TRADING",  "oua-badge oua-badge--trading"],
    };
    const [txt, cls] = map[mode] || map.stopped;
    e.textContent = txt; e.className = cls;
  }

  // ── Trade feed ────────────────────────────────────────────────
  function feedLog(contract, rec, outcome) {
    oua.feed.unshift({ time: new Date().toLocaleTimeString(), contract, rec, outcome });
    if (oua.feed.length > 50) oua.feed.pop();
    renderFeed();
  }

  function renderFeed() {
    const list = el("oua-feed"); if (!list) return;
    list.innerHTML = "";
    oua.feed.forEach((item) => {
      const li = document.createElement("li");
      li.className = item.outcome === "WIN" ? "win" : item.outcome === "LOSS" ? "loss" : "exec";
      li.innerHTML = `<span class="oua-feed-time">${item.time}</span><span class="oua-feed-rec">${item.contract}</span><span>${item.rec}</span><span class="oua-feed-result">${item.outcome}</span>`;
      list.appendChild(li);
    });
  }

  // ── Fire trade via existing proposal/buy flow ─────────────────
  function fireTrade(contractType, barrier, stratLabel) {
    if (!state.authorized) return;
    if (state.activeTrade || oua.tradePending) return;

    const settings = getSettings();
    const stake = Number(state.currentStake.toFixed(2));

    // Override mode settings to match what we're firing
    state.symbol = $("symbol").value;

    oua.tradePending = true;
    oua.lastStratLabel = stratLabel;
    state.activeTrade = true;
    state.tradeEntryDigit = state.lastDigit;
    state.tradeEndDigit = null;
    startContractCursor();

    feedLog(contractType === "DIGITOVER" ? `Over ${barrier}` : `Under ${barrier}`, stratLabel, "EXEC");
    journal({ signal: `OUA: ${stratLabel}`, stake: `${stake} ${state.currency}`, result: "EXEC", level: state.lossCount }, "trade");
    playTone("trade");
    toast(`OUA: ${stratLabel} firing — ${contractType === "DIGITOVER" ? "Over" : "Under"} ${barrier}`, "good");

    setBadge("trading");

    if (settings.executionMode === "paper") {
      setTimeout(() => {
        const digit = Math.floor(Math.random() * 10);
        const won = contractType === "DIGITOVER" ? digit > barrier : digit < barrier;
        const profit = won ? stake * 0.91 : -stake;
        oua.tradePending = false;
        settleTrade(profit, digit);
      }, 450);
      return;
    }

    send(
      { proposal: 1, amount: stake, basis: "stake", currency: state.currency,
        duration: settings.ticks || 1, duration_unit: "t", symbol: state.symbol,
        contract_type: contractType, barrier: String(barrier) },
      "proposal"
    );
    // Safety timeout to unblock tradePending if no settle arrives
    setTimeout(() => { oua.tradePending = false; }, 10000);
  }

  // ── Public hook: called from settleTrade (injected above) ─────
  window.ouaNotifySettle = function (profit) {
    oua.tradePending = false;
    const won = profit > 0;
    const last = oua.feed[0];
    if (last && last.outcome === "EXEC") {
      last.outcome = won ? "WIN" : "LOSS";
      renderFeed();
    }
    const label = oua.lastStratLabel || "";
    if (!won) {
      if (label.includes("S1")) { oua.s1PauseTicks = 1; }
      if (label.includes("S3")) { oua.s3PauseTicks = 2; }
      if (label.includes("S2")) {
        oua.s2Step++;
        oua.s2Leg = oua.s2Leg === "over0" ? "under7" : "over0";
      }
    } else {
      if (label.includes("S2")) { oua.s2Step = 0; oua.s2Leg = "over0"; }
    }
    if (oua.running) setBadge("scanning");
  };

  // ── Per-strategy renderers ────────────────────────────────────
  function renderS1(buf, biasPct, streak, ready, biasOk) {
    setTxt("oua-s1-bias", biasPct + "%");
    setTxt("oua-s1-streak", streak);
    setTxt("oua-s1-signal", ready ? "FIRE ↑ Over 0" : biasOk ? `Streak ${streak}/4` : "Low bias");
    setCard("oua-s1", ready ? "oua-ready" : "");
    setPill("oua-s1-pill", ready ? "READY" : "Watching", ready ? "ready" : "");
    buildStrip("oua-s1-strip", buf, (d, i, arr) => {
      const inStreak = i >= arr.length - streak && streak > 0 && d > 0;
      if (d === 0) return "oua-zero";
      if (inStreak) return "oua-streak";
      return "oua-hot";
    });
  }

  function renderS2(buf, biasPct, streak, ready) {
    const legLabel = oua.s2Leg === "over0" ? "Over 0" : "Under 7";
    setTxt("oua-s2-leg", legLabel);
    setTxt("oua-s2-bias", biasPct + "%");
    setTxt("oua-s2-streak", streak);
    setTxt("oua-s2-step", oua.s2Step);
    const arrow = oua.s2Leg === "over0" ? "↑" : "↓";
    setTxt("oua-s2-signal", ready ? `FIRE ${arrow} ${legLabel}` : `Streak ${streak}/3`);
    setCard("oua-s2", ready ? "oua-ready" : "");
    setPill("oua-s2-pill", ready ? "READY" : "Watching", ready ? "ready" : "");
    buildStrip("oua-s2-strip", buf, (d) => {
      if (oua.s2Leg === "over0") return d === 0 ? "oua-zero" : "oua-hot";
      return d > 6 ? "oua-zero" : "oua-hot";
    });
  }

  function renderS3(buf, zeros, gap, ready, biasOk) {
    setTxt("oua-s3-zeros", zeros);
    setTxt("oua-s3-gap", `${gap} ticks since last 0`);
    setTxt("oua-s3-signal", ready ? `FIRE ↑ Pattern (gap:${gap})` : biasOk ? `Gap ${gap}/5` : `Zeros:${zeros} need≤2`);
    setCard("oua-s3", ready ? "oua-ready" : "");
    setPill("oua-s3-pill", ready ? "READY" : "Watching", ready ? "ready" : "");
    buildStrip("oua-s3-strip", buf, (d, i, arr) => {
      if (d === 0) return "oua-zero";
      let lastZ = -1;
      for (let j = arr.length - 1; j >= 0; j--) { if (arr[j] === 0) { lastZ = j; break; } }
      if (lastZ >= 0 && i > lastZ) return "oua-streak";
      return "oua-hot";
    });
  }

  // ── Main tick processor (called from handleTick hook) ─────────
  window.ouaOnTick = function (digit) {
    if (!oua.running) return;
    if (state.activeTrade || oua.tradePending) {
      setBadge("trading");
      return;
    }

    oua.digitBuf.push(digit);
    if (oua.digitBuf.length > 30) oua.digitBuf.shift();
    const buf = oua.digitBuf;
    if (buf.length < 5) return;

    // Decrement pause counters
    if (oua.s1PauseTicks > 0) oua.s1PauseTicks--;
    if (oua.s3PauseTicks > 0) oua.s3PauseTicks--;

    // ── Strategy 1: Pro Over 0 ──────────────────────────────
    const s1Buf = buf.slice(-30);
    const s1BiasPct = Math.round((s1Buf.filter((d) => d > 0).length / s1Buf.length) * 100);
    const s1Streak = streakGt0(s1Buf);
    const s1BiasOk = s1BiasPct >= 75;
    const s1Ready = s1BiasOk && s1Streak >= 4 && oua.s1PauseTicks === 0;

    // ── Strategy 2: Over 0 + Under 7 Recovery ───────────────
    const s2Buf = buf.slice(-20);
    let s2BiasPct, s2Streak;
    if (oua.s2Leg === "over0") {
      s2BiasPct = Math.round((s2Buf.filter((d) => d > 0).length / s2Buf.length) * 100);
      s2Streak = streakMatchLeg(s2Buf, "over0");
    } else {
      s2BiasPct = Math.round((s2Buf.filter((d) => d <= 6).length / s2Buf.length) * 100);
      s2Streak = streakMatchLeg(s2Buf, "under7");
    }
    const s2Ready = s2BiasPct >= 70 && s2Streak >= 3;

    // ── Strategy 3: Pattern Over 0 ──────────────────────────
    const s3Buf = buf.slice(-15);
    const s3Zeros = s3Buf.filter((d) => d === 0).length;
    const s3Gap = gapSinceLast0(buf);
    const s3BiasOk = s3Zeros <= 2;
    const s3Ready = s3BiasOk && s3Gap >= 5 && oua.s3PauseTicks === 0 && digit !== 0;

    // ── Render all three cards ───────────────────────────────
    renderS1(s1Buf, s1BiasPct, s1Streak, s1Ready, s1BiasOk);
    renderS2(s2Buf, s2BiasPct, s2Streak, s2Ready);
    renderS3(s3Buf, s3Zeros, s3Gap, s3Ready, s3BiasOk);

    // ── Decide signal & fire ─────────────────────────────────
    const anyReady = s1Ready || s2Ready || s3Ready;
    setBadge(anyReady ? "ready" : "scanning");

    if (s1Ready) {
      setArrow("up");
      setTxt("oua-signal-label", "Over 0 — Pro Strategy");
      setTxt("oua-signal-type", "OVER 0 · bias " + s1BiasPct + "% · streak " + s1Streak);
      fireTrade("DIGITOVER", 0, "S1 Pro Over 0");
      return;
    }
    if (s3Ready) {
      setArrow("up");
      setTxt("oua-signal-label", "Over 0 — Pattern Strategy");
      setTxt("oua-signal-type", "OVER 0 · gap " + s3Gap + " ticks · zeros " + s3Zeros);
      fireTrade("DIGITOVER", 0, "S3 Pattern Over 0");
      return;
    }
    if (s2Ready) {
      if (oua.s2Leg === "over0") {
        setArrow("up");
        setTxt("oua-signal-label", "Over 0 — Recovery Leg");
        setTxt("oua-signal-type", "OVER 0 · bias " + s2BiasPct + "% · step " + oua.s2Step);
        fireTrade("DIGITOVER", 0, "S2 Over0+U7 [Over0]");
      } else {
        setArrow("dn");
        setTxt("oua-signal-label", "Under 7 — Recovery Leg");
        setTxt("oua-signal-type", "UNDER 7 · bias " + s2BiasPct + "% · step " + oua.s2Step);
        fireTrade("DIGITUNDER", 7, "S2 Over0+U7 [Under7]");
      }
      return;
    }

    // Idle
    setArrow("");
    setTxt("oua-signal-label", "Scanning — waiting for signal");
    setTxt("oua-signal-type", "");
  };

  // ── Start / Stop ─────────────────────────────────────────────
  function ouaStart() {
    if (!state.authorized) {
      toast("Connect your account first.", "danger");
      return;
    }
    // Switch to over_under mode
    setContractMode("over_under");
    $("ou-barrier").value = "0";
    $("ou-direction").value = "DIGITOVER";

    oua.running = true;
    oua.tradePending = false;
    oua.s1PauseTicks = 0;
    oua.s3PauseTicks = 0;
    oua.s2Leg = "over0";
    oua.s2Step = 0;
    // Seed buffer from existing digit history
    oua.digitBuf = state.digitHistory.slice(-30).slice();

    const btn = el("oua-run-btn");
    if (btn) { btn.textContent = "Stop"; btn.style.background = "var(--danger)"; }
    setBadge("scanning");
    toast("OUA Analyzer running — 3 strategies scanning.", "good");
    journal("OUA Combined Analyzer started.", "trade");
    updateDashboard();
  }

  function ouaStop() {
    oua.running = false;
    oua.tradePending = false;
    const btn = el("oua-run-btn");
    if (btn) { btn.textContent = "Run"; btn.style.background = ""; }
    setBadge("stopped");
    setArrow("");
    setTxt("oua-signal-label", "Stopped — press Run to scan");
    setTxt("oua-signal-type", "");
    toast("OUA Analyzer stopped.", "warn");
    journal("OUA Analyzer stopped.", "warn");
  }

  // ── Bind controls after DOM ready ────────────────────────────
  document.addEventListener("DOMContentLoaded", function () {
    const runBtn = el("oua-run-btn");
    if (runBtn) runBtn.addEventListener("click", () => oua.running ? ouaStop() : ouaStart());
    const clearBtn = el("oua-clear-feed");
    if (clearBtn) clearBtn.addEventListener("click", () => { oua.feed = []; renderFeed(); });
  });

  // Also bind immediately in case DOMContentLoaded already fired
  (function tryBind() {
    const runBtn = el("oua-run-btn");
    if (runBtn && !runBtn._ouaBound) {
      runBtn._ouaBound = true;
      runBtn.addEventListener("click", () => oua.running ? ouaStop() : ouaStart());
    }
    const clearBtn = el("oua-clear-feed");
    if (clearBtn && !clearBtn._ouaBound) {
      clearBtn._ouaBound = true;
      clearBtn.addEventListener("click", () => { oua.feed = []; renderFeed(); });
    }
  })();

})(); // end OUA IIFE

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js?v=v5-fresh-20260621")
    .then((registration) => registration.update?.())
    .catch(() => {});
}
