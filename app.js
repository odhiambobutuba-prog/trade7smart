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

function maybeTriggerOverUnderTriple(symbol) {
  const settings = getSettings();
  if (settings.contractMode !== "over_under" || !settings.ouAutoTripleEnabled) return;
  if (!state.running || state.activeTrade || !state.authorized) return;
  const stat = state.marketStats.get(symbol);
  if (!stat) return;
  const triggerDigit = settings.ouAutoTripleDigit;
  const last3 = (stat.recentDigits || []).slice(-3);
  if (last3.length < 3 || !last3.every((d) => d === triggerDigit)) return;

  const key = `${symbol}:${triggerDigit}:${stat.recentDigits.length}`;
  if (state.lastTripleKey === key) return;
  state.lastTripleKey = key;

  state.symbol = symbol;
  if ($("symbol")) $("symbol").value = symbol;
  $("ou-barrier").value = String(triggerDigit);
  $("ou-direction").value = "DIGITOVER";
  state.currentStake = settings.stake;
  journal(`Triple-repeat strategy: ${symbol} hit ${triggerDigit},${triggerDigit},${triggerDigit}. Firing OVER ${triggerDigit} for 1 tick.`, "trade");
  toast(`Triple ${triggerDigit}s on ${symbol} — firing Over ${triggerDigit}.`, "good");

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
      barrier: String(triggerDigit),
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
  const technicalAnalysis = state.technicalAnalysisData[settings.symbol] || state.technicalAnalysisData[state.symbol];
  
  let baseScore = 0;
  let baseSignal = "";
  let baseSignalType = "";
  let baseReady = false;
  let baseEntryLabel = "";
  
  if (mode === "odds_even") {
    const target = settings.preferredOdds;
    const progress = stat.oddStreak / Math.max(target, 1);
    baseScore = Math.min(100, Math.round(progress * 88 + (stat.digit === stat.repeatDigit ? 4 : 0)));
    baseSignal = `${stat.oddStreak}/${target} Odds`;
    baseSignalType = "ODDS";
    baseReady = stat.oddStreak >= target;
    baseEntryLabel = settings.tradeDirection === "DIGITEVEN" ? "EVEN" : "ODD";
  } else if (mode === "differ") {
    const target = settings.differTrigger;
    const progress = stat.digitStreak / Math.max(target, 1);
    baseScore = Math.min(100, Math.round(progress * 92));
    baseSignal = `${stat.digitStreak}x digit ${stat.repeatDigit ?? "--"}`;
    baseSignalType = "DIFFER";
    baseReady = stat.digitStreak >= target;
    baseEntryLabel = "DIFFER";
  } else {
    const sample = stat.recentDigits.slice(-settings.ouSample);
    const total = sample.length || 1;
    const under = sample.filter((d) => d < settings.barrier).length;
    const over = sample.filter((d) => d > settings.barrier).length;
    const underPct = Math.round((under / total) * 100);
    const overPct = Math.round((over / total) * 100);
    const biasSide = underPct >= overPct ? "OVER" : "UNDER";
    const biasPct = Math.max(underPct, overPct);
    baseScore = Math.min(100, Math.round(Math.max(0, biasPct - 50) * 2.1));
    baseReady = biasPct >= settings.ouMinBias;
    baseSignal = `${biasSide} ${biasPct}% vs ${settings.barrier}`;
    baseSignalType = biasSide;
    baseEntryLabel = biasSide;
  }
  
  // Enhance with technical analysis
  let enhancedScore = baseScore;
  let technicalBoost = 0;
  let technicalReasons = [];
  
  if (technicalAnalysis) {
    // Add technical analysis boost
    if (technicalAnalysis.trend.includes('bullish') && mode !== 'rise_fall') {
      technicalBoost += 5;
      technicalReasons.push('Bullish trend');
    }
    if (technicalAnalysis.trend.includes('bearish') && mode !== 'rise_fall') {
      technicalBoost -= 3;
      technicalReasons.push('Bearish trend');
    }
    
    // RSI confirmation
    if (technicalAnalysis.rsi) {
      if (technicalAnalysis.rsi.oversold && baseReady) {
        technicalBoost += 8;
        technicalReasons.push('RSI oversold confirmation');
      }
      if (technicalAnalysis.rsi.overbought && baseReady) {
        technicalBoost -= 5;
        technicalReasons.push('RSI overbought warning');
      }
    }
    
    // Bollinger Bands confirmation
    if (technicalAnalysis.bollinger) {
      if (technicalAnalysis.bollinger.position === 'below_lower' && baseReady) {
        technicalBoost += 7;
        technicalReasons.push('Price at lower Bollinger Band');
      }
      if (technicalAnalysis.bollinger.squeeze) {
        technicalBoost += 3;
        technicalReasons.push('Bollinger squeeze alert');
      }
    }
    
    // Moving average alignment
    if (technicalAnalysis.sma20 && technicalAnalysis.sma50) {
      if (technicalAnalysis.sma20 > technicalAnalysis.sma50) {
        technicalBoost += 4;
        technicalReasons.push('SMA golden cross');
      } else {
        technicalBoost -= 2;
        technicalReasons.push('SMA death cross');
      }
    }
    
    // Pattern recognition boost
    if (technicalAnalysis.patterns && technicalAnalysis.patterns.length > 0) {
      technicalBoost += technicalAnalysis.patterns.length * 3;
      technicalReasons.push(`${technicalAnalysis.patterns.length} patterns detected`);
    }
    
    // Stochastic confirmation
    if (technicalAnalysis.stochastic) {
      if (technicalAnalysis.stochastic.oversold && baseReady) {
        technicalBoost += 5;
        technicalReasons.push('Stochastic oversold');
      }
    }
  }
  
  enhancedScore = Math.min(100, Math.max(0, baseScore + technicalBoost));
  
  return {
    score: enhancedScore,
    progress: Math.min(100, Math.round((baseScore / 100) * 100)),
    signal: baseSignal,
    signalType: baseSignalType,
    ready: baseReady,
    entryLabel: baseEntryLabel,
    technicalBoost,
    technicalReasons,
    baseScore,
    hasTechnicalData: !!technicalAnalysis
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
  renderTechnicalAnalysis();
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

function smaSeries(values, period) {
  const out = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      out.push(null);
    } else {
      const sum = values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      out.push(sum / period);
    }
  }
  return out;
}

function calculateRSI(values, period = 14) {
  if (values.length < period + 1) return null;
  
  const changes = [];
  for (let i = 1; i < values.length; i++) {
    changes.push(values[i] - values[i - 1]);
  }
  
  let gains = [];
  let losses = [];
  changes.forEach(change => {
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  });
  
  const avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
  const avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;
  
  if (avgLoss === 0) return 100;
  
  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));
  
  return {
    rsi,
    overbought: rsi > 70,
    oversold: rsi < 30,
    trend: rsi > 50 ? 'bullish' : 'bearish'
  };
}

function calculateBollingerBands(values, period = 20, stdDev = 2) {
  if (values.length < period) return null;
  
  const sma = smaSeries(values, period);
  const lastSMA = sma[sma.length - 1];
  
  const recentValues = values.slice(-period);
  const mean = recentValues.reduce((a, b) => a + b, 0) / period;
  const variance = recentValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
  const std = Math.sqrt(variance);
  
  const upperBand = lastSMA + (stdDev * std);
  const lowerBand = lastSMA - (stdDev * std);
  const currentPrice = values[values.length - 1];
  
  return {
    upper: upperBand,
    middle: lastSMA,
    lower: lowerBand,
    current: currentPrice,
    bandwidth: ((upperBand - lowerBand) / lastSMA) * 100,
    position: currentPrice > upperBand ? 'above_upper' : 
              currentPrice < lowerBand ? 'below_lower' : 'within',
    squeeze: ((upperBand - lowerBand) / lastSMA) * 100 < 4
  };
}

function calculateStochastic(values, highLowValues, kPeriod = 14, dPeriod = 3) {
  if (values.length < kPeriod) return null;
  
  const recent = values.slice(-kPeriod);
  const recentHighLow = highLowValues.slice(-kPeriod);
  
  const highestHigh = Math.max(...recentHighLow.map(v => v.high));
  const lowestLow = Math.min(...recentHighLow.map(v => v.low));
  const currentClose = values[values.length - 1];
  
  const k = ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100;
  
  return {
    k,
    overbought: k > 80,
    oversold: k < 20,
    signal: k > 80 ? 'sell' : k < 20 ? 'buy' : 'hold'
  };
}

function calculateATR(values, highLowValues, period = 14) {
  if (values.length < period + 1) return null;
  
  const trueRanges = [];
  for (let i = 1; i < values.length; i++) {
    const high = highLowValues[i].high;
    const low = highLowValues[i].low;
    const prevClose = values[i - 1];
    
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trueRanges.push(tr);
  }
  
  const atr = trueRanges.slice(-period).reduce((a, b) => a + b, 0) / period;
  
  return {
    atr,
    volatility: atr / values[values.length - 1] * 100
  };
}

function analyzeTechnicalIndicators(candles) {
  if (!candles || candles.length < 30) return null;
  
  const closes = candles.map(c => Number(c.close));
  const highLowData = candles.map(c => ({ high: Number(c.high), low: Number(c.low) }));
  
  const rsi = calculateRSI(closes, 14);
  const bollinger = calculateBollingerBands(closes, 20, 2);
  const sma20 = smaSeries(closes, 20);
  const sma50 = smaSeries(closes, 50);
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const stochastic = calculateStochastic(closes, highLowData, 14, 3);
  const atr = calculateATR(closes, highLowData, 14);
  
  const currentPrice = closes[closes.length - 1];
  const lastSMA20 = sma20[sma20.length - 1];
  const lastSMA50 = sma50[sma50.length - 1];
  const lastEMA12 = ema12[ema12.length - 1];
  const lastEMA26 = ema26[ema26.length - 1];
  
  let trend = 'neutral';
  let strength = 0;
  
  if (lastSMA20 > lastSMA50 && currentPrice > lastSMA20) {
    trend = 'strong_bullish';
    strength = 80;
  } else if (lastSMA20 > lastSMA50) {
    trend = 'bullish';
    strength = 60;
  } else if (lastSMA20 < lastSMA50 && currentPrice < lastSMA20) {
    trend = 'strong_bearish';
    strength = 80;
  } else if (lastSMA20 < lastSMA50) {
    trend = 'bearish';
    strength = 60;
  }
  
  if (lastEMA12 > lastEMA26) strength += 10;
  if (rsi && rsi.rsi > 50) strength += 5;
  if (bollinger && bollinger.position === 'above_upper') strength += 15;
  if (bollinger && bollinger.position === 'below_lower') strength -= 15;
  
  strength = Math.min(100, Math.max(0, strength));
  
  let signals = [];
  
  if (rsi) {
    if (rsi.oversold && trend.includes('bullish')) {
      signals.push({ type: 'BUY', strength: 75, reason: 'RSI oversold in bullish trend' });
    }
    if (rsi.overbought && trend.includes('bearish')) {
      signals.push({ type: 'SELL', strength: 75, reason: 'RSI overbought in bearish trend' });
    }
  }
  
  if (bollinger) {
    if (bollinger.position === 'below_lower' && trend !== 'strong_bearish') {
      signals.push({ type: 'BUY', strength: 70, reason: 'Price below lower Bollinger Band' });
    }
    if (bollinger.position === 'above_upper' && trend !== 'strong_bullish') {
      signals.push({ type: 'SELL', strength: 70, reason: 'Price above upper Bollinger Band' });
    }
    if (bollinger.squeeze) {
      signals.push({ type: 'WATCH', strength: 50, reason: 'Bollinger Band squeeze - potential breakout' });
    }
  }
  
  if (stochastic) {
    if (stochastic.oversold && trend.includes('bullish')) {
      signals.push({ type: 'BUY', strength: 65, reason: 'Stochastic oversold' });
    }
    if (stochastic.overbought && trend.includes('bearish')) {
      signals.push({ type: 'SELL', strength: 65, reason: 'Stochastic overbought' });
    }
  }
  
  // Pattern recognition
  const patterns = detectPatterns(closes, highLowData);
  patterns.forEach(pattern => {
    if (pattern.type === 'support' && trend.includes('bullish')) {
      signals.push({ type: 'BUY', strength: pattern.strength, reason: pattern.reason });
    }
    if (pattern.type === 'resistance' && trend.includes('bearish')) {
      signals.push({ type: 'SELL', strength: pattern.strength, reason: pattern.reason });
    }
  });
  
  return {
    trend,
    strength,
    rsi,
    bollinger,
    sma20: lastSMA20,
    sma50: lastSMA50,
    ema12: lastEMA12,
    ema26: lastEMA26,
    stochastic,
    atr,
    signals: signals.sort((a, b) => b.strength - a.strength).slice(0, 3),
    patterns,
    currentPrice,
    timestamp: Date.now()
  };
}

function detectPatterns(closes, highLowData) {
  const patterns = [];
  const lookback = Math.min(20, closes.length);
  
  if (closes.length < 10) return patterns;
  
  const recentCloses = closes.slice(-lookback);
  const recentHighs = highLowData.slice(-lookback).map(d => d.high);
  const recentLows = highLowData.slice(-lookback).map(d => d.low);
  
  // Find support levels (price floors)
  const minPrice = Math.min(...recentLows);
  const nearMinCount = recentLows.filter(p => Math.abs(p - minPrice) / minPrice < 0.01).length;
  
  if (nearMinCount >= 2) {
    const currentPrice = closes[closes.length - 1];
    if (currentPrice > minPrice * 1.01 && currentPrice < minPrice * 1.03) {
      patterns.push({
        type: 'support',
        strength: 60 + nearMinCount * 5,
        reason: `Support level at ${minPrice.toFixed(2)} (${nearMinCount} touches)`,
        level: minPrice
      });
    }
  }
  
  // Find resistance levels (price ceilings)
  const maxPrice = Math.max(...recentHighs);
  const nearMaxCount = recentHighs.filter(p => Math.abs(p - maxPrice) / maxPrice < 0.01).length;
  
  if (nearMaxCount >= 2) {
    const currentPrice = closes[closes.length - 1];
    if (currentPrice < maxPrice * 0.99 && currentPrice > maxPrice * 0.97) {
      patterns.push({
        type: 'resistance',
        strength: 60 + nearMaxCount * 5,
        reason: `Resistance level at ${maxPrice.toFixed(2)} (${nearMaxCount} touches)`,
        level: maxPrice
      });
    }
  }
  
  // Detect trend direction using linear regression
  const n = recentCloses.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += recentCloses[i];
    sumXY += i * recentCloses[i];
    sumX2 += i * i;
  }
  
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const avgPrice = sumY / n;
  
  if (Math.abs(slope) > avgPrice * 0.001) {
    const trendDirection = slope > 0 ? 'uptrend' : 'downtrend';
    patterns.push({
      type: trendDirection === 'uptrend' ? 'support' : 'resistance',
      strength: 55,
      reason: `${trendDirection.toUpperCase()} detected (slope: ${slope.toFixed(4)})`
    });
  }
  
  // Detect double bottom pattern
  if (recentLows.length >= 10) {
    const firstHalf = recentLows.slice(0, 5);
    const secondHalf = recentLows.slice(-5);
    const firstMin = Math.min(...firstHalf);
    const secondMin = Math.min(...secondHalf);
    
    if (Math.abs(firstMin - secondMin) / firstMin < 0.01) {
      const midHigh = Math.max(...recentHighs.slice(3, 7));
      if (midHigh > firstMin * 1.02) {
        patterns.push({
          type: 'support',
          strength: 70,
          reason: 'Double bottom pattern detected',
          level: firstMin
        });
      }
    }
  }
  
  // Detect double top pattern
  if (recentHighs.length >= 10) {
    const firstHalf = recentHighs.slice(0, 5);
    const secondHalf = recentHighs.slice(-5);
    const firstMax = Math.max(...firstHalf);
    const secondMax = Math.max(...secondHalf);
    
    if (Math.abs(firstMax - secondMax) / firstMax < 0.01) {
      const midLow = Math.min(...recentLows.slice(3, 7));
      if (midLow < firstMax * 0.98) {
        patterns.push({
          type: 'resistance',
          strength: 70,
          reason: 'Double top pattern detected',
          level: firstMax
        });
      }
    }
  }
  
  return patterns;
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

state.technicalAnalysisData = state.technicalAnalysisData || {};

function renderTechnicalAnalysis() {
  const data = state.riseFallData[state.symbol] || {};
  const candles = data[60] || [];
  const analysis = analyzeTechnicalIndicators(candles);
  
  if (!analysis) {
    $("ta-overall-signal").textContent = "Waiting for candle data...";
    return;
  }
  
  state.technicalAnalysisData[state.symbol] = analysis;
  
  // Overall signal
  const trendBadge = $("ta-trend-badge");
  trendBadge.textContent = analysis.trend.replace('_', ' ').toUpperCase();
  trendBadge.className = 'ta-badge ' + (analysis.trend.includes('bullish') ? 'bullish' : analysis.trend.includes('bearish') ? 'bearish' : '');
  
  $("ta-strength").textContent = `Strength: ${analysis.strength}%`;
  
  let overallSignal = "NEUTRAL";
  if (analysis.trend.includes('bullish') && analysis.strength > 60) overallSignal = "BUY SIGNAL";
  else if (analysis.trend.includes('bearish') && analysis.strength > 60) overallSignal = "SELL SIGNAL";
  else if (analysis.strength > 50) overallSignal = analysis.trend.includes('bullish') ? "LEANING BUY" : "LEANING SELL";
  
  $("ta-overall-signal").textContent = overallSignal;
  
  // RSI
  if (analysis.rsi) {
    $("ta-rsi-value").textContent = analysis.rsi.rsi.toFixed(1);
    $("ta-rsi-status").textContent = analysis.rsi.overbought ? "Overbought" : analysis.rsi.oversold ? "Oversold" : "Neutral";
    $("ta-rsi-gauge").style.width = `${analysis.rsi.rsi}%`;
  }
  
  // Bollinger Bands
  if (analysis.bollinger) {
    const bbPos = analysis.bollinger.position === 'above_upper' ? 'Above Upper' : 
                  analysis.bollinger.position === 'below_lower' ? 'Below Lower' : 'Within Bands';
    $("ta-bb-value").textContent = bbPos;
    $("ta-bb-status").textContent = analysis.bollinger.squeeze ? "Squeeze Alert" : "Normal";
    
    // Visual representation
    const range = analysis.bollinger.upper - analysis.bollinger.lower;
    const upperPct = ((analysis.bollinger.upper - analysis.bollinger.lower) / range) * 100;
    const middlePct = ((analysis.bollinger.middle - analysis.bollinger.lower) / range) * 100;
    const pricePct = ((analysis.currentPrice - analysis.bollinger.lower) / range) * 100;
    
    $("ta-bb-upper").style.top = "10%";
    $("ta-bb-middle").style.top = "50%";
    $("ta-bb-lower").style.top = "90%";
    $("ta-bb-price").style.top = `${Math.max(10, Math.min(90, pricePct))}%`;
  }
  
  // Stochastic
  if (analysis.stochastic) {
    $("ta-stoch-value").textContent = analysis.stochastic.k.toFixed(1);
    $("ta-stoch-status").textContent = analysis.stochastic.overbought ? "Overbought" : analysis.stochastic.oversold ? "Oversold" : "Neutral";
    $("ta-stoch-gauge").style.width = `${analysis.stochastic.k}%`;
  }
  
  // ATR
  if (analysis.atr) {
    $("ta-atr-value").textContent = analysis.atr.atr.toFixed(4);
    $("ta-atr-volatility").textContent = `Volatility: ${analysis.atr.volatility.toFixed(2)}%`;
    $("ta-vol-fill").style.width = `${Math.min(100, analysis.atr.volatility * 5)}%`;
  }
  
  // Moving Averages
  if (analysis.sma20) {
    $("ta-sma20").textContent = analysis.sma20.toFixed(2);
    const sma20Diff = ((analysis.currentPrice - analysis.sma20) / analysis.sma20 * 100).toFixed(2);
    const sma20DiffEl = $("ta-sma20-diff");
    sma20DiffEl.textContent = `${sma20Diff > 0 ? '+' : ''}${sma20Diff}%`;
    sma20DiffEl.className = 'ta-diff ' + (sma20Diff > 0 ? 'positive' : sma20Diff < 0 ? 'negative' : 'neutral');
  }
  
  if (analysis.sma50) {
    $("ta-sma50").textContent = analysis.sma50.toFixed(2);
    const sma50Diff = ((analysis.currentPrice - analysis.sma50) / analysis.sma50 * 100).toFixed(2);
    const sma50DiffEl = $("ta-sma50-diff");
    sma50DiffEl.textContent = `${sma50Diff > 0 ? '+' : ''}${sma50Diff}%`;
    sma50DiffEl.className = 'ta-diff ' + (sma50Diff > 0 ? 'positive' : sma50Diff < 0 ? 'negative' : 'neutral');
  }
  
  if (analysis.ema12) {
    $("ta-ema12").textContent = analysis.ema12.toFixed(2);
    const ema12Diff = ((analysis.currentPrice - analysis.ema12) / analysis.ema12 * 100).toFixed(2);
    const ema12DiffEl = $("ta-ema12-diff");
    ema12DiffEl.textContent = `${ema12Diff > 0 ? '+' : ''}${ema12Diff}%`;
    ema12DiffEl.className = 'ta-diff ' + (ema12Diff > 0 ? 'positive' : ema12Diff < 0 ? 'negative' : 'neutral');
  }
  
  if (analysis.ema26) {
    $("ta-ema26").textContent = analysis.ema26.toFixed(2);
    const ema26Diff = ((analysis.currentPrice - analysis.ema26) / analysis.ema26 * 100).toFixed(2);
    const ema26DiffEl = $("ta-ema26-diff");
    ema26DiffEl.textContent = `${ema26Diff > 0 ? '+' : ''}${ema26Diff}%`;
    ema26DiffEl.className = 'ta-diff ' + (ema26Diff > 0 ? 'positive' : ema26Diff < 0 ? 'negative' : 'neutral');
  }
  
  // Trading Signals
  const signalsContainer = $("ta-signals-container");
  signalsContainer.innerHTML = "";
  
  if (analysis.signals && analysis.signals.length > 0) {
    analysis.signals.forEach(signal => {
      const signalItem = document.createElement("div");
      signalItem.className = `ta-signal-item ${signal.type.toLowerCase()}`;
      signalItem.innerHTML = `
        <span class="ta-signal-type">${signal.type}</span>
        <span class="ta-signal-reason">${signal.reason}</span>
        <span class="ta-signal-strength">${signal.strength}%</span>
      `;
      signalsContainer.appendChild(signalItem);
    });
  } else {
    signalsContainer.innerHTML = '<small class="ta-no-signals">No active trading signals</small>';
  }
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

const TAB_GROUPS = {
  "home-tab-key": ["home-tab"],
  "ai-scanner-hero": ["ai-scanner-hero"],
  "hero-grid": ["hero-grid"],
  "charts-section": ["charts-section"],
  recovery: ["pro-grid", "risk-grid"],
  stats: ["analytics-grid", "scanner-grid", "bottom-grid"],
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
initButubaPreloader();
initConnectionDrawer();
initOptionsMenu();
initThemeToggle();
initQuickActions();
initRiseFallButtons();

function initRiseFallButtons() {
  $("rf-buy-rise")?.addEventListener("click", () => buyRiseFall("RISE"));
  $("rf-buy-fall")?.addEventListener("click", () => buyRiseFall("FALL"));
}
connectPublicScanner();
setTimeout(hideLoader, 850);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js?v=cursor-ai-20260620")
    .then((registration) => registration.update?.())
    .catch(() => {});
}
