window.TradeData = {
  markets: ['Volatility 10', 'Volatility 25', 'Volatility 50', 'Volatility 75', 'Volatility 100', 'Volatility 10 (1s)', 'Volatility 25 (1s)', 'Volatility 50 (1s)', 'Volatility 75 (1s)', 'Volatility 100 (1s)'],
  contracts: ['OVER 0', 'OVER 1', 'OVER 2', 'UNDER 7', 'UNDER 8', 'UNDER 9'],
  createSample(market) { return { market, ticks: [], price: 1000 + Math.random() * 50 }; },
  nextTick(sample) { const change = (Math.random() - 0.49) * 1.2; sample.price = Math.max(1, sample.price + change); const price = sample.price.toFixed(2); const digit = Number(price.at(-1)); const tick = { price: Number(price), digit, time: new Date() }; sample.ticks.push(tick); if (sample.ticks.length > 160) sample.ticks.shift(); return tick; }
};
