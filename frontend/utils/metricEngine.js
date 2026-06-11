export function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((toNumber(value) + Number.EPSILON) * factor) / factor;
}

export function percent(numerator, denominator, decimals = 1) {
  return denominator ? round((toNumber(numerator) / toNumber(denominator)) * 100, decimals) : 0;
}

export function calculatePerformanceMetrics(trades = []) {
  const rows = Array.isArray(trades) ? trades : [];
  let wins = 0;
  let losses = 0;
  let breakEven = 0;
  let grossPnL = 0;

  for (const trade of rows) {
    const pnl = toNumber(trade?.profit);
    grossPnL += pnl;
    if (pnl > 0) wins += 1;
    else if (pnl < 0) losses += 1;
    else breakEven += 1;
  }

  return {
    totalTrades: rows.length,
    wins,
    losses,
    breakEven,
    winRate: percent(wins, rows.length),
    grossPnL: round(grossPnL),
  };
}
