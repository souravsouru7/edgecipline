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
  // Fast path: callers overwhelmingly pass an already-canonical literal, and
  // this runs once per trade per metric pass. Falling straight through to the
  // String/trim/toLowerCase below allocates on every single row.
  if (
    marketType === MARKET_TYPES.FOREX ||
    marketType === MARKET_TYPES.INDIAN ||
    marketType === MARKET_TYPES.COMBINED
  ) {
    return marketType;
  }
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

// What `trade.profit` means depends on the market, because the two write paths
// differ (see docs/metric-consistency-audit.md, "P&L Cost Convention"):
//
//   Forex  -- profit is already NET. deriveForexProfit applies commission/swap
//             at save time, so deducting them again here would double-count.
//   Indian -- profit is GROSS. The add-trade form makes P&L a required field and
//             submits it straight through, so deriveIndianProfit never runs and
//             brokerage/sttTaxes are never applied at save time. They come off
//             here, and only here.
function storedProfitIsNet(marketType) {
  return normalizeMarketType(marketType) !== MARKET_TYPES.INDIAN;
}

function getNetPnL(trade = {}, marketType = MARKET_TYPES.FOREX) {
  return storedProfitIsNet(marketType)
    ? getGrossPnL(trade)
    : getGrossPnL(trade) - getTradeCosts(trade, marketType);
}

// Marks rows whose `profit` has already been converted to net. A Symbol keeps
// it out of JSON.stringify / Object.keys, so it can never leak into an API
// response, and it survives object spread so derived copies stay marked.
const NET_PNL_NORMALIZED = Symbol.for("edgecipline.netPnlNormalized");

// A combined view holds both write conventions in one array, so the market has
// to be resolved per row rather than per request. Only Indian trades carry
// brokerage/sttTaxes; when neither is present the deduction is zero either way,
// so a row that falls through to Forex yields the same number regardless.
function resolveRowMarket(trade, marketType) {
  if (normalizeMarketType(marketType) !== MARKET_TYPES.COMBINED) return marketType;
  return trade && (trade.sttTaxes != null || trade.brokerage != null)
    ? MARKET_TYPES.INDIAN
    : MARKET_TYPES.FOREX;
}

/**
 * Returns rows whose `profit` is NET for their own market, so downstream metric
 * code can keep reading `trade.profit` without knowing the per-market
 * convention (see the note above getNetPnL).
 *
 *   Forex rows  -- returned unchanged; profit is already net at save time.
 *   Indian rows -- brokerage + STT deducted exactly once.
 *   No recorded profit -- left untouched. Deducting charges from a null would
 *                        invent a loss on a trade that was never closed.
 *   Idempotent  -- re-normalising an already-normalised array is a no-op, so an
 *                  engine can defend itself without knowing what its caller did.
 *
 * @param {object[]} trades      lean trade documents
 * @param {string}   marketType  "Forex" | "Indian_Market" | "combined"
 */
function withNetPnL(trades, marketType = MARKET_TYPES.FOREX) {
  if (!Array.isArray(trades)) return trades;
  return trades.map((trade) => {
    if (!trade || typeof trade !== "object" || trade[NET_PNL_NORMALIZED]) return trade;
    const recorded = trade.profit != null && Number.isFinite(Number(trade.profit));
    if (!recorded) return { ...trade, [NET_PNL_NORMALIZED]: true };
    return {
      ...trade,
      profit: getNetPnL(trade, resolveRowMarket(trade, marketType)),
      [NET_PNL_NORMALIZED]: true,
    };
  });
}

/**
 * gross / net / fees for one trade, resolving the per-market convention above.
 * For callers outside the per-trade hot path -- addTradeToPerformance inlines
 * the same switch rather than allocating a result object per row.
 */
function getTradePnLBreakdown(trade = {}, marketType = MARKET_TYPES.FOREX) {
  const stored = getGrossPnL(trade);
  const fees = getTradeCosts(trade, marketType);
  const storedIsNet = storedProfitIsNet(marketType);
  return {
    gross: storedIsNet ? stored + fees : stored,
    net: storedIsNet ? stored : stored - fees,
    fees,
  };
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
    setupScoreSum: 0,
    setupScoreCount: 0,
    maxWinStreak: 0,
    maxLossStreak: 0,
    bestTrade: null,
    worstTrade: null,
  };
}

function addTradeToPerformance(accumulator, trade = {}, marketType = MARKET_TYPES.FOREX) {
  // `stored` is trade.profit as written. Only grossPnL/netPnL care whether that
  // figure is pre- or post-cost; every other metric below (win/loss counts,
  // avgWin/avgLoss, profit factor, best/worst, volume) is defined on the stored
  // P&L in both markets, so they stay keyed on `stored` and Forex output is
  // unchanged from before the Indian-market cost fix.
  const stored = getGrossPnL(trade);
  const fees = getTradeCosts(trade, marketType);
  const storedIsNet = storedProfitIsNet(marketType);
  const gross = storedIsNet ? stored + fees : stored;
  const net = storedIsNet ? stored : stored - fees;

  accumulator.totalTrades += 1;
  accumulator.grossPnL += gross;
  accumulator.fees += fees;
  accumulator.netPnL += net;
  accumulator.totalVolume += Math.abs(stored);

  if (typeof trade.setupScore === "number" && Number.isFinite(trade.setupScore)) {
    accumulator.setupScoreSum += trade.setupScore;
    accumulator.setupScoreCount += 1;
  }

  if (stored > 0) {
    accumulator.wins += 1;
    accumulator.totalWinPnL += stored;
  } else if (stored < 0) {
    accumulator.losses += 1;
    accumulator.totalLossPnL += stored;
  } else {
    accumulator.breakEven += 1;
  }

  if (!accumulator.bestTrade || stored > accumulator.bestTrade.profit) {
    accumulator.bestTrade = {
      id: trade._id,
      pair: trade.pair || trade.stockSymbol || "",
      profit: stored,
      tradeDate: trade.tradeDate,
    };
  }

  if (!accumulator.worstTrade || stored < accumulator.worstTrade.profit) {
    accumulator.worstTrade = {
      id: trade._id,
      pair: trade.pair || trade.stockSymbol || "",
      profit: stored,
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
  const setupScoreCount = toNumber(accumulator.setupScoreCount);

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
    // null (not 0) when nothing was scored, so callers can tell "no data" apart
    // from "genuinely scored zero" -- `avgSetupScore ?? 0` would hide the former.
    avgSetupScore: setupScoreCount ? round(toNumber(accumulator.setupScoreSum) / setupScoreCount, 1) : null,
    maxWinStreak: toNumber(accumulator.maxWinStreak),
    maxLossStreak: toNumber(accumulator.maxLossStreak),
    bestTrade: accumulator.bestTrade,
    worstTrade: accumulator.worstTrade,
  };
}

function tradeSortTime(trade = {}) {
  const raw = trade.effectiveTradeDate || trade.tradeDate || trade.createdAt;
  // Lean mongoose docs already carry Date instances; re-wrapping them in a new
  // Date would allocate once per trade on every analytics pass.
  if (raw instanceof Date) {
    const time = raw.getTime();
    return Number.isFinite(time) ? time : 0;
  }
  if (raw == null) return 0;
  const time = new Date(raw).getTime();
  return Number.isFinite(time) ? time : 0;
}

/**
 * Longest consecutive win / loss runs. Streaks are the one metric here that is
 * order-dependent, and callers hand us trades in whatever order their query
 * produced (the snapshot loader sorts newest-first), so sort chronologically
 * rather than trusting the caller. Breakeven trades neither extend nor break a
 * run -- they are not wins or losses under the audit doc's definitions.
 */
function scanStreaks(pnls) {
  let maxWinStreak = 0;
  let maxLossStreak = 0;
  let winRun = 0;
  let lossRun = 0;
  for (let index = 0; index < pnls.length; index += 1) {
    const pnl = pnls[index];
    if (pnl > 0) {
      winRun += 1;
      lossRun = 0;
      if (winRun > maxWinStreak) maxWinStreak = winRun;
    } else if (pnl < 0) {
      lossRun += 1;
      winRun = 0;
      if (lossRun > maxLossStreak) maxLossStreak = lossRun;
    }
  }
  return { maxWinStreak, maxLossStreak };
}

function calculateStreaks(trades = []) {
  const rows = Array.isArray(trades) ? trades : [];
  const count = rows.length;
  if (count === 0) return { maxWinStreak: 0, maxLossStreak: 0 };

  // Fast path: callers normally hand us trades in chronological order already
  // (loadTrades reverses its newest-first query to ascending), so walk once,
  // counting runs and checking ordering at the same time, with no allocation.
  const pnls = new Float64Array(count);
  let previousTime = -Infinity;
  let ordered = true;
  for (let index = 0; index < count; index += 1) {
    const time = tradeSortTime(rows[index]);
    if (time < previousTime) {
      ordered = false;
      break;
    }
    previousTime = time;
    pnls[index] = getGrossPnL(rows[index]);
  }
  if (ordered) return scanStreaks(pnls);

  // Slow path: only materialise and sort when the input really is out of order.
  const points = rows.map((trade) => ({ time: tradeSortTime(trade), pnl: getGrossPnL(trade) }));
  points.sort((a, b) => a.time - b.time);
  for (let index = 0; index < count; index += 1) pnls[index] = points[index].pnl;
  return scanStreaks(pnls);
}

// Deliberately does NOT compute streaks. This is a hot path -- calculateBucketStats
// and the Trading DNA buckets call it once per bucket, on bare {profit} rows that
// carry no dates -- so the extra ordering pass would be paid everywhere and used
// almost nowhere. Callers that display streaks (the analytics snapshot) call
// calculateStreaks explicitly on the dated trade list.
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

    // Re-weight each shard's average back into a sum so the merged mean stays
    // trade-weighted instead of averaging the averages.
    if (metric.avgSetupScore != null) {
      const scored = toNumber(metric.setupScoreCount ?? metric.totalTrades);
      accumulator.setupScoreSum += toNumber(metric.avgSetupScore) * scored;
      accumulator.setupScoreCount += scored;
    }

    // A run can span two shards, so the true streak may exceed either side's.
    // max() is a documented lower bound -- exact merging would need the raw
    // ordered trades, which merge callers do not have.
    accumulator.maxWinStreak = Math.max(accumulator.maxWinStreak, toNumber(metric.maxWinStreak));
    accumulator.maxLossStreak = Math.max(accumulator.maxLossStreak, toNumber(metric.maxLossStreak));

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
  NET_PNL_NORMALIZED,
  withNetPnL,
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
  calculateStreaks,
  createPerformanceAccumulator,
  finalizePerformance,
  getGrossPnL,
  getNetPnL,
  getTradePnLBreakdown,
  storedProfitIsNet,
  getTradeCosts,
  mergePerformanceMetrics,
  normalizeMarketType,
  percent,
  round,
  toNumber,
};
