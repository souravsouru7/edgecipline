"use strict";

const MARKET_TYPES = Object.freeze({
  FOREX: "Forex",
  INDIAN: "Indian_Market",
  COMBINED: "combined",
});

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((toNumber(value) + Number.EPSILON) * factor) / factor;
}

function percent(numerator, denominator, decimals = 1) {
  return denominator ? round((toNumber(numerator) / toNumber(denominator)) * 100, decimals) : 0;
}

function normalizeMarketType(marketType) {
  const raw = String(marketType || "").trim();
  if (raw === MARKET_TYPES.INDIAN || raw.toLowerCase() === "indian") return MARKET_TYPES.INDIAN;
  if (raw.toLowerCase() === MARKET_TYPES.COMBINED) return MARKET_TYPES.COMBINED;
  return MARKET_TYPES.FOREX;
}

function getTradeCosts(trade = {}, marketType = MARKET_TYPES.FOREX) {
  return normalizeMarketType(marketType) === MARKET_TYPES.INDIAN
    ? toNumber(trade.brokerage) + toNumber(trade.sttTaxes)
    : toNumber(trade.commission) + toNumber(trade.swap);
}

function calculateCostBreakdown(trades = [], marketType = MARKET_TYPES.FOREX) {
  const isIndian = normalizeMarketType(marketType) === MARKET_TYPES.INDIAN;
  const rows = Array.isArray(trades) ? trades : [];
  return {
    commission: isIndian ? 0 : round(rows.reduce((sum, trade) => sum + toNumber(trade.commission), 0)),
    swap: isIndian ? 0 : round(rows.reduce((sum, trade) => sum + toNumber(trade.swap), 0)),
    brokerage: isIndian ? round(rows.reduce((sum, trade) => sum + toNumber(trade.brokerage), 0)) : 0,
    sttTaxes: isIndian ? round(rows.reduce((sum, trade) => sum + toNumber(trade.sttTaxes), 0)) : 0,
  };
}

function getGrossPnL(trade = {}) {
  return toNumber(trade.profit);
}

function getNetPnL(trade = {}, marketType = MARKET_TYPES.FOREX) {
  return getGrossPnL(trade) - getTradeCosts(trade, marketType);
}

function createPerformanceAccumulator() {
  return {
    totalTrades: 0,
    wins: 0,
    losses: 0,
    breakEven: 0,
    grossPnL: 0,
    fees: 0,
    netPnL: 0,
    totalVolume: 0,
    totalWinPnL: 0,
    totalLossPnL: 0,
    bestTrade: null,
    worstTrade: null,
  };
}

function addTradeToPerformance(accumulator, trade = {}, marketType = MARKET_TYPES.FOREX) {
  const gross = getGrossPnL(trade);
  const fees = getTradeCosts(trade, marketType);
  const net = gross - fees;

  accumulator.totalTrades += 1;
  accumulator.grossPnL += gross;
  accumulator.fees += fees;
  accumulator.netPnL += net;
  accumulator.totalVolume += Math.abs(gross);

  if (gross > 0) {
    accumulator.wins += 1;
    accumulator.totalWinPnL += gross;
  } else if (gross < 0) {
    accumulator.losses += 1;
    accumulator.totalLossPnL += gross;
  } else {
    accumulator.breakEven += 1;
  }

  if (!accumulator.bestTrade || gross > accumulator.bestTrade.profit) {
    accumulator.bestTrade = {
      id: trade._id,
      pair: trade.pair || trade.stockSymbol || "",
      profit: gross,
      tradeDate: trade.tradeDate,
    };
  }

  if (!accumulator.worstTrade || gross < accumulator.worstTrade.profit) {
    accumulator.worstTrade = {
      id: trade._id,
      pair: trade.pair || trade.stockSymbol || "",
      profit: gross,
      tradeDate: trade.tradeDate,
    };
  }

  return accumulator;
}

function finalizePerformance(accumulator = createPerformanceAccumulator()) {
  const totalTrades = toNumber(accumulator.totalTrades);
  const wins = toNumber(accumulator.wins);
  const losses = toNumber(accumulator.losses);
  const totalWinPnL = toNumber(accumulator.totalWinPnL);
  const totalLossPnL = toNumber(accumulator.totalLossPnL);
  const avgWin = wins ? round(totalWinPnL / wins) : 0;
  const avgLoss = losses ? round(Math.abs(totalLossPnL / losses)) : 0;
  const totalLossAbs = Math.abs(totalLossPnL);

  return {
    totalTrades,
    wins,
    losses,
    breakEven: toNumber(accumulator.breakEven),
    winRate: percent(wins, totalTrades),
    grossPnL: round(accumulator.grossPnL),
    fees: round(accumulator.fees),
    netPnL: round(accumulator.netPnL),
    totalVolume: round(accumulator.totalVolume),
    avgPnL: totalTrades ? round(accumulator.netPnL / totalTrades) : 0,
    avgWin,
    avgLoss,
    profitFactor: totalLossAbs > 0
      ? round(totalWinPnL / totalLossAbs)
      : totalWinPnL > 0
      ? Infinity
      : 0,
    expectancy: totalTrades ? round(accumulator.netPnL / totalTrades) : 0,
    totalCosts: round(accumulator.fees),
    winningTrades: wins,
    losingTrades: losses,
    bestTrade: accumulator.bestTrade,
    worstTrade: accumulator.worstTrade,
  };
}

function calculatePerformanceMetrics(trades = [], marketType = MARKET_TYPES.FOREX) {
  const accumulator = createPerformanceAccumulator();
  for (const trade of Array.isArray(trades) ? trades : []) {
    addTradeToPerformance(accumulator, trade, marketType);
  }
  return finalizePerformance(accumulator);
}

function mergePerformanceMetrics(metrics = []) {
  const accumulator = createPerformanceAccumulator();

  for (const metric of metrics.filter(Boolean)) {
    accumulator.totalTrades += toNumber(metric.totalTrades);
    accumulator.wins += toNumber(metric.wins);
    accumulator.losses += toNumber(metric.losses);
    accumulator.breakEven += toNumber(metric.breakEven);
    accumulator.grossPnL += toNumber(metric.grossPnL);
    accumulator.fees += toNumber(metric.fees ?? metric.totalCosts);
    accumulator.netPnL += toNumber(metric.netPnL);
    accumulator.totalVolume += toNumber(metric.totalVolume);
    accumulator.totalWinPnL += toNumber(metric.totalWinPnL ?? (toNumber(metric.avgWin) * toNumber(metric.wins)));
    accumulator.totalLossPnL += toNumber(metric.totalLossPnL ?? -(toNumber(metric.avgLoss) * toNumber(metric.losses)));

    if (metric.bestTrade && (!accumulator.bestTrade || toNumber(metric.bestTrade.profit) > accumulator.bestTrade.profit)) {
      accumulator.bestTrade = metric.bestTrade;
    }
    if (metric.worstTrade && (!accumulator.worstTrade || toNumber(metric.worstTrade.profit) < accumulator.worstTrade.profit)) {
      accumulator.worstTrade = metric.worstTrade;
    }
  }

  return finalizePerformance(accumulator);
}

function calculateSetupScore(rules = []) {
  const activeRules = Array.isArray(rules)
    ? rules.filter((rule) => rule?.label && String(rule.label).trim())
    : [];
  if (activeRules.length === 0) return null;
  return Math.round(percent(activeRules.filter((rule) => rule.followed === true).length, activeRules.length, 0));
}

function calculateDisciplineScore(trades = []) {
  let setupSum = 0;
  let setupCount = 0;
  let ruleTotal = 0;
  let ruleFollowed = 0;

  for (const trade of Array.isArray(trades) ? trades : []) {
    if (typeof trade.setupScore === "number" && trade.setupScore >= 0) {
      setupSum += trade.setupScore;
      setupCount += 1;
    }

    const rules = Array.isArray(trade.setupRules)
      ? trade.setupRules.filter((rule) => rule?.label && (rule.followed === true || rule.followed === false))
      : [];
    for (const rule of rules) {
      ruleTotal += 1;
      if (rule.followed === true) ruleFollowed += 1;
    }
  }

  const avgSetup = setupCount ? setupSum / setupCount : null;
  const ruleCompliance = ruleTotal ? percent(ruleFollowed, ruleTotal) : null;
  if (avgSetup === null && ruleCompliance === null) return null;
  if (avgSetup === null) return Math.round(ruleCompliance);
  if (ruleCompliance === null) return Math.round(avgSetup);
  return Math.round((avgSetup + ruleCompliance) / 2);
}

const NEGATIVE_TAGS = new Set(["FOMO", "Revenge", "Fear", "Greed", "Frustrated", "Bored"]);
const POSITIVE_TAGS = new Set(["Calm", "Focused", "Patient", "Disciplined"]);

function calculatePsychologyScore(trades = []) {
  const rows = Array.isArray(trades) ? trades : [];
  if (rows.length === 0) return 50;

  let unhealthyNetPnL = 0;
  let healthyNetPnL = 0;
  let totalVolume = 0;

  for (const trade of rows) {
    const pnl = getGrossPnL(trade);
    totalVolume += Math.abs(pnl);
    const tags = Array.isArray(trade.emotionalTags) ? trade.emotionalTags : [];
    const hasNegative = tags.some((tag) => NEGATIVE_TAGS.has(tag));
    const hasPositive = tags.some((tag) => POSITIVE_TAGS.has(tag));
    if (hasNegative) unhealthyNetPnL += pnl;
    if (hasPositive && !hasNegative) healthyNetPnL += pnl;
  }

  const volume = totalVolume || 1;
  const costDrag = Math.max(0, -unhealthyNetPnL) / volume;
  const healthLift = Math.max(0, healthyNetPnL) / volume;
  return Math.min(100, Math.max(0, Math.round(50 + healthLift * 30 - costDrag * 30)));
}

function calculateBucketStats(values = []) {
  const trades = values.map((profit) => ({ profit }));
  const performance = calculatePerformanceMetrics(trades);
  return {
    count: performance.totalTrades,
    wins: performance.wins,
    losses: performance.losses,
    winRate: performance.winRate,
    netPnL: performance.grossPnL,
    avgPnL: performance.totalTrades ? round(performance.grossPnL / performance.totalTrades) : 0,
  };
}

module.exports = {
  MARKET_TYPES,
  NEGATIVE_TAGS,
  POSITIVE_TAGS,
  addTradeToPerformance,
  calculateBucketStats,
  calculateCostBreakdown,
  calculateDisciplineScore,
  calculatePerformanceMetrics,
  calculatePsychologyScore,
  calculateSetupScore,
  createPerformanceAccumulator,
  finalizePerformance,
  getGrossPnL,
  getNetPnL,
  getTradeCosts,
  mergePerformanceMetrics,
  normalizeMarketType,
  percent,
  round,
  toNumber,
};
