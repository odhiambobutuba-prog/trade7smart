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
  copilotSignal: null,
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
  pushTickToCandle(symbol, quote, Number(tick.epoch) || Math.floor(Date.now() / 1000));
  maybeTradeAiMarket(symbol);
  maybeTriggerOverUnderTriple(symbol);
  
  // Copilot AI analysis
  const settings = getSettings();
  const copilotSignal = copilotAnalyzeTick(tick, symbol, settings);
  state.copilotSignal = copilotSignal;
  updateCopilotDisplay(copilotSignal);
  
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

  // Copilot triggers trade directly when signal is ready
  if (state.running && !state.activeTrade && copilotSignal.recommendation) {
    triggerTrade(false);
  }
}

function updateCopilotDisplay(signal) {
  if (!signal) return;
  
  // Update analyzer panel with Copilot's live scanning activity
  if ($("signal-title")) {
    $("signal-title").textContent = `Copilot: ${signal.trend}`;
  }
  
  if ($("signal-copy")) {
    let copyText = `Scanning ${signal.symbol} - Trend: ${signal.trend}`;
    if (signal.recommendation) {
      copyText += ` | Signal: ${signal.recommendation}`;
    }
    if (signal.oddStreak > 0) {
      copyText += ` | Odds Streak: ${signal.oddStreak}`;
    }
    if (signal.digitStreak > 1) {
      copyText += ` | Digit Streak: ${signal.digitStreak}x${signal.repeatDigit}`;
    }
    $("signal-copy").textContent = copyText;
  }
  
  // Update signal type tag
  if ($("signal-type-tag")) {
    const settings = getSettings();
    $("signal-type-tag").textContent = settings.contractMode.toUpperCase();
  }
  
  // Update market tag
  if ($("signal-market-tag")) {
    $("signal-market-tag").textContent = signal.symbol;
  }
  
  // Update trend arrow and label
  if ($("analyzer-trend-arrow") && $("analyzer-trend-label")) {
    const arrow = $("analyzer-trend-arrow");
    const label = $("analyzer-trend-label");
    if (signal.trend === "RISING") {
      arrow.textContent = "↑";
      arrow.style.color = "#22c55e";
      label.textContent = "Rising";
    } else if (signal.trend === "FALLING") {
      arrow.textContent = "↓";
      arrow.style.color = "#f87171";
      label.textContent = "Falling";
    } else {
      arrow.textContent = "→";
      arrow.style.color = "#6b7280";
      label.textContent = "Flat";
    }
  }
  
  // Update confidence display (Copilot confidence, no gating)
  const confBar = $("analyzer-conf-bar");
  const confPct = $("analyzer-conf-pct");
  const confGate = $("analyzer-conf-gate");
  if (confBar) {
    confBar.style.width = `${signal.confidence}%`;
    confBar.style.background = "#22c55e";
  }
  if (confPct) confPct.textContent = `${signal.confidence}%`;
  if (confGate) {
    confGate.textContent = signal.recommendation ? "✅ SIGNAL READY" : "SCANNING";
    confGate.classList.toggle("gate-ready", !!signal.recommendation);
  }
  
  // Update entry ready status
  if ($("entry-ready")) {
    $("entry-ready").textContent = signal.recommendation ? "ENTRY READY" : "SCANNING";
    $("entry-ready").classList.toggle("ready", !!signal.recommendation);
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
    bulkCount: Math.min(9, Math.max(1, Number($("bulk-trade-count")?.value) || 1)),
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

// Copilot AI - Real-time tick analysis and trade recommendations
function copilotAnalyzeTick(tick, symbol, settings) {
  const quote = Number(tick.quote);
  const digit = Number(quote.toFixed(2).replace(".", "").slice(-1));
  const recentDigits = state.digitHistory.slice(-20);
  
  // Trend analysis
  const last5 = recentDigits.slice(-5);
  const first5avg = last5.slice(0, 2).reduce((a, b) => a + b, 0) / 2;
  const last5avg = last5.slice(-2).reduce((a, b) => a + b, 0) / 2;
  let trend = "FLAT";
  let trendDirection = 0;
  if (last5avg > first5avg + 0.5) {
    trend = "RISING";
    trendDirection = 1;
  } else if (last5avg < first5avg - 0.5) {
    trend = "FALLING";
    trendDirection = -1;
  }
  
  // Odd/Even analysis
  const oddStreak = state.oddStreak;
  const oddSignal = oddStreak >= settings.preferredOdds;
  const oddRecommendation = oddSignal ? (settings.tradeDirection === "DIGITEVEN" ? "EVEN" : "ODD") : null;
  
  // Differ analysis
  const digitStreak = state.digitStreak;
  const differSignal = digitStreak >= settings.differTrigger;
  const differRecommendation = differSignal ? "DIFFER" : null;
  
  // Over/Under analysis
  const sample = state.digitHistory.slice(-settings.ouSample);
  const under = sample.filter((d) => d < settings.barrier).length;
  const over = sample.filter((d) => d > settings.barrier).length;
  const underPct = Math.round((under / sample.length) * 100);
  const overPct = Math.round((over / sample.length) * 100);
  const ouSignal = overPct >= settings.ouMinBias || underPct >= settings.ouMinBias;
  const ouRecommendation = ouSignal ? (overPct >= underPct ? "OVER" : "UNDER") : null;
  
  // Rise/Fall analysis (based on trend)
  const rfRecommendation = trendDirection !== 0 ? (trendDirection > 0 ? "RISE" : "FALL") : null;
  
  // Overall recommendation based on contract mode
  let recommendation = null;
  let signalStrength = 0;
  
  switch (settings.contractMode) {
    case "odds_even":
      recommendation = oddRecommendation;
      signalStrength = oddStreak / settings.preferredOdds;
      break;
    case "differ":
      recommendation = differRecommendation;
      signalStrength = digitStreak / settings.differTrigger;
      break;
    case "over_under":
      recommendation = ouRecommendation;
      signalStrength = Math.max(overPct, underPct) / 100;
      break;
    case "rise_fall":
      recommendation = rfRecommendation;
      signalStrength = Math.abs(trendDirection);
      break;
  }
  
  // Copilot confidence (no gating, just for display)
  const confidence = Math.min(100, Math.round(signalStrength * 100));
  
  return {
    symbol,
    digit,
    trend,
    trendDirection,
    oddStreak,
    oddSignal,
    oddRecommendation,
    digitStreak,
    differSignal,
    differRecommendation,
    underPct,
    overPct,
    ouSignal,
    ouRecommendation,
    rfRecommendation,
    recommendation,
    confidence,
    signalStrength,
    timestamp: Date.now()
  };
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

  const bulkCount = Math.min(9, Math.max(1, settings.bulkCount || 1));
  if (bulkCount > 1) {
    state.bulkQueue = [];
    for (let i = 1; i < bulkCount; i++) {
      state.bulkQueue.push({ payload: buildProposalPayload(stake, settings) });
    }
    journal(`Bulk purchase queued: ${bulkCount} trades total (${label}, ${stake.toFixed(2)} ${state.currency} each).`, "trade");
    toast(`Bulk: ${bulkCount} trades queued — firing sequentially.`, "good");
  } else {
    state.bulkQueue = [];
  }
}

function canPlaceTrade(stake, settings) {
  if (stake > settings.maxStake) {
    stopForRisk(`Max stake blocked trade: ${stake.toFixed(2)} > ${settings.maxStake.toFixed(2)}.`);
    return false;
  }

  // Copilot AI - no confidence gating, trades execute directly on signals
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

  const tradeEntry = {
    time: new Date().toLocaleTimeString(),
    type: contractLabel(getSettings()),
    symbol: state.symbol,
    stake: state.currentStake,
    profit,
    endDigit,
    won: profit > 0,
  };
  state.tradeHistory = state.tradeHistory || [];
  state.tradeHistory.unshift(tradeEntry);
  if (state.tradeHistory.length > 50) state.tradeHistory.pop();
  renderTradeHistory();

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
    fireBulkQueueNext();
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
    $("bot-state").textContent = "Instant recovery - Copilot scanning";
    fireBulkQueueNext();
    if (!state.bulkQueue || state.bulkQueue.length === 0) {
      // Copilot will trigger next trade when signal is ready
      // No delay - instant re-entry enabled
      setTimeout(() => {
        if (state.running && !state.activeTrade && state.copilotSignal && state.copilotSignal.recommendation) {
          triggerTrade(state.lossCount >= getSettings().recoveryStartLosses);
        }
      }, 100);
    }
  }
  updateDashboard();
}

function fireBulkQueueNext() {
  if (!state.bulkQueue || state.bulkQueue.length === 0) return;
  const next = state.bulkQueue.shift();
  if (!next) return;
  setTimeout(() => {
    if (!state.authorized) return;
    state.activeTrade = true;
    state.tradeEndDigit = null;
    startContractCursor();
    send(next.payload, "proposal");
    journal(`Bulk queue: firing next trade (${state.bulkQueue.length} remaining).`, "trade");
  }, 300);
}

function enforceSessionAfterSettle() {
  const settings = getSettings();
  if (settings.sessionTargetProfit > 0 && state.dailyProfit >= settings.sessionTargetProfit) {
    toast(`Session profit target of ${settings.sessionTargetProfit.toFixed(2)} reached! Resetting session to 0.`, "good");
    journal(`Session target reached (+${state.dailyProfit.toFixed(2)}). Session profit reset to 0.`, "win");
    state.dailyProfit = 0;
  }
  if (settings.sessionMaxLoss > 0 && state.dailyProfit <= -settings.sessionMaxLoss) {
    toast("Daily loss threshold hit — resetting counters and pausing.", "danger");
    journal("Daily loss threshold hit. Counters reset to zero. Bot paused.", "loss");
    resetDailyStats();
    state.running = false;
    $("bot-state").textContent = "Daily reset";
  }
}

function resetDailyStats() {
  state.dailyProfit = 0;
  state.wins = 0;
  state.losses = 0;
  state.totalTrades = 0;
  state.lossCount = 0;
  state.cumulativeLoss = 0;
  state.cycleRecoveryDepth = 0;
  state.tradeHistory = [];
  state.lastAiScore = 0;
  renderTradeHistory();
  updateDashboard();
  journal("Daily stats auto-reset.", "trade");
}

function initDailyAutoReset() {
  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setHours(24, 0, 0, 0);
  const msUntilMidnight = nextMidnight - now;
  setTimeout(() => {
    resetDailyStats();
    toast("Daily auto-reset at midnight.", "good");
    setInterval(resetDailyStats, 86400000);
  }, msUntilMidnight);
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
  if ($("price-chart-container")) renderPriceChart();
  if ($("digit-prob-row")) renderDigitProbabilityRow();
  syncHomeTab();
  syncAnalyzerContractBadge();
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

  // Copilot AI - use copilotSignal for display instead of old logic
  if (state.copilotSignal) {
    updateCopilotDisplay(state.copilotSignal);
  } else {
    // Fallback to old logic if copilotSignal not available yet
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
  if (!list) return;
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
    $("rf-best-market").textContent = best.name;
    $("rf-best-direction").textContent = best.analysis.direction;
    $("rf-best-direction").className = best.analysis.direction === "RISE" ? "rf-rise" : "rf-fall";
    $("rf-best-confidence").textContent = `${Math.round(best.analysis.agreement * 100)}% agreement across ${best.analysis.validCount}/5 timeframes`;
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

  $("da-ai-score").textContent = `${score}%`;
  state.lastAiScore = score;
  $("da-ai-recommend").textContent = `Recommend: ${recommend}`;
  $("da-ai-reason").textContent = reason;
  $("da-ai-confidence-tag").textContent = score >= 70 ? "HIGH" : score >= 45 ? "MEDIUM" : "BETA";

  const ring = $("da-ai-ring");
  const circumference = 2 * Math.PI * 34;
  ring.style.strokeDasharray = `${circumference}`;
  ring.style.strokeDashoffset = `${circumference - (score / 100) * circumference}`;
  const card = $("da-ai-card");
  card.classList.toggle("ready", score >= 55);

  // Confidence bar + gate badge (removed - no longer restricts trades)
  const confBar = $("analyzer-conf-bar");
  const confPct = $("analyzer-conf-pct");
  const confGate = $("analyzer-conf-gate");
  if (confBar) {
    confBar.style.width = `${score}%`;
    confBar.style.background = "#22c55e";
  }
  if (confPct) confPct.textContent = `${score}%`;
  if (confGate) {
    confGate.textContent = "✅ ALWAYS READY";
    confGate.classList.add("gate-ready");
  }

  // Trend arrow
  const last5 = digits.slice(-5);
  const first5avg = last5.slice(0, 2).reduce((a, b) => a + b, 0) / 2;
  const last5avg = last5.slice(-2).reduce((a, b) => a + b, 0) / 2;
  const arrow = $("analyzer-trend-arrow");
  const trendLabel = $("analyzer-trend-label");
  if (arrow && trendLabel) {
    if (last5avg > first5avg + 0.5) {
      arrow.textContent = "↑"; arrow.style.color = "#22c55e"; trendLabel.textContent = "Rising";
    } else if (last5avg < first5avg - 0.5) {
      arrow.textContent = "↓"; arrow.style.color = "#f87171"; trendLabel.textContent = "Falling";
    } else {
      arrow.textContent = "→"; arrow.style.color = "#8b95a7"; trendLabel.textContent = "Flat";
    }
  }

  // Streak glow on digit strip
  const strip = $("digit-strip");
  if (strip) {
    strip.classList.toggle("streak-glow", eoStreak >= 5);
  }

  // Sparkline
  renderAnalyzerSparkline(digits.slice(-20));

  // Waveform
  renderAnalyzerWaveform(digits.slice(-40));
}

function renderAnalyzerSparkline(digits) {
  const canvas = $("analyzer-sparkline");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (digits.length < 2) return;
  const min = Math.min(...digits);
  const max = Math.max(...digits) || 1;
  const range = max - min || 1;
  ctx.beginPath();
  ctx.strokeStyle = "#22d3ee";
  ctx.lineWidth = 1.5;
  digits.forEach((d, i) => {
    const x = (i / (digits.length - 1)) * w;
    const y = h - ((d - min) / range) * (h - 4) - 2;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function renderAnalyzerWaveform(digits) {
  const canvas = $("analyzer-waveform");
  if (!canvas) return;
  canvas.width = canvas.offsetWidth || 300;
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const barW = w / digits.length;
  digits.forEach((d, i) => {
    const barH = (d / 9) * h;
    const isOdd = d % 2 === 1;
    ctx.fillStyle = isOdd ? "rgba(34,211,238,0.7)" : "rgba(139,92,246,0.7)";
    ctx.fillRect(i * barW + 1, h - barH, barW - 2, barH);
  });
}

function renderTradeHistory() {
  const tbody = $("trade-history-tbody");
  const summaryRuns = $("summary-runs");
  const summaryWins = $("summary-wins");
  const summaryLosses = $("summary-losses");
  const summaryWinrate = $("summary-winrate");
  const summaryStake = $("summary-stake");
  const summaryPnl = $("summary-pnl");

  const trades = state.tradeHistory || [];
  const wins = trades.filter((t) => t.won).length;
  const losses = trades.filter((t) => !t.won).length;
  const totalStake = trades.reduce((a, t) => a + (t.stake || 0), 0);
  const totalPnl = trades.reduce((a, t) => a + (t.profit || 0), 0);
  const winRate = trades.length ? ((wins / trades.length) * 100).toFixed(1) : "0.0";

  if (summaryRuns) summaryRuns.textContent = trades.length;
  if (summaryWins) summaryWins.textContent = wins;
  if (summaryLosses) summaryLosses.textContent = losses;
  if (summaryWinrate) summaryWinrate.textContent = `${winRate}%`;
  if (summaryStake) summaryStake.textContent = totalStake.toFixed(2);
  if (summaryPnl) {
    summaryPnl.textContent = (totalPnl >= 0 ? "+" : "") + totalPnl.toFixed(2);
    summaryPnl.style.color = totalPnl >= 0 ? "#22c55e" : "#f87171";
  }

  if (!tbody) return;
  tbody.innerHTML = "";
  trades.slice(0, 50).forEach((t) => {
    const tr = document.createElement("tr");
    tr.className = t.won ? "trade-row-win" : "trade-row-loss";
    tr.innerHTML = `
      <td>${t.time}</td>
      <td>${t.type}</td>
      <td>${t.symbol}</td>
      <td>${(t.stake || 0).toFixed(2)}</td>
      <td style="color:${t.profit >= 0 ? "#22c55e" : "#f87171"}">${t.profit >= 0 ? "+" : ""}${(t.profit || 0).toFixed(2)}</td>
      <td><span class="trade-result-badge ${t.won ? "win" : "loss"}">${t.won ? "WIN" : "LOSS"}</span></td>
    `;
    tbody.appendChild(tr);
  });
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


state.chartType = state.chartType || "candles";
state.liveCandles = state.liveCandles || {}; // { symbol: [{time,open,high,low,close,volume}] }
state.lwChart = null;
state.lwSeries = null;
state.lwVolumeSeries = null;
state.lwMacdChart = null;
state.lwMacdLineSeries = null;
state.lwMacdSignalSeries = null;
state.lwMacdHistSeries = null;

function getLiveCandleBucket(symbol, epochSeconds, granularity = 5) {
  state.liveCandles[symbol] = state.liveCandles[symbol] || [];
  const arr = state.liveCandles[symbol];
  const bucketTime = Math.floor(epochSeconds / granularity) * granularity;
  const last = arr[arr.length - 1];
  if (last && last.time === bucketTime) return last;
  return null;
}

function pushTickToCandle(symbol, price, epochSeconds) {
  const granularity = 5;
  state.liveCandles[symbol] = state.liveCandles[symbol] || [];
  const arr = state.liveCandles[symbol];
  const bucketTime = Math.floor(epochSeconds / granularity) * granularity;
  let last = arr[arr.length - 1];
  if (last && last.time === bucketTime) {
    last.high = Math.max(last.high, price);
    last.low = Math.min(last.low, price);
    last.close = price;
    last.volume = (last.volume || 0) + 1;
  } else {
    arr.push({ time: bucketTime, open: price, high: price, low: price, close: price, volume: 1 });
    if (arr.length > 300) arr.shift();
    last = arr[arr.length - 1];
  }
  if (symbol === state.symbol) updateLiveChart(last, arr.length === 1);
}

function initLightweightChart() {
  const container = $("price-chart-container");
  const macdContainer = $("macd-chart-container");
  if (!container || typeof LightweightCharts === "undefined") return;

  state.lwChart = LightweightCharts.createChart(container, {
    layout: { background: { color: "transparent" }, textColor: "#8b95a7" },
    grid: {
      vertLines: { color: "rgba(255,255,255,0.05)" },
      horzLines: { color: "rgba(255,255,255,0.05)" },
    },
    timeScale: { timeVisible: true, secondsVisible: true, borderColor: "rgba(255,255,255,0.08)" },
    rightPriceScale: { borderColor: "rgba(255,255,255,0.08)" },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    handleScroll: true,
    handleScale: true,
  });

  state.lwSeries = state.lwChart.addCandlestickSeries({
    upColor: "#22c55e",
    downColor: "#f87171",
    borderUpColor: "#22c55e",
    borderDownColor: "#f87171",
    wickUpColor: "#22c55e",
    wickDownColor: "#f87171",
  });

  state.lwVolumeSeries = state.lwChart.addHistogramSeries({
    priceFormat: { type: "volume" },
    priceScaleId: "",
    scaleMargins: { top: 0.85, bottom: 0 },
    color: "rgba(34, 211, 238, 0.35)",
  });

  state.lwSmaSeries = state.lwChart.addLineSeries({
    color: "#fbbf24",
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: false,
  });

  state.lwChart.subscribeCrosshairMove((param) => {
    const readout = $("chart-crosshair-readout");
    if (!readout) return;
    if (!param.time || !param.seriesData?.size) {
      readout.classList.remove("visible");
      return;
    }
    const bar = param.seriesData.get(state.lwSeries);
    if (!bar) {
      readout.classList.remove("visible");
      return;
    }
    readout.classList.add("visible");
    readout.innerHTML = `O <b>${bar.open?.toFixed(2)}</b> H <b>${bar.high?.toFixed(2)}</b> L <b>${bar.low?.toFixed(2)}</b> C <b style="color:${bar.close >= bar.open ? "#22c55e" : "#f87171"}">${bar.close?.toFixed(2)}</b>`;
  });

  if (macdContainer) {
    state.lwMacdChart = LightweightCharts.createChart(macdContainer, {
      layout: { background: { color: "transparent" }, textColor: "#8b95a7" },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.04)" },
        horzLines: { color: "rgba(255,255,255,0.04)" },
      },
      timeScale: { visible: false },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.08)" },
      handleScroll: true,
      handleScale: true,
    });
    state.lwMacdHistSeries = state.lwMacdChart.addHistogramSeries({ color: "rgba(139, 92, 246, 0.5)" });
    state.lwMacdLineSeries = state.lwMacdChart.addLineSeries({ color: "#3b82f6", lineWidth: 1 });
    state.lwMacdSignalSeries = state.lwMacdChart.addLineSeries({ color: "#f59e0b", lineWidth: 1 });

    state.lwChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (range) state.lwMacdChart.timeScale().setVisibleLogicalRange(range);
    });
  }

  new ResizeObserver(() => {
    if (state.lwChart) state.lwChart.resize(container.clientWidth, container.clientHeight);
    if (state.lwMacdChart && macdContainer) state.lwMacdChart.resize(macdContainer.clientWidth, macdContainer.clientHeight);
  }).observe(container);
}

function applyChartTypeSeries() {
  if (!state.lwChart) return;
  if (state.lwSeries) state.lwChart.removeSeries(state.lwSeries);
  if (state.chartType === "candles") {
    state.lwSeries = state.lwChart.addCandlestickSeries({
      upColor: "#22c55e", downColor: "#f87171",
      borderUpColor: "#22c55e", borderDownColor: "#f87171",
      wickUpColor: "#22c55e", wickDownColor: "#f87171",
    });
  } else if (state.chartType === "area") {
    state.lwSeries = state.lwChart.addAreaSeries({
      lineColor: "#22d3ee", topColor: "rgba(34,211,238,0.3)", bottomColor: "rgba(34,211,238,0)",
    });
  } else {
    state.lwSeries = state.lwChart.addLineSeries({ color: "#22d3ee", lineWidth: 2 });
  }
  loadFullChartHistory();
}

function seriesPoint(candle) {
  if (state.chartType === "candles") return candle;
  return { time: candle.time, value: candle.close };
}

function smaSeries(closes, period) {
  const out = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      out.push(null);
      continue;
    }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j];
    out.push(sum / period);
  }
  return out;
}

function renderSmaSeries(arr) {
  if (!state.lwSmaSeries || !arr || arr.length < 20) return;
  const closes = arr.map((c) => c.close);
  const sma = smaSeries(closes, 20);
  state.lwSmaSeries.setData(
    arr.map((c, i) => ({ time: c.time, value: sma[i] })).filter((p) => p.value !== null)
  );
}

function loadFullChartHistory() {
  const arr = state.liveCandles[state.symbol] || [];
  if (!state.lwSeries || !arr.length) return;
  state.lwSeries.setData(arr.map(seriesPoint));
  if (state.lwVolumeSeries) {
    state.lwVolumeSeries.setData(arr.map((c) => ({ time: c.time, value: c.volume || 1, color: c.close >= c.open ? "rgba(34,197,94,0.4)" : "rgba(248,113,113,0.4)" })));
  }
  renderMacdSeries(arr);
  renderSmaSeries(arr);
}

function updateLiveChart(candle, isNewBar) {
  if (!state.lwSeries) return;
  state.lwSeries.update(seriesPoint(candle));
  if (state.lwVolumeSeries) {
    state.lwVolumeSeries.update({ time: candle.time, value: candle.volume || 1, color: candle.close >= candle.open ? "rgba(34,197,94,0.4)" : "rgba(248,113,113,0.4)" });
  }
  if (isNewBar || (state.liveCandles[state.symbol]?.length || 0) % 5 === 0) {
    renderMacdSeries(state.liveCandles[state.symbol]);
    renderSmaSeries(state.liveCandles[state.symbol]);
  }
}

function renderMacdSeries(arr) {
  if (!state.lwMacdLineSeries || !arr || arr.length < 30) return;
  const closes = arr.map((c) => c.close);
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = emaSeries(macdLine, 9);
  const histogram = macdLine.map((v, i) => v - signalLine[i]);
  state.lwMacdLineSeries.setData(arr.map((c, i) => ({ time: c.time, value: macdLine[i] })));
  state.lwMacdSignalSeries.setData(arr.map((c, i) => ({ time: c.time, value: signalLine[i] })));
  state.lwMacdHistSeries.setData(
    arr.map((c, i) => ({ time: c.time, value: histogram[i], color: histogram[i] >= 0 ? "rgba(34,197,94,0.5)" : "rgba(248,113,113,0.5)" }))
  );
}

function renderPriceChart() {
  if ($("price-chart-symbol-label")) {
    $("price-chart-symbol-label").textContent = `Live market chart — ${state.symbol}`;
  }
  if (!state.lwChart) return;
  if (state.lastChartSymbol !== state.symbol) {
    state.lastChartSymbol = state.symbol;
    loadFullChartHistory();
  }
}

function initChartTypeToggle() {
  document.querySelectorAll(".chart-type-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".chart-type-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.chartType = btn.dataset.chartType;
      applyChartTypeSeries();
    });
  });
}



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
  if ($("backtest-results")) {
    $("backtest-results").innerHTML = `
      <span>Triggers ${triggers}</span>
      <span>Wins ${wins}</span>
      <span>Losses ${losses}</span>
      <span>Win Rate ${total ? ((wins / total) * 100).toFixed(1) : "0.0"}%</span>
      <span>Net Profit ${net.toFixed(2)}</span>
      <span>Max Drawdown ${maxDrawdown.toFixed(2)}</span>
    `;
  }
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

const TAB_GROUPS = {
  "home-tab-key": ["home-tab", "bot-panel-anchor", "account-panel"],
  "ai-scanner-hero": ["ai-scanner-hero", "bot-panel-anchor", "account-panel"],
  "hero-grid": ["hero-grid", "bot-panel-anchor", "account-panel"],
  "charts-section": ["charts-section", "bot-panel-anchor", "account-panel"],
  recovery: ["pro-grid", "risk-grid", "bot-panel-anchor", "account-panel"],
  stats: ["analytics-grid", "scanner-grid", "bottom-grid", "bot-panel-anchor", "account-panel"],
  strategy: ["strategy", "bot-panel-anchor", "account-panel"],
  "pro-ai": ["pro-ai", "bot-panel-anchor", "account-panel"],
};

function initSectionNav() {
  const allSectionIds = Object.values(TAB_GROUPS).flat();

  function showTab(tabKey) {
    const activeIds = TAB_GROUPS[tabKey] || [];
    allSectionIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        // Only hide if it's not in the active group
        el.classList.toggle("tab-hidden", !activeIds.includes(id));
      }
    });
    document.querySelectorAll(".nav-pill").forEach((p) => p.classList.toggle("active", p.dataset.tab === tabKey));
    document.querySelectorAll(".bt-tab").forEach((p) => p.classList.toggle("active", p.dataset.tab === tabKey));
    const shell = document.querySelector(".terminal-shell");
    if (shell) shell.scrollTo({ top: 0 });
  }

  document.querySelectorAll(".nav-pill, .bt-tab").forEach((pill) => {
    pill.addEventListener("click", () => showTab(pill.dataset.tab));
  });

  // Initialize by showing home tab
  showTab("home-tab-key");
}



function hideLoader() {
  document.body.classList.add("loaded");
}

function initButubaPreloader() {
  // Enhanced BUTUBA preloader with 6-count animation
  const letters = document.querySelectorAll('.bp-letter');
  const counter = $("bp-counter");
  const progressFill = $("bp-progress-fill");
  const particlesContainer = $("bp-particles");
  
  // Create floating particles
  if (particlesContainer) {
    for (let i = 0; i < 20; i++) {
      const particle = document.createElement('div');
      particle.className = 'bp-particle';
      particle.style.left = `${Math.random() * 100}%`;
      particle.style.animationDelay = `${Math.random() * 3}s`;
      particle.style.animationDuration = `${2 + Math.random() * 2}s`;
      particlesContainer.appendChild(particle);
    }
  }
  
  // Animate letters one by one with sound
  letters.forEach((letter, i) => {
    letter.style.animationDelay = `${i * 0.4}s`;
    // Play subtle click sound (optional - requires audio context)
    setTimeout(() => {
      if (typeof playTone === 'function') {
        playTone('ready');
      }
    }, i * 400);
  });
  
  // Update progress counter
  let count = 0;
  const progressInterval = setInterval(() => {
    count++;
    if (counter) counter.textContent = `Loading... ${count}/6`;
    if (progressFill) progressFill.style.width = `${(count / 6) * 100}%`;
    
    if (count >= 6) {
      clearInterval(progressInterval);
      // Final burst animation
      if (counter) counter.textContent = '6/6 - Complete!';
      setTimeout(() => {
        const pre = $("butuba-preloader");
        if (pre) {
          pre.classList.add("hide");
          setTimeout(() => pre.remove(), 600);
        }
        // Hide the app loader as well
        hideLoader();
      }, 800);
    }
  }, 400);
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
  
  // Token visibility toggle
  const visibilityBtn = $("toggle-token-visibility");
  const tokenInput = $("api-token");
  if (visibilityBtn && tokenInput) {
    visibilityBtn.addEventListener("click", () => {
      const isPassword = tokenInput.type === "password";
      tokenInput.type = isPassword ? "text" : "password";
      visibilityBtn.textContent = isPassword ? "🙈" : "👁️";
    });
  }
  
  // Token strength indicator
  const tokenInput2 = $("api-token");
  const strengthFill = $("strength-fill");
  const strengthText = $("strength-text");
  if (tokenInput2 && strengthFill && strengthText) {
    tokenInput2.addEventListener("input", () => {
      const token = tokenInput2.value;
      let strength = "weak";
      if (token.length >= 20) strength = "strong";
      else if (token.length >= 12) strength = "medium";
      
      strengthFill.className = "strength-fill " + strength;
      strengthText.textContent = `Token strength: ${strength.charAt(0).toUpperCase() + strength.slice(1)}`;
    });
  }
  
  // Biometric login (placeholder - requires WebAuthn API)
  const biometricBtn = $("biometric-button");
  if (biometricBtn) {
    biometricBtn.addEventListener("click", () => {
      toast("Biometric login requires HTTPS and WebAuthn support", "warn");
    });
  }
  
  // QR code scan (placeholder - requires camera access)
  const qrBtn = $("qr-scan-button");
  if (qrBtn) {
    qrBtn.addEventListener("click", () => {
      toast("QR scanning requires camera permissions", "warn");
    });
  }
  
  // Load saved accounts
  loadSavedAccounts();
  
  // Connection health monitoring
  startConnectionHealthMonitor();
}

function loadSavedAccounts() {
  const saved = JSON.parse(localStorage.getItem("trade7smart_saved_accounts") || "[]");
  const savedList = $("saved-list");
  if (!savedList) return;
  
  savedList.innerHTML = "";
  saved.forEach((account, index) => {
    const chip = document.createElement("div");
    chip.className = `saved-account-chip ${account.type}`;
    chip.textContent = account.nickname || `${account.type} Account`;
    chip.addEventListener("click", () => {
      $("api-token").value = account.token;
      $("account-target").value = account.type;
      toast(`Loaded: ${account.nickname || account.type} account`, "good");
    });
    savedList.appendChild(chip);
  });
}

function saveAccount(token, type, nickname) {
  const saved = JSON.parse(localStorage.getItem("trade7smart_saved_accounts") || "[]");
  const expiry = $("token-expiry")?.value || "day";
  
  saved.push({
    token,
    type,
    nickname: nickname || `${type} Account ${saved.length + 1}`,
    expiry,
    savedAt: Date.now()
  });
  
  localStorage.setItem("trade7smart_saved_accounts", JSON.stringify(saved));
  loadSavedAccounts();
}

function startConnectionHealthMonitor() {
  const healthStatus = $("health-status");
  const healthPing = $("health-ping");
  
  if (!healthStatus || !healthPing) return;
  
  setInterval(() => {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      const start = Date.now();
      state.ws.send(JSON.stringify({ ping: 1 }));
      
      // Simulate ping (actual implementation would track pong response)
      const ping = Math.floor(Math.random() * 50) + 20;
      healthStatus.textContent = "Connected";
      healthStatus.style.color = "#22c55e";
      healthPing.textContent = `Ping: ${ping}ms`;
    } else {
      healthStatus.textContent = "Disconnected";
      healthStatus.style.color = "#ef4444";
      healthPing.textContent = "Ping: --ms";
    }
  }, 5000);
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

// Home Tab Enhancements
function initHomeTabFeatures() {
  // Quick trade buttons
  const quickRiseBtn = $("quick-buy-rise");
  const quickFallBtn = $("quick-buy-fall");
  
  if (quickRiseBtn) {
    quickRiseBtn.addEventListener("click", () => {
      if (!state.authorized) {
        toast("Connect your account first", "warn");
        return;
      }
      buyRiseFall("RISE");
    });
  }
  
  if (quickFallBtn) {
    quickFallBtn.addEventListener("click", () => {
      if (!state.authorized) {
        toast("Connect your account first", "warn");
        return;
      }
      buyRiseFall("FALL");
    });
  }
  
  // Session timer
  startSessionTimer();
  
  // Daily goal progress
  updateDailyGoalProgress();
  
  // Session stop button
  const sessionStopBtn = $("session-stop");
  if (sessionStopBtn) {
    sessionStopBtn.addEventListener("click", () => {
      stopBot();
      toast("Session stopped", "warn");
      journal("Session stopped by user", "trade");
    });
  }
  
  // Clear notifications
  const clearNotifBtn = $("clear-notifications");
  if (clearNotifBtn) {
    clearNotifBtn.addEventListener("click", () => {
      const notifList = $("notification-list");
      if (notifList) {
        notifList.innerHTML = "";
        toast("Notifications cleared", "good");
      }
    });
  }
  
  // Update live P&L ticker
  updateLivePnLTicker();
}

function startSessionTimer() {
  let sessionSeconds = 0;
  const timerEl = $("session-timer");
  
  setInterval(() => {
    if (state.running) {
      sessionSeconds++;
      const hours = Math.floor(sessionSeconds / 3600);
      const minutes = Math.floor((sessionSeconds % 3600) / 60);
      const seconds = sessionSeconds % 60;
      
      if (timerEl) {
        timerEl.textContent = 
          `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
      }
    }
  }, 1000);
}

function updateDailyGoalProgress() {
  const goalFill = $("goal-fill");
  const goalText = $("goal-text");
  const dailyGoal = 50; // Default daily goal
  
  if (goalFill && goalText) {
    const progress = Math.min(100, (state.dailyProfit / dailyGoal) * 100);
    goalFill.style.width = `${progress}%`;
    goalText.textContent = `$${state.dailyProfit.toFixed(2)} / $${dailyGoal}`;
    
    if (state.dailyProfit >= dailyGoal) {
      goalFill.style.background = "linear-gradient(90deg, #22c55e, #16a34a)";
      addNotification("🎉 Daily goal reached!", "success");
    }
  }
}

function updateLivePnLTicker() {
  const tickerPnl = $("ticker-pnl");
  
  if (tickerPnl) {
    const pnl = state.dailyProfit;
    tickerPnl.textContent = `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`;
    tickerPnl.style.color = pnl >= 0 ? '#22c55e' : '#ef4444';
  }
}

function updateActivePosition() {
  const positionContent = $("position-content");
  
  if (!positionContent) return;
  
  if (state.activeTrade) {
    positionContent.innerHTML = `
      <div class="position-details">
        <div class="position-row">
          <span class="pos-label">Market:</span>
          <span class="pos-value">${state.symbol}</span>
        </div>
        <div class="position-row">
          <span class="pos-label">Stake:</span>
          <span class="pos-value">$${state.currentStake.toFixed(2)}</span>
        </div>
        <div class="position-row">
          <span class="pos-label">Entry Digit:</span>
          <span class="pos-value">${state.tradeEntryDigit || '--'}</span>
        </div>
        <div class="position-countdown">
          <span class="countdown-label">Time remaining:</span>
          <span class="countdown-value" id="position-countdown">--</span>
        </div>
      </div>
    `;
  } else {
    positionContent.innerHTML = '<p class="no-position">No active position</p>';
  }
}

function updateWinRateGauge() {
  const gaugeFill = $("winrate-gauge-fill");
  const gaugeValue = $("winrate-gauge-value");
  
  if (!gaugeFill || !gaugeValue) return;
  
  const totalTrades = state.wins + state.losses;
  const winRate = totalTrades > 0 ? (state.wins / totalTrades) * 100 : 0;
  
  const circumference = 251.2;
  const offset = circumference - (winRate / 100) * circumference;
  
  gaugeFill.style.strokeDashoffset = offset;
  gaugeValue.textContent = `${Math.round(winRate)}%`;
  
  // Color based on win rate
  if (winRate >= 60) {
    gaugeFill.style.stroke = "#22c55e";
  } else if (winRate >= 40) {
    gaugeFill.style.stroke = "#f59e0b";
  } else {
    gaugeFill.style.stroke = "#ef4444";
  }
}

function addNotification(message, type = "info") {
  const notifList = $("notification-list");
  if (!notifList) return;
  
  const icons = {
    info: "ℹ️",
    success: "✅",
    warning: "⚠️",
    error: "❌"
  };
  
  const notifItem = document.createElement("div");
  notifItem.className = "notification-item";
  notifItem.innerHTML = `
    <span class="notification-icon">${icons[type] || icons.info}</span>
    <span class="notification-text">${message}</span>
    <span class="notification-time">Just now</span>
  `;
  
  notifList.insertBefore(notifItem, notifList.firstChild);
  
  // Keep only last 10 notifications
  while (notifList.children.length > 10) {
    notifList.removeChild(notifList.lastChild);
  }
}

function updateMarketPerformanceCards() {
  const marketCardsGrid = $("market-cards-grid");
  if (!marketCardsGrid) return;
  
  // Simulated market performance data
  const markets = [
    { name: "Volatility 100", pnl: 12.50, winrate: 65 },
    { name: "Volatility 75", pnl: 8.30, winrate: 58 },
    { name: "Volatility 50", pnl: -2.10, winrate: 48 },
    { name: "Volatility 25", pnl: -5.20, winrate: 42 },
    { name: "Volatility 10", pnl: 3.40, winrate: 55 }
  ];
  
  const best = markets.reduce((a, b) => a.pnl > b.pnl ? a : b);
  const worst = markets.reduce((a, b) => a.pnl < b.pnl ? a : b);
  
  marketCardsGrid.innerHTML = `
    <div class="market-card best-market">
      <span class="market-badge">🥇 Best</span>
      <strong class="market-name">${best.name}</strong>
      <span class="market-pnl ${best.pnl >= 0 ? 'positive' : 'negative'}">${best.pnl >= 0 ? '+' : ''}$${best.pnl.toFixed(2)}</span>
      <span class="market-winrate">Win Rate: ${best.winrate}%</span>
    </div>
    <div class="market-card worst-market">
      <span class="market-badge">⚠️ Worst</span>
      <strong class="market-name">${worst.name}</strong>
      <span class="market-pnl ${worst.pnl >= 0 ? 'positive' : 'negative'}">${worst.pnl >= 0 ? '+' : ''}$${worst.pnl.toFixed(2)}</span>
      <span class="market-winrate">Win Rate: ${worst.winrate}%</span>
    </div>
  `;
}

// Scanner Tab Enhancements
function initScannerTabFeatures() {
  // View toggle
  const viewBtns = document.querySelectorAll('.view-btn');
  const grid = $('ai-market-grid');
  const heatmap = $('scanner-heatmap');
  const radar = $('scanner-radar');
  
  viewBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      viewBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      const view = btn.dataset.view;
      
      grid?.classList.add('hidden');
      heatmap?.classList.add('hidden');
      radar?.classList.add('hidden');
      
      if (view === 'grid') grid?.classList.remove('hidden');
      if (view === 'heatmap') {
        heatmap?.classList.remove('hidden');
        renderHeatmap();
      }
      if (view === 'radar') {
        radar?.classList.remove('hidden');
        renderRadar();
      }
    });
  });
  
  // Signal filter
  const signalFilter = $('signal-filter');
  if (signalFilter) {
    signalFilter.addEventListener('change', () => {
      filterSignalHistory(signalFilter.value);
    });
  }
  
  // Initialize signal history
  updateSignalHistory();
  
  // Update top picks
  updateTopPicks();
}

function renderHeatmap() {
  const heatmap = $('scanner-heatmap');
  if (!heatmap) return;
  
  const markets = [
    { name: 'Vol 100', score: 92 },
    { name: 'Vol 75', score: 87 },
    { name: 'Vol 50', score: 65 },
    { name: 'Vol 25', score: 45 },
    { name: 'Vol 10', score: 78 }
  ];
  
  heatmap.innerHTML = markets.map(m => {
    const level = m.score >= 80 ? 'high' : m.score >= 60 ? 'medium' : 'low';
    return `
      <div class="heatmap-cell ${level}" onclick="selectMarket('${m.name}')">
        <span class="market-name">${m.name}</span>
        <span class="market-score">${m.score}%</span>
      </div>
    `;
  }).join('');
}

function renderRadar() {
  const radar = $('scanner-radar');
  if (!radar) return;
  
  radar.innerHTML = '<canvas id="radar-canvas" class="radar-canvas"></canvas>';
  
  const canvas = document.getElementById('radar-canvas');
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  canvas.width = radar.offsetWidth;
  canvas.height = radar.offsetHeight;
  
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const radius = Math.min(centerX, centerY) - 40;
  
  // Draw radar background
  ctx.strokeStyle = '#1a2433';
  ctx.lineWidth = 1;
  
  for (let i = 1; i <= 5; i++) {
    ctx.beginPath();
    ctx.arc(centerX, centerY, (radius / 5) * i, 0, Math.PI * 2);
    ctx.stroke();
  }
  
  // Draw axes
  const markets = ['Vol 100', 'Vol 75', 'Vol 50', 'Vol 25', 'Vol 10'];
  const angleStep = (Math.PI * 2) / markets.length;
  
  markets.forEach((_, i) => {
    const angle = i * angleStep - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(
      centerX + Math.cos(angle) * radius,
      centerY + Math.sin(angle) * radius
    );
    ctx.stroke();
  });
  
  // Draw data
  const scores = [92, 87, 65, 45, 78];
  ctx.fillStyle = 'rgba(59, 130, 246, 0.3)';
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 2;
  
  ctx.beginPath();
  scores.forEach((score, i) => {
    const angle = i * angleStep - Math.PI / 2;
    const r = (score / 100) * radius;
    const x = centerX + Math.cos(angle) * r;
    const y = centerY + Math.sin(angle) * r;
    
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function updateSignalHistory() {
  const timeline = $('signal-timeline');
  if (!timeline) return;
  
  // Simulated signal history
  const signals = [
    { time: '10:45:32', market: 'Vol 100', type: 'RISE', confidence: 85, result: 'win' },
    { time: '10:44:15', market: 'Vol 75', type: 'FALL', confidence: 72, result: 'loss' },
    { time: '10:42:58', market: 'Vol 50', type: 'ODD', confidence: 91, result: 'win' },
    { time: '10:41:20', market: 'Vol 25', type: 'DIFFER', confidence: 68, result: 'pending' },
    { time: '10:39:45', market: 'Vol 10', type: 'RISE', confidence: 79, result: 'win' }
  ];
  
  timeline.innerHTML = signals.map(s => `
    <div class="signal-item">
      <span class="signal-time">${s.time}</span>
      <span class="signal-market">${s.market}</span>
      <span class="signal-type ${s.type.toLowerCase()}">${s.type}</span>
      <span class="signal-confidence">${s.confidence}%</span>
      <span class="signal-result ${s.result}">${s.result === 'win' ? '✓ Won' : s.result === 'loss' ? '✗ Lost' : '⏳ Pending'}</span>
    </div>
  `).join('');
}

function filterSignalHistory(filter) {
  const items = document.querySelectorAll('.signal-item');
  items.forEach(item => {
    const type = item.querySelector('.signal-type').textContent.toLowerCase();
    if (filter === 'all' || type.includes(filter)) {
      item.style.display = 'grid';
    } else {
      item.style.display = 'none';
    }
  });
}

function updateTopPicks() {
  const topPicksGrid = document.querySelector('.top-picks-grid');
  if (!topPicksGrid) return;
  
  const picks = [
    { rank: '🥇', market: 'Volatility 100', signal: 'RISE', confidence: 92 },
    { rank: '🥈', market: 'Volatility 75', signal: 'ODD', confidence: 87 },
    { rank: '🥉', market: 'Volatility 50', signal: 'DIFFER', confidence: 81 }
  ];
  
  topPicksGrid.innerHTML = picks.map((p, i) => {
    const className = i === 0 ? 'gold' : i === 1 ? 'silver' : 'bronze';
    return `
      <div class="top-pick ${className}" onclick="selectMarket('${p.market}')">
        <span class="pick-rank">${p.rank}</span>
        <div class="pick-info">
          <strong class="pick-market">${p.market}</strong>
          <span class="pick-signal">${p.signal}</span>
          <span class="pick-confidence">${p.confidence}%</span>
        </div>
      </div>
    `;
  }).join('');
}

function selectMarket(market) {
  const symbolMap = {
    'Vol 100': '1HZ100V',
    'Vol 75': '1HZ75V',
    'Vol 50': '1HZ50V',
    'Vol 25': '1HZ25V',
    'Vol 10': '1HZ10V',
    'Volatility 100': '1HZ100V',
    'Volatility 75': '1HZ75V',
    'Volatility 50': '1HZ50V',
    'Volatility 25': '1HZ25V',
    'Volatility 10': '1HZ10V'
  };
  
  const symbol = symbolMap[market];
  if (symbol) {
    const symbolSelect = $('symbol');
    if (symbolSelect) {
      symbolSelect.value = symbol;
      toast(`Selected ${market}`, 'good');
    }
  }
}

// Analyzer Tab Enhancements
function initAnalyzerTabFeatures() {
  // Copilot feed controls
  const feedPause = $('feed-pause');
  const feedClear = $('feed-clear');
  let feedPaused = false;
  
  if (feedPause) {
    feedPause.addEventListener('click', () => {
      feedPaused = !feedPaused;
      feedPause.textContent = feedPaused ? '▶️' : '⏸️';
      toast(feedPaused ? 'Feed paused' : 'Feed resumed', 'info');
    });
  }
  
  if (feedClear) {
    feedClear.addEventListener('click', () => {
      const feed = $('copilot-feed');
      if (feed) {
        feed.innerHTML = '';
        toast('Feed cleared', 'good');
      }
    });
  }
  
  // Backtest button
  const runBacktest = $('run-backtest');
  if (runBacktest) {
    runBacktest.addEventListener('click', () => {
      runBacktestSimulation();
    });
  }
  
  // Threshold controls
  const minConfidence = $('min-confidence');
  const minStreak = $('min-streak');
  
  if (minConfidence) {
    minConfidence.addEventListener('input', () => {
      const value = minConfidence.value;
      minConfidence.nextElementSibling.textContent = `${value}%`;
    });
  }
  
  if (minStreak) {
    minStreak.addEventListener('input', () => {
      const value = minStreak.value;
      minStreak.nextElementSibling.textContent = value;
    });
  }
  
  // Initialize Copilot feed
  updateCopilotFeed();
  
  // Update pattern recognition
  updatePatternRecognition();
}

function updateCopilotFeed() {
  const feed = $('copilot-feed');
  if (!feed) return;
  
  // Add new feed items from Copilot signals
  if (state.copilotSignal && state.copilotSignal.recommendation) {
    const signal = state.copilotSignal;
    const time = new Date().toLocaleTimeString();
    
    const feedItem = document.createElement('div');
    feedItem.className = 'feed-item';
    feedItem.innerHTML = `
      <span class="feed-time">${time}</span>
      <span class="feed-signal">${signal.recommendation}</span>
      <span class="feed-confidence">${signal.confidence}%</span>
      <span class="feed-trend">${signal.trend}</span>
    `;
    
    feed.insertBefore(feedItem, feed.firstChild);
    
    // Keep only last 20 items
    while (feed.children.length > 20) {
      feed.removeChild(feed.lastChild);
    }
  }
}

function updatePatternRecognition() {
  const patternList = $('pattern-list');
  if (!patternList) return;
  
  const patterns = [
    { name: 'Double Top', confidence: 85, signal: 'FALL', active: true },
    { name: 'Ascending Triangle', confidence: 72, signal: 'RISE', active: false },
    { name: 'Head & Shoulders', confidence: 68, signal: 'FALL', active: false },
    { name: 'Double Bottom', confidence: 65, signal: 'RISE', active: false },
    { name: 'Descending Triangle', confidence: 58, signal: 'FALL', active: false }
  ];
  
  patternList.innerHTML = patterns.map(p => `
    <div class="pattern-item ${p.active ? 'active' : ''}">
      <span class="pattern-name">${p.name}</span>
      <span class="pattern-confidence">${p.confidence}%</span>
      <span class="pattern-signal" data-signal="${p.signal}">${p.signal}</span>
    </div>
  `).join('');
}

function runBacktestSimulation() {
  const totalTrades = $('bt-total-trades');
  const winrate = $('bt-winrate');
  const profitFactor = $('bt-profit-factor');
  const drawdown = $('bt-drawdown');
  
  // Simulated backtest results
  const results = {
    totalTrades: Math.floor(Math.random() * 500) + 100,
    winrate: Math.floor(Math.random() * 20) + 55,
    profitFactor: (Math.random() * 2 + 1).toFixed(2),
    drawdown: (Math.random() * 15 + 5).toFixed(1)
  };
  
  if (totalTrades) totalTrades.textContent = results.totalTrades;
  if (winrate) winrate.textContent = `${results.winrate}%`;
  if (profitFactor) profitFactor.textContent = results.profitFactor;
  if (drawdown) drawdown.textContent = `${results.drawdown}%`;
  
  toast('Backtest completed', 'good');
  
  // Draw simple chart
  drawBacktestChart();
}

function drawBacktestChart() {
  const canvas = document.getElementById('backtest-canvas');
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;
  
  const width = canvas.width;
  const height = canvas.height;
  
  // Generate random equity curve
  const points = [];
  let equity = 100;
  for (let i = 0; i < 50; i++) {
    equity += (Math.random() - 0.45) * 5;
    points.push(equity);
  }
  
  const maxEquity = Math.max(...points);
  const minEquity = Math.min(...points);
  const range = maxEquity - minEquity;
  
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 2;
  ctx.beginPath();
  
  points.forEach((point, i) => {
    const x = (i / (points.length - 1)) * width;
    const y = height - ((point - minEquity) / range) * (height - 20) - 10;
    
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  
  ctx.stroke();
  
  // Fill area under curve
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
  ctx.fill();
}

// Charts Tab Enhancements
function initChartsTabFeatures() {
  // Chart layout toggle
  const layoutBtns = document.querySelectorAll('.layout-btn');
  layoutBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      layoutBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const layout = btn.dataset.layout;
      toast(`Switched to ${layout} chart layout`, 'info');
    });
  });
  
  // Drawing tools
  const drawTools = document.querySelectorAll('.draw-tool');
  drawTools.forEach(tool => {
    tool.addEventListener('click', () => {
      drawTools.forEach(t => t.classList.remove('active'));
      
      const toolType = tool.dataset.tool;
      if (toolType === 'clear') {
        toast('All drawings cleared', 'info');
      } else {
        tool.classList.add('active');
        toast(`${toolType.charAt(0).toUpperCase() + toolType.slice(1)} tool selected`, 'info');
      }
    });
  });
  
  // Indicators toggle
  const indicatorToggle = document.querySelector('.indicator-toggle');
  const indicatorsDropdown = document.querySelector('.indicators-dropdown');
  if (indicatorToggle && indicatorsDropdown) {
    indicatorToggle.addEventListener('click', () => {
      indicatorsDropdown.classList.toggle('hidden');
    });
  }
  
  // Price alerts
  const addAlertBtn = $('add-alert');
  if (addAlertBtn) {
    addAlertBtn.addEventListener('click', () => {
      addPriceAlert();
    });
  }
  
  // Alert delete buttons
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('alert-delete')) {
      const alertItem = e.target.closest('.alert-item');
      if (alertItem) {
        alertItem.remove();
        toast('Alert deleted', 'info');
      }
    }
  });
  
  // Initialize volume profile
  drawVolumeProfile();
}

function addPriceAlert() {
  const alertsList = $('alerts-list');
  if (!alertsList) return;
  
  const condition = Math.random() > 0.5 ? 'Above' : 'Below';
  const price = (Math.random() * 1000 + 9500).toFixed(2);
  
  const alertItem = document.createElement('div');
  alertItem.className = 'alert-item';
  alertItem.innerHTML = `
    <span class="alert-condition">${condition}</span>
    <span class="alert-price">${price}</span>
    <span class="alert-status active">Active</span>
    <button class="alert-delete">×</button>
  `;
  
  alertsList.appendChild(alertItem);
  toast('Price alert added', 'good');
}

function drawVolumeProfile() {
  const canvas = document.getElementById('volume-canvas');
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;
  
  const width = canvas.width;
  const height = canvas.height;
  
  // Generate random volume data
  const bars = 20;
  const barWidth = width / bars;
  
  ctx.clearRect(0, 0, width, height);
  
  for (let i = 0; i < bars; i++) {
    const volume = Math.random() * height * 0.8;
    const x = i * barWidth;
    const y = height - volume;
    
    // Color based on volume intensity
    const intensity = volume / height;
    const hue = intensity > 0.6 ? 120 : intensity > 0.3 ? 180 : 240;
    ctx.fillStyle = `hsla(${hue}, 70%, 50%, 0.6)`;
    
    ctx.fillRect(x + 2, y, barWidth - 4, volume);
  }
}

// Recovery Tab Enhancements
function initRecoveryTabFeatures() {
  // Recovery Wizard
  const wizardSteps = document.querySelectorAll('.wizard-step');
  const wizardPanels = document.querySelectorAll('.wizard-panel');
  const wizardPrev = $('wizard-prev');
  const wizardNext = $('wizard-next');
  let currentStep = 1;
  
  if (wizardNext) {
    wizardNext.addEventListener('click', () => {
      if (currentStep < 4) {
        currentStep++;
        updateWizardStep(currentStep);
      }
    });
  }
  
  if (wizardPrev) {
    wizardPrev.addEventListener('click', () => {
      if (currentStep > 1) {
        currentStep--;
        updateWizardStep(currentStep);
      }
    });
  }
  
  // Profile selection
  const profileBtns = document.querySelectorAll('.profile-btn');
  profileBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      profileBtns.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      toast(`Selected ${btn.dataset.profile} profile`, 'good');
    });
  });
  
  // Recovery Calculator
  const calcRun = $('calc-run');
  if (calcRun) {
    calcRun.addEventListener('click', () => {
      runRecoveryCalculator();
    });
  }
  
  // Recovery Simulation
  const runSimulation = $('run-simulation');
  if (runSimulation) {
    runSimulation.addEventListener('click', () => {
      runRecoverySimulation();
    });
  }
}

function updateWizardStep(step) {
  const wizardSteps = document.querySelectorAll('.wizard-step');
  const wizardPanels = document.querySelectorAll('.wizard-panel');
  const wizardPrev = $('wizard-prev');
  const wizardNext = $('wizard-next');
  
  wizardSteps.forEach(s => {
    const stepNum = parseInt(s.dataset.step);
    s.classList.toggle('active', stepNum <= step);
  });
  
  wizardPanels.forEach(p => {
    const panelNum = parseInt(p.dataset.panel);
    p.classList.toggle('active', panelNum === step);
  });
  
  if (wizardPrev) wizardPrev.disabled = step === 1;
  if (wizardNext) wizardNext.textContent = step === 4 ? 'Finish' : 'Next';
}

function runRecoveryCalculator() {
  const startStake = parseFloat($('calc-start-stake')?.value || 0.35);
  const losses = parseInt($('calc-losses')?.value || 3);
  const multiplier = parseFloat($('calc-multiplier')?.value || 2);
  
  const ladder = [];
  let totalExposure = 0;
  let currentStake = startStake;
  
  for (let i = 0; i <= losses; i++) {
    ladder.push({ step: i + 1, stake: currentStake.toFixed(2) });
    totalExposure += currentStake;
    currentStake *= multiplier;
  }
  
  const finalStake = currentStake / multiplier;
  const requiredWinRate = (1 / (1 + (losses * (multiplier - 1)))) * 100;
  
  if ($('calc-total-exposure')) $('calc-total-exposure').textContent = `$${totalExposure.toFixed(2)}`;
  if ($('calc-final-stake')) $('calc-final-stake').textContent = `$${finalStake.toFixed(2)}`;
  if ($('calc-win-rate')) $('calc-win-rate').textContent = `${requiredWinRate.toFixed(1)}%`;
  
  // Display ladder
  const ladderContainer = $('calculator-ladder');
  if (ladderContainer) {
    ladderContainer.innerHTML = ladder.map(step => `
      <div class="ladder-step">
        <span>Step ${step.step}</span>
        <span>$${step.stake}</span>
      </div>
    `).join('');
  }
  
  toast('Calculation complete', 'good');
}

function runRecoverySimulation() {
  const trades = parseInt($('sim-trades')?.value || 100);
  const winRate = parseInt($('sim-winrate')?.value || 55);
  
  let balance = 100;
  let maxDrawdown = 0;
  let peakBalance = 100;
  let recoveryCycles = 0;
  let inRecovery = false;
  let recoveryLosses = 0;
  const stake = 0.35;
  const payout = 0.92;
  
  const balanceHistory = [balance];
  
  for (let i = 0; i < trades; i++) {
    const isWin = Math.random() * 100 < winRate;
    
    if (isWin) {
      balance += stake * payout;
      if (inRecovery) {
        recoveryCycles++;
        inRecovery = false;
        recoveryLosses = 0;
      }
    } else {
      balance -= stake;
      if (!inRecovery) {
        inRecovery = true;
      }
      recoveryLosses++;
    }
    
    balanceHistory.push(balance);
    
    if (balance > peakBalance) peakBalance = balance;
    const drawdown = peakBalance - balance;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }
  
  const finalBalance = balance;
  const successRate = (balance > 100) ? ((balance - 100) / 100 * 100) : 0;
  
  if ($('sim-final-balance')) $('sim-final-balance').textContent = `$${finalBalance.toFixed(2)}`;
  if ($('sim-max-drawdown')) $('sim-max-drawdown').textContent = `$${maxDrawdown.toFixed(2)}`;
  if ($('sim-recovery-cycles')) $('sim-recovery-cycles').textContent = recoveryCycles;
  if ($('sim-success-rate')) $('sim-success-rate').textContent = `${successRate.toFixed(1)}%`;
  
  // Draw simulation chart
  drawSimulationChart(balanceHistory);
  
  toast('Simulation complete', 'good');
}

function drawSimulationChart(balanceHistory) {
  const canvas = document.getElementById('sim-canvas');
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;
  
  const width = canvas.width;
  const height = canvas.height;
  
  const maxBalance = Math.max(...balanceHistory);
  const minBalance = Math.min(...balanceHistory);
  const range = maxBalance - minBalance || 1;
  
  ctx.clearRect(0, 0, width, height);
  
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 2;
  ctx.beginPath();
  
  balanceHistory.forEach((balance, i) => {
    const x = (i / (balanceHistory.length - 1)) * width;
    const y = height - ((balance - minBalance) / range) * (height - 20) - 10;
    
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  
  ctx.stroke();
  
  // Fill area
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
  ctx.fill();
}

// Stats Tab Enhancements
function initStatsTabFeatures() {
  // Stats period selector
  const statsPeriod = $('stats-period');
  if (statsPeriod) {
    statsPeriod.addEventListener('change', () => {
      updateStatsDashboard(statsPeriod.value);
    });
  }
  
  // Chart control buttons
  const chartControlBtns = document.querySelectorAll('.chart-control-btn');
  chartControlBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      chartControlBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      drawPerformanceChart(btn.dataset.type);
    });
  });
  
  // Export buttons
  const exportBtns = document.querySelectorAll('.export-btn');
  exportBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const format = btn.dataset.format;
      exportStatsData(format);
    });
  });
  
  // Initialize charts
  updateStatsDashboard('today');
  drawPerformanceChart('equity');
  drawDistributionChart();
  drawHourlyChart();
}

function updateStatsDashboard(period) {
  // Simulated data based on period
  const data = {
    today: { profit: 12.50, winrate: 65, trades: 24, profitFactor: 1.8 },
    week: { profit: 45.30, winrate: 62, trades: 156, profitFactor: 1.6 },
    month: { profit: 120.80, winrate: 58, trades: 642, profitFactor: 1.4 },
    all: { profit: 542.50, winrate: 60, trades: 2890, profitFactor: 1.5 }
  };
  
  const stats = data[period] || data.today;
  
  if ($('dash-total-profit')) {
    $('dash-total-profit').textContent = `$${stats.profit >= 0 ? '+' : ''}${stats.profit.toFixed(2)}`;
    $('dash-total-profit').className = `metric-value ${stats.profit >= 0 ? 'positive' : 'negative'}`;
  }
  if ($('dash-winrate')) $('dash-winrate').textContent = `${stats.winrate}%`;
  if ($('dash-total-trades')) $('dash-total-trades').textContent = stats.trades;
  if ($('dash-profit-factor')) $('dash-profit-factor').textContent = stats.profitFactor.toFixed(2);
  
  // Update distribution values
  const distribution = {
    odds: Math.floor(stats.trades * 0.4),
    ou: Math.floor(stats.trades * 0.3),
    differ: Math.floor(stats.trades * 0.2),
    rf: Math.floor(stats.trades * 0.1)
  };
  
  if ($('dist-odds')) $('dist-odds').textContent = distribution.odds;
  if ($('dist-ou')) $('dist-ou').textContent = distribution.ou;
  if ($('dist-differ')) $('dist-differ').textContent = distribution.differ;
  if ($('dist-rf')) $('dist-rf').textContent = distribution.rf;
  
  toast(`Stats updated for ${period}`, 'info');
}

function drawPerformanceChart(type) {
  const canvas = document.getElementById('performance-canvas');
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;
  
  const width = canvas.width;
  const height = canvas.height;
  
  // Generate simulated data
  const points = [];
  let value = 100;
  for (let i = 0; i < 50; i++) {
    if (type === 'equity') {
      value += (Math.random() - 0.45) * 3;
    } else {
      // Drawdown
      value = Math.max(0, value - Math.random() * 2);
    }
    points.push(value);
  }
  
  const maxValue = Math.max(...points);
  const minValue = Math.min(...points);
  const range = maxValue - minValue || 1;
  
  ctx.clearRect(0, 0, width, height);
  
  ctx.strokeStyle = type === 'equity' ? '#3b82f6' : '#ef4444';
  ctx.lineWidth = 2;
  ctx.beginPath();
  
  points.forEach((point, i) => {
    const x = (i / (points.length - 1)) * width;
    const y = height - ((point - minValue) / range) * (height - 20) - 10;
    
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  
  ctx.stroke();
  
  // Fill area
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fillStyle = type === 'equity' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(239, 68, 68, 0.1)';
  ctx.fill();
}

function drawDistributionChart() {
  const canvas = document.getElementById('distribution-canvas');
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;
  
  const width = canvas.width;
  const height = canvas.height;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(centerX, centerY) - 20;
  
  const data = [
    { label: 'Odd/Even', value: 40, color: '#3b82f6' },
    { label: 'Over/Under', value: 30, color: '#8b5cf6' },
    { label: 'Differ', value: 20, color: '#22c55e' },
    { label: 'Rise/Fall', value: 10, color: '#f59e0b' }
  ];
  
  const total = data.reduce((sum, d) => sum + d.value, 0);
  let startAngle = -Math.PI / 2;
  
  data.forEach(item => {
    const sliceAngle = (item.value / total) * Math.PI * 2;
    
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, startAngle, startAngle + sliceAngle);
    ctx.closePath();
    ctx.fillStyle = item.color;
    ctx.fill();
    
    startAngle += sliceAngle;
  });
  
  // Inner circle for donut effect
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius * 0.6, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(10, 14, 22, 0.9)';
  ctx.fill();
}

function drawHourlyChart() {
  const canvas = document.getElementById('hourly-canvas');
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;
  
  const width = canvas.width;
  const height = canvas.height;
  
  // Generate hourly data (24 hours)
  const hourlyData = [];
  for (let i = 0; i < 24; i++) {
    hourlyData.push(Math.random() * 20 - 5);
  }
  
  const barWidth = width / 24;
  const maxValue = Math.max(...hourlyData);
  const minValue = Math.min(...hourlyData);
  const range = maxValue - minValue || 1;
  
  ctx.clearRect(0, 0, width, height);
  
  hourlyData.forEach((value, i) => {
    const x = i * barWidth;
    const barHeight = Math.abs(value) / range * (height - 20);
    const y = value >= 0 ? height / 2 - barHeight : height / 2;
    
    ctx.fillStyle = value >= 0 ? 'rgba(34, 197, 94, 0.6)' : 'rgba(239, 68, 68, 0.6)';
    ctx.fillRect(x + 2, y, barWidth - 4, barHeight);
  });
  
  // Zero line
  ctx.strokeStyle = '#7b8ba3';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, height / 2);
  ctx.stroke();
}

function exportStatsData(format) {
  const data = {
    period: $('stats-period')?.value || 'today',
    totalProfit: $('dash-total-profit')?.textContent || '$0.00',
    winrate: $('dash-winrate')?.textContent || '0%',
    totalTrades: $('dash-total-trades')?.textContent || '0',
    profitFactor: $('dash-profit-factor')?.textContent || '0.00',
    timestamp: new Date().toISOString()
  };
  
  let content = '';
  let filename = '';
  let mimeType = '';
  
  if (format === 'csv') {
    content = `Period,Total Profit,Win Rate,Total Trades,Profit Factor,Timestamp\n${data.period},${data.totalProfit},${data.winrate},${data.totalTrades},${data.profitFactor},${data.timestamp}`;
    filename = 'trading_stats.csv';
    mimeType = 'text/csv';
  } else if (format === 'json') {
    content = JSON.stringify(data, null, 2);
    filename = 'trading_stats.json';
    mimeType = 'application/json';
  } else if (format === 'pdf') {
    toast('PDF export requires additional library', 'info');
    return;
  }
  
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  
  toast(`Exported as ${format.toUpperCase()}`, 'good');
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
$("symbol").addEventListener("change", () => {
  applyConnectionSettings();
  loadFullChartHistory();
});
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
$("run-backtest")?.addEventListener("click", runBacktest);
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
initButubaPreloader();
initConnectionDrawer();
initOptionsMenu();
initThemeToggle();
initQuickActions();
initHomeTabFeatures();
initScannerTabFeatures();
initAnalyzerTabFeatures();
initChartsTabFeatures();
initRecoveryTabFeatures();
initStatsTabFeatures();

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

function renderStrategyBotGrid() {
  const holder = $("strategy-bot-grid");
  if (!holder) return;
  holder.innerHTML = "";
  STRATEGY_BOTS.forEach((bot) => {
    const card = document.createElement("article");
    card.className = "panel strategy-card";
    const isActive = state.activeStrategyId === bot.id;
    card.innerHTML = `
      <div class="strategy-card-head">
        <strong>${bot.name}</strong>
        ${isActive ? '<span class="strategy-live-tag">LIVE</span>' : ""}
      </div>
      <p class="strategy-card-desc">${bot.description}</p>
      <div class="strategy-tags">${bot.tags.map((t) => `<span>${t}</span>`).join("")}</div>
      <button type="button" class="ghost-button strategy-run-btn" data-bot="${bot.id}">${isActive ? "Stop" : "Run"}</button>
    `;
    holder.appendChild(card);
  });

  holder.querySelectorAll(".strategy-run-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const bot = STRATEGY_BOTS.find((b) => b.id === btn.dataset.bot);
      if (!bot) return;
      if (state.activeStrategyId === bot.id) {
        stopStrategyBot();
      } else {
        runStrategyBot(bot);
      }
    });
  });
}

function runStrategyBot(bot) {
  if (!state.authorized) {
    toast("Connect your account first.", "danger");
    return;
  }
  bot.apply();
  state.activeStrategyId = bot.id;
  state.activeStrategyName = bot.name;
  const tag = $("strategy-watch-tag");
  if (tag) {
    tag.textContent = `Watching: ${bot.name}`;
    tag.classList.remove("hidden");
  }
  toast(`Running strategy: ${bot.name}`, "good");
  journal(`Strategy Bot started: ${bot.name} (source: ${bot.source}).`, "trade");
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

function syncAnalyzerContractBadge() {
  const activeEl = $("analyzer-active-contract");
  const badgeEl = $("analyzer-sync-badge");
  if (!activeEl || !badgeEl) return;
  const mode = $("contract-mode")?.value || "odds_even";
  const label = contractModeLabel(mode);
  activeEl.textContent = `Analyzing: ${label} (${state.symbol})`;

  const builderMode = $("strategy-contract-mode")?.value;
  const symbolMismatch = $("symbol") && $("symbol").value !== state.symbol;
  const builderMismatch = builderMode && builderMode !== mode;
  const mismatch = symbolMismatch || builderMismatch;

  badgeEl.textContent = mismatch ? "⚠️ Mismatch" : "✅ Synced";
  badgeEl.classList.toggle("synced", !mismatch);
  badgeEl.classList.toggle("mismatch", !!mismatch);
}

const PRO_AI_BOTS = [
  {
    id: "over1_pro",
    name: "Over 1 Pro",
    condition: "Waits for 3 digits at or below 1",
    barrier: 1,
    direction: "DIGITOVER",
    match: (recent) => recent.slice(-3).every((d) => d <= 1),
  },
  {
    id: "under8_pro",
    name: "Under 8 Pro",
    condition: "Waits for 3 digits at or above 8",
    barrier: 8,
    direction: "DIGITUNDER",
    match: (recent) => recent.slice(-3).every((d) => d >= 8),
  },
  {
    id: "over2_pro",
    name: "Over 2 Pro",
    condition: "Waits for 3 digits at or below 2",
    barrier: 2,
    direction: "DIGITOVER",
    match: (recent) => recent.slice(-3).every((d) => d <= 2),
  },
  {
    id: "under7_pro",
    name: "Under 7 Pro",
    condition: "Waits for 3 digits at or above 7",
    barrier: 7,
    direction: "DIGITUNDER",
    match: (recent) => recent.slice(-3).every((d) => d >= 7),
  },
];

state.proAiActive = false;
state.proAiOpenBot = null;
state.proAiScanning = false;

function renderProAiBotGrid() {
  const holder = $("pro-ai-bot-grid");
  if (!holder) return;
  holder.innerHTML = "";
  PRO_AI_BOTS.forEach((bot) => {
    const card = document.createElement("article");
    card.className = "panel strategy-card";
    card.innerHTML = `
      <div class="strategy-card-head"><strong>${bot.name}</strong></div>
      <p class="strategy-card-desc">${bot.condition}</p>
      <div class="strategy-tags"><span>Over/Under</span><span>Barrier ${bot.barrier}</span></div>
      <button type="button" class="ghost-button pro-ai-open-btn" data-bot="${bot.id}">Open</button>
    `;
    holder.appendChild(card);
  });
  holder.querySelectorAll(".pro-ai-open-btn").forEach((btn) => {
    btn.addEventListener("click", () => openProAiBot(btn.dataset.bot));
  });
}

function openProAiBot(botId) {
  const bot = PRO_AI_BOTS.find((b) => b.id === botId);
  if (!bot) return;
  state.proAiOpenBot = bot;
  $("pro-ai-scan-panel").classList.remove("hidden");
  $("pro-ai-scan-title").textContent = bot.name;
  $("pro-ai-scan-status").textContent = bot.condition;
  $("pro-ai-feed").innerHTML = "";
  $("pro-ai-progress-fill").style.width = "0%";
  $("pro-ai-scan-panel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function proAiFeedLine(text, cls = "") {
  const feed = $("pro-ai-feed");
  if (!feed) return;
  const line = document.createElement("div");
  line.className = `pro-ai-feed-line ${cls}`;
  line.textContent = text;
  feed.prepend(line);
  while (feed.children.length > 20) feed.removeChild(feed.lastChild);
}

function startProAiScan() {
  const bot = state.proAiOpenBot;
  if (!bot) return;
  if (!state.authorized) {
    $("pro-ai-scan-status").textContent = "Demo Offline — connect your account first";
    proAiFeedLine("⚠️ Not connected. Tap Connection to authorize before scanning.", "warn");
    return;
  }
  if (state.proAiScanning) return;
  state.proAiScanning = true;
  state.proAiActive = true;
  updateProAiBadge();
  $("pro-ai-scan-status").textContent = "Scanning...";
  $("pro-ai-scan-btn").textContent = "Scanning...";
  $("pro-ai-scan-btn").disabled = true;
  let progress = 0;
  proAiFeedLine(`🔍 Pro AI scan started: ${bot.name} across all 1s markets.`, "info");

  state.proAiScanTimer = setInterval(() => {
    progress = Math.min(96, progress + 4);
    $("pro-ai-progress-fill").style.width = `${progress}%`;

    let found = null;
    WATCHLIST.forEach(([symbol, name]) => {
      const stat = state.marketStats.get(symbol);
      if (!stat || !stat.recentDigits || stat.recentDigits.length < 3) return;
      const recent = stat.recentDigits.slice(-3);
      proAiFeedLine(`${name}: last 3 digits ${recent.join(",")}`, "muted");
      if (!found && bot.match(stat.recentDigits)) {
        found = { symbol, name, stat };
      }
    });

    if (found) {
      clearInterval(state.proAiScanTimer);
      $("pro-ai-progress-fill").style.width = "100%";
      $("pro-ai-scan-status").textContent = `Best market found: ${found.name}`;
      proAiFeedLine(`✅ Best market found: ${found.name} matches "${bot.condition}".`, "good");
      executeProAiTrade(bot, found);
    }
  }, 700);

  setTimeout(() => {
    if (state.proAiScanning && state.proAiScanTimer) {
      clearInterval(state.proAiScanTimer);
      state.proAiScanning = false;
      $("pro-ai-scan-btn").textContent = "🔍 Start Scanning";
      $("pro-ai-scan-btn").disabled = false;
      $("pro-ai-scan-status").textContent = "No clean match found — try again";
      proAiFeedLine("⏱️ Scan timed out without a clean match.", "warn");
    }
  }, 20000);
}

function executeProAiTrade(bot, found) {
  $("pro-ai-scan-status").textContent = `Executing trade on ${found.name}...`;
  proAiFeedLine(`⚡ Executing trade: ${bot.direction === "DIGITOVER" ? "OVER" : "UNDER"} ${bot.barrier} on ${found.name}.`, "info");

  setContractMode("over_under");
  state.symbol = found.symbol;
  if ($("symbol")) $("symbol").value = found.symbol;
  $("ou-barrier").value = String(bot.barrier);
  $("ou-direction").value = bot.direction;

  const settings = getSettings();
  const stake = Number(settings.stake.toFixed(2));
  state.currentStake = stake;
  state.activeTrade = true;
  state.tradeEntryDigit = found.stat.digit;
  state.tradeEndDigit = null;
  startContractCursor();

  send(
    {
      proposal: 1,
      amount: stake,
      basis: "stake",
      currency: state.currency,
      duration: settings.ticks || 1,
      duration_unit: "t",
      symbol: found.symbol,
      contract_type: bot.direction,
      barrier: String(bot.barrier),
    },
    "proposal"
  );

  journal(`Pro AI (${bot.name}) executed ${bot.direction === "DIGITOVER" ? "OVER" : "UNDER"} ${bot.barrier} on ${found.name} at ${new Date().toLocaleTimeString()}.`, "trade");
  toast(`Pro AI trading ${bot.name} on ${found.name}.`, "good");

  state.proAiScanning = false;
  $("pro-ai-scan-btn").textContent = "🔍 Start Scanning";
  $("pro-ai-scan-btn").disabled = false;

  if (state.notificationsEnabled) {
    phoneNotify("Pro AI trade executed", `${bot.name} on ${found.name}`, "good");
  }
}

function updateProAiBadge() {
  const badge = $("pro-ai-badge");
  if (!badge) return;
  badge.textContent = state.proAiActive ? "ON" : "OFF";
  badge.classList.toggle("glowing", state.proAiActive);
}

function initProAi() {
  renderProAiBotGrid();
  $("pro-ai-scan-btn")?.addEventListener("click", startProAiScan);
  $("pro-ai-close-scan")?.addEventListener("click", () => {
    $("pro-ai-scan-panel").classList.add("hidden");
    if (state.proAiScanTimer) clearInterval(state.proAiScanTimer);
    state.proAiScanning = false;
    state.proAiActive = false;
    updateProAiBadge();
  });
}

function initRiseFallButtons() {
  $("rf-buy-rise")?.addEventListener("click", () => buyRiseFall("RISE"));
  $("rf-buy-fall")?.addEventListener("click", () => buyRiseFall("FALL"));
}
initRiseFallButtons();
renderStrategyBotGrid();
initChartTypeToggle();
initLightweightChart();
initProAi();
initDailyAutoReset();
renderTradeHistory();
$("reset-daily-stats")?.addEventListener("click", () => {
  resetDailyStats();
  toast("Daily stats reset.", "good");
});

connectPublicScanner();
setTimeout(hideLoader, 850);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js?v=cursor-ai-20260620")
    .then((registration) => registration.update?.())
    .catch(() => {});
}
