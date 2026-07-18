window.PatternScanner = class PatternScanner {
  constructor(onMatch) { this.rules = []; this.onMatch = onMatch; }
  addRule(rule) { this.rules = [rule]; }
  inspect(market, ticks) { const digits = ticks.map(tick => tick.digit).join(''); this.rules.forEach(rule => { if (!rule.markets.includes(market) || !rule.pattern || !digits.endsWith(rule.pattern)) return; const key = `${market}:${rule.pattern}:${ticks.length}`; if (this.lastMatch === key) return; this.lastMatch = key; this.onMatch({ market, pattern: rule.pattern, label: rule.label, time: new Date() }); }); }
};
