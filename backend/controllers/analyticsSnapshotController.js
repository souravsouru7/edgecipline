
"use strict";

const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const analyticsSnapshotService = require("../services/analyticsSnapshotService");
const { generateCoachFeed } = require("../utils/aiCoachFeed");
const { getPlannedRiskReward } = require("../utils/riskReward");
const { getTradePnLBreakdown } = require("../utils/metricEngine");

const ALLOWED_FOREX_MARKETS = new Set(["Forex", "Crypto", "Commodities", "Indices", "Stocks"]);
const ALLOWED_INDIAN_INSTRUMENTS = new Set(["OPTION", "EQUITY"]);

const toNum = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const fixed = (value, digits = 2) => toNum(value).toFixed(digits);

const fixedOrNull = (value, digits = 2) => {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : null;
};

function hasRecordedProfit(trade = {}) {
  if (trade.profit == null || trade.profit === "") return false;
  return Number.isFinite(Number(trade.profit));
}

function resolveDateRange(days) {
  const daysParam = parseInt(days, 10);
  if (daysParam > 0 && daysParam <= 3650) {
    return { from: new Date(Date.now() - daysParam * 24 * 60 * 60 * 1000) };
  }
  return undefined;
}

function buildSummary(performance = {}) {
  return {
    totalTrades: performance.totalTrades || 0,
    totalProfit: fixed(performance.grossPnL),
    netProfit: fixed(performance.netPnL),
    netPnL: fixed(performance.netPnL),
    winRate: fixed(performance.winRate, 1),
    avgTrade: fixed(performance.avgPnL),
    avgWin: fixed(performance.avgWin),
    avgLoss: fixed(performance.avgLoss),
    totalCosts: fixed(performance.totalCosts),
    winningTrades: performance.winningTrades || performance.wins || 0,
    losingTrades: performance.losingTrades || performance.losses || 0,
    pnlReadyTrades: performance.pnlReadyTrades || performance.analyticsTradeCount || 0,
    tradesMissingPnl: performance.tradesMissingPnl || 0,
    // null when no trade carried a setupScore, so the UI can show "no data"
    // rather than a 0.0 that reads like every setup scored zero.
    avgSetupScore: fixedOrNull(performance.avgSetupScore, 1),
  };
}

function buildPerformance(performance = {}) {
  const totalWins = toNum(performance.avgWin) * toNum(performance.winningTrades || performance.wins);
  const totalLosses = Math.abs(toNum(performance.avgLoss) * toNum(performance.losingTrades || performance.losses));
  const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;
  const winRate = toNum(performance.winRate) / 100;
  const expectancy = (toNum(performance.avgWin) * winRate) - (toNum(performance.avgLoss) * (1 - winRate));
  const bestTradeProfit = toNum(performance.bestTrade?.profit);
  const worstTradeProfit = toNum(performance.worstTrade?.profit);

  return {
    ...performance,
    totalTrades: performance.totalTrades || 0,
    pnlReadyTrades: performance.pnlReadyTrades || performance.analyticsTradeCount || 0,
    tradesMissingPnl: performance.tradesMissingPnl || 0,
    largestWin: bestTradeProfit > 0 ? fixed(bestTradeProfit) : null,
    largestLoss: worstTradeProfit < 0 ? fixed(worstTradeProfit) : null,
    avgWin: fixed(performance.avgWin),
    avgLoss: fixed(performance.avgLoss),
    totalWins: fixed(totalWins),
    totalLosses: fixed(totalLosses),
    winRate: fixed(performance.winRate, 1),
    profitFactor: Number.isFinite(profitFactor) ? fixed(profitFactor) : "Infinity",
    expectancy: fixed(expectancy),
    maxWinStreak: performance.maxWinStreak || 0,
    maxLossStreak: performance.maxLossStreak || 0,
    recoveryFactor: performance.recoveryFactor || "0.00",
  };
}

// Planned-R:R buckets for the "RR Buckets (Win Rate)" table.
const RR_BUCKETS = Object.freeze([
  { label: "0-0.5R", min: 0, max: 0.5 },
  { label: "0.5-1R", min: 0.5, max: 1 },
  { label: "1-1.5R", min: 1, max: 1.5 },
  { label: "1.5-2R", min: 1.5, max: 2 },
  { label: "2-3R", min: 2, max: 3 },
  { label: "3R+", min: 3, max: Infinity },
]);

// A trade counts as "breakeven" when it landed within this much of flat. It is
// a display heuristic carried over from the legacy /trade-quality endpoint.
const BREAKEVEN_BAND = 5;

/**
 * R:R quality metrics for the Trade Quality panel.
 *
 * aggregateTradeQuality only returns the Great/Average/Poor distribution, so
 * every R:R-derived field the panel renders (quality score, breakeven rate,
 * trades-with-R:R, the bucket table, cost-hit trades) has to be computed from
 * the trade list here -- exactly like riskReward/timeAnalysis/drawdown above.
 *
 * Uses getPlannedRiskReward, the same helper computeRiskReward uses, so the
 * "TRADES WITH RR" tile cannot disagree with the R:R panel on the same page.
 */
function computeTradeQuality(trades = [], marketType) {
  const buckets = RR_BUCKETS.map((bucket) => ({ ...bucket, rows: [] }));
  let rrSum = 0;
  let tradesWithRR = 0;
  let breakevenTrades = 0;
  let totalCosts = 0;
  let costImpactedTrades = 0;
  let winningTrades = 0;

  for (const trade of trades) {
    const { gross, fees } = getTradePnLBreakdown(trade, marketType);
    totalCosts += fees;
    if (gross > 0) {
      winningTrades += 1;
      // A "win" the broker's charges swallowed whole.
      if (fees > gross) costImpactedTrades += 1;
    }
    if (Math.abs(gross) < BREAKEVEN_BAND) breakevenTrades += 1;

    const planned = getPlannedRiskReward(trade);
    if (!planned || !(planned.rr > 0)) continue;
    tradesWithRR += 1;
    rrSum += planned.rr;
    // Bucket on a rounded ratio. Derived from prices, a planned 1:2 comes out as
    // 1.9999999999999900 (e.g. entry 713.2 / stop 700 / target 739.6), which a
    // raw `rr < 2` test files under "1.5-2R" -- making deliberate 1:2 setups
    // look like a sub-2R habit. Two decimals is finer than the bucket edges.
    const bucketRR = Math.round(planned.rr * 100) / 100;
    const bucket = buckets.find((row) => bucketRR >= row.min && bucketRR < row.max);
    if (bucket) bucket.rows.push(gross);
  }

  const rrAnalysis = buckets
    .filter((bucket) => bucket.rows.length > 0)
    .map((bucket) => {
      const wins = bucket.rows.filter((pnl) => pnl > 0).length;
      const profit = bucket.rows.reduce((sum, pnl) => sum + pnl, 0);
      return {
        label: bucket.label,
        total: bucket.rows.length,
        wins,
        losses: bucket.rows.length - wins,
        winRate: ((wins / bucket.rows.length) * 100).toFixed(1),
        avgProfit: (profit / bucket.rows.length).toFixed(2),
      };
    });

  const total = trades.length;
  const breakevenRate = total ? ((breakevenTrades / total) * 100).toFixed(1) : "0.0";
  const avgRR = tradesWithRR ? rrSum / tradesWithRR : 0;
  const qualityScore = Math.min(
    100,
    Math.max(
      0,
      (winningTrades / Math.max(1, total)) * 50
        + (100 - parseFloat(breakevenRate)) * 0.3
        + Math.min(20, avgRR * 5)
    )
  ).toFixed(0);

  return {
    rrAnalysis,
    breakevenTrades,
    breakevenRate,
    totalCosts: fixed(totalCosts),
    costImpactedTrades,
    // null rather than a score built from zero R:R data, so the panel can show
    // its "add entry + SL + TP" hint instead of a confident-looking number.
    qualityScore: tradesWithRR > 0 ? qualityScore : null,
    tradesWithRR,
    avgRR: tradesWithRR ? fixed(avgRR) : null,
  };
}

function buildQuality(qualitySnapshot, trades = [], marketType) {
  const aggregated = qualitySnapshot ? (qualitySnapshot.quality || qualitySnapshot) : {};
  return { ...aggregated, ...computeTradeQuality(trades, marketType) };
}

function buildCoachFeed(snapshot, marketType) {
  const feed = generateCoachFeed({
    psychologyCost: snapshot.psychologyCost,
    tradingDNA: snapshot.tradingDNA,
    patterns: snapshot.patterns,
    selfAwareness: snapshot.selfAwareness,
    totalTrades: snapshot.basicStats?.totalTrades || 0,
    totalVolume: snapshot.basicStats?.totalVolume || 0,
    marketType,
  });
  return { ...feed, basicStats: snapshot.basicStats };
}

// Planned R:R lives in utils/riskReward.js so this controller and
// getRiskRewardAnalysis cannot drift apart — they previously disagreed on
// whether the price levels or the trader's stated ratio takes precedence.

function average(rows) {
  return rows.length ? rows.reduce((sum, row) => sum + row, 0) / rows.length : null;
}

function computeRiskReward(trades = []) {
  const winners = trades.filter((trade) => toNum(trade.profit) > 0);
  const losers = trades.filter((trade) => toNum(trade.profit) < 0);
  const avgWin = winners.length ? winners.reduce((sum, trade) => sum + toNum(trade.profit), 0) / winners.length : 0;
  const avgLoss = losers.length ? Math.abs(losers.reduce((sum, trade) => sum + toNum(trade.profit), 0) / losers.length) : 0;
  const actualRR = winners.length && losers.length && avgLoss > 0 ? avgWin / avgLoss : null;
  let totalRisk = 0;
  let tradesWithPriceRisk = 0;
  const plannedRows = [];

  for (const trade of trades) {
    const planned = getPlannedRiskReward(trade);
    if (planned?.rr > 0) {
      plannedRows.push({ rr: planned.rr, profit: toNum(trade.profit) });
      if (planned.risk != null) {
        totalRisk += planned.risk;
        tradesWithPriceRisk += 1;
      }
    }
  }

  const winRate = trades.length ? winners.length / trades.length : 0;
  const rrValues = plannedRows.map((row) => row.rr);
  const avgRR = average(rrValues);
  const bestRR = rrValues.length ? Math.max(...rrValues) : null;
  const avgWinRR = average(plannedRows.filter((row) => row.profit > 0).map((row) => row.rr));
  const avgLossRR = average(plannedRows.filter((row) => row.profit < 0).map((row) => row.rr));
  return {
    avgRR: fixedOrNull(avgRR),
    actualRR: fixedOrNull(actualRR),
    plannedRR: fixedOrNull(avgRR),
    bestRR: fixedOrNull(bestRR),
    avgWinRR: fixedOrNull(avgWinRR),
    avgLossRR: fixedOrNull(avgLossRR),
    riskPerTrade: fixedOrNull(tradesWithPriceRisk ? totalRisk / tradesWithPriceRisk : null),
    riskAdjustedReturn: "0.00",
    totalTrades: trades.length,
    tradesWithRR: plannedRows.length,
    tradesWithoutRR: Math.max(0, trades.length - plannedRows.length),
    avgWin: fixed(avgWin),
    avgLoss: fixed(avgLoss),
    expectancy: fixedOrNull(avgRR == null ? null : (avgRR * winRate) - (1 - winRate)),
    winRate: fixed(winRate * 100, 1),
  };
}

function bucketStats(trades = []) {
  const total = trades.length;
  const wins = trades.filter((trade) => toNum(trade.profit) > 0).length;
  const profit = trades.reduce((sum, trade) => sum + toNum(trade.profit), 0);
  return {
    total,
    wins,
    losses: trades.filter((trade) => toNum(trade.profit) < 0).length,
    profit: Number(profit.toFixed(2)),
    winRate: total ? ((wins / total) * 100).toFixed(1) : "0.0",
    avgProfit: total ? (profit / total).toFixed(2) : "0.00",
  };
}

function computeTimeAnalysis(trades = []) {
  const byDate = {};
  const byDay = {};
  const byMonth = {};
  const byHour = {};
  const bySession = {};
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  for (const trade of trades) {
    const date = new Date(trade.tradeDate || trade.createdAt);
    if (Number.isNaN(date.getTime())) continue;
    const dateKey = date.toISOString().slice(0, 10);
    const monthKey = `${monthNames[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
    const dayKey = dayNames[date.getUTCDay()];
    const hourKey = String(date.getUTCHours());
    const sessionKey = trade.session || "Unspecified";
    const maps = [[byDate, dateKey], [byMonth, monthKey], [byDay, dayKey], [byHour, hourKey], [bySession, sessionKey]];
    for (const [map, key] of maps) {
      if (!map[key]) map[key] = [];
      map[key].push(trade);
    }
  }

  const materialize = (map) => Object.fromEntries(Object.entries(map).map(([key, rows]) => [key, bucketStats(rows)]));
  const bestFrom = (map, { keyName = "name", minBuckets = 2, requirePositive = false } = {}) => {
    const entries = Object.entries(materialize(map));
    if (entries.length < minBuckets) return null;
    const [key, stats] = entries
      .map(([name, bucket]) => [name, bucket])
      .sort((a, b) => b[1].profit - a[1].profit)[0] || [];
    if (!stats) return null;
    if (requirePositive && stats.profit <= 0) return null;
    return { [keyName]: key, name: key, ...stats };
  };
  const worstFrom = (map, { keyName = "name", minBuckets = 2, requireNegative = false } = {}) => {
    const entries = Object.entries(materialize(map));
    if (entries.length < minBuckets) return null;
    const [key, stats] = entries
      .map(([name, bucket]) => [name, bucket])
      .sort((a, b) => a[1].profit - b[1].profit)[0] || [];
    if (!stats) return null;
    if (requireNegative && stats.profit >= 0) return null;
    return { [keyName]: key, name: key, ...stats };
  };

  return {
    byDate: materialize(byDate),
    byDay: materialize(byDay),
    byMonth: materialize(byMonth),
    byHour: materialize(byHour),
    bySession: materialize(bySession),
    bestDay: bestFrom(byDay, { requirePositive: true }),
    worstDay: worstFrom(byDay, { requireNegative: true }),
    bestHour: bestFrom(byHour, { keyName: "hour", requirePositive: true }),
    worstHour: worstFrom(byHour, { keyName: "hour", requireNegative: true }),
    bestSession: bestFrom(bySession, { minBuckets: 1 }),
    worstSession: worstFrom(bySession),
  };
}

function computeDrawdown(trades = []) {
  let balance = 0;
  let peak = 0;
  let maxDrawdown = 0;
  // Peak at the moment the deepest drawdown happened -- the denominator for a
  // peak-to-trough percentage. The running peak at the END of the series is a
  // different (usually larger) number and understates the drop.
  let peakAtMaxDrawdown = 0;
  let troughBalance = 0;
  const equityCurve = trades.map((trade) => {
    balance += toNum(trade.profit);
    peak = Math.max(peak, balance);
    if (peak - balance > maxDrawdown) {
      maxDrawdown = peak - balance;
      peakAtMaxDrawdown = peak;
    }
    troughBalance = Math.min(troughBalance, balance);
    return { date: trade.tradeDate || trade.createdAt, balance: fixed(balance), drawdown: fixed(peak - balance) };
  });
  const currentDrawdown = Math.max(0, peak - balance);

  // This equity curve is cumulative P&L starting from zero, not account equity
  // -- the app never captures starting capital. Once the curve goes negative a
  // "percent of peak" has no meaningful denominator and produces figures like
  // 126.8%, so report null and let the UI show the currency amount alone.
  const percentIsMeaningful = peak > 0 && troughBalance >= 0;
  return {
    equityCurve,
    maxDrawdown: fixed(maxDrawdown),
    currentDrawdown: fixed(currentDrawdown),
    peakBalance: fixed(peak),
    currentBalance: fixed(balance),
    maxDrawdownPercent: percentIsMeaningful && peakAtMaxDrawdown > 0
      ? fixed((maxDrawdown / peakAtMaxDrawdown) * 100, 1)
      : null,
    currentDrawdownPercent: percentIsMeaningful ? fixed((currentDrawdown / peak) * 100, 1) : null,
    recoveryFactor: maxDrawdown > 0 ? fixed(balance / maxDrawdown) : balance > 0 ? "Infinity" : "0.00",
  };
}

function computePsychologyAnalytics(trades = []) {
  const moodAnalysis = Object.entries(
    trades.reduce((acc, trade) => {
      if (trade.mood == null) return acc;
      const key = String(trade.mood);
      acc[key] = acc[key] || [];
      acc[key].push(trade);
      return acc;
    }, {})
  ).map(([level, rows]) => ({ level: Number(level), label: `Mood ${level}`, trades: rows.length, ...bucketStats(rows) }));

  const confidenceAnalysis = Object.entries(
    trades.reduce((acc, trade) => {
      if (!trade.confidence) return acc;
      acc[trade.confidence] = acc[trade.confidence] || [];
      acc[trade.confidence].push(trade);
      return acc;
    }, {})
  ).map(([level, rows]) => ({ level, trades: rows.length, ...bucketStats(rows) }));

  const tags = {};
  for (const trade of trades) {
    for (const tag of Array.isArray(trade.emotionalTags) ? trade.emotionalTags : []) {
      tags[tag] = tags[tag] || [];
      tags[tag].push(trade);
    }
  }
  const emotionalTagImpact = Object.entries(tags).map(([tag, rows]) => ({ tag, emoji: "", trades: rows.length, ...bucketStats(rows) }));
  const totalTrackedTrades = trades.filter((trade) => trade.mood != null || trade.confidence || trade.wouldRetake || (Array.isArray(trade.emotionalTags) && trade.emotionalTags.length)).length;
  const planTrades = trades.filter((trade) => trade.entryBasis === "Plan").length;
  const calmTrades = trades.filter((trade) => Array.isArray(trade.emotionalTags) && (trade.emotionalTags.includes("Calm") || trade.emotionalTags.includes("Focused"))).length;
  const totalTrades = trades.length;

  // Revenge trading: a trade taken same-day as a previous loss where the
  // new risk is >1.5× the prior risk. Mirrors the Indian-market logic so
  // both markets report the same metric.
  let revengeCount = 0;
  for (let i = 1; i < trades.length; i++) {
    const prev = trades[i - 1];
    const curr = trades[i];
    const prevLoss = (prev.profit || 0) < 0;
    const prevRisk = prev.entryPrice && prev.stopLoss ? Math.abs(prev.entryPrice - prev.stopLoss) : 0;
    const currRisk = curr.entryPrice && curr.stopLoss ? Math.abs(curr.entryPrice - curr.stopLoss) : 0;
    const sameDay = new Date(prev.tradeDate || prev.createdAt).toDateString() ===
                    new Date(curr.tradeDate || curr.createdAt).toDateString();
    if (prevLoss && sameDay && prevRisk > 0 && currRisk > prevRisk * 1.5) revengeCount++;
  }
  const noRevengePct = totalTrades ? ((totalTrades - revengeCount) / totalTrades) * 100 : 100;

  const goodMoodTradesCount = trades.filter((t) => t.mood != null && t.mood >= 3).length;
  const moodTrackedTrades = trades.filter((t) => t.mood != null).length;
  const goodMoodPct = moodTrackedTrades > 0 ? (goodMoodTradesCount / moodTrackedTrades) * 100 : 50;

  const retakeYes = trades.filter((t) => t.wouldRetake === "Yes").length;
  const retakeTracked = trades.filter((t) => t.wouldRetake === "Yes" || t.wouldRetake === "No").length;
  const wouldRetakePct = retakeTracked > 0 ? (retakeYes / retakeTracked) * 100 : 50;

  return {
    moodAnalysis,
    confidenceAnalysis,
    emotionalTagImpact,
    psychologyScore: trades.length ? Math.round(((planTrades / trades.length) * 50) + ((calmTrades / trades.length) * 50)) : 0,
    scoreBreakdown: {
      planAdherencePct: trades.length ? ((planTrades / trades.length) * 100).toFixed(1) : "0.0",
      calmTradingPct: trades.length ? ((calmTrades / trades.length) * 100).toFixed(1) : "0.0",
      noRevengePct: noRevengePct.toFixed(1),
      goodMoodPct: goodMoodPct.toFixed(1),
      wouldRetakePct: wouldRetakePct.toFixed(1),
    },
    wouldRetakeAnalysis: {
      yes: bucketStats(trades.filter((trade) => trade.wouldRetake === "Yes")),
      no: bucketStats(trades.filter((trade) => trade.wouldRetake === "No")),
    },
    totalTrackedTrades,
  };
}

exports.getAnalyticsSnapshot = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const isIndian = req.isIndianMarket === true || req.baseUrl?.includes("/indian");
  const marketType = isIndian ? "Indian_Market" : "Forex";

  if (!isIndian) {
    const requestedMarket = req.query.marketType ? String(req.query.marketType) : "Forex";
    if (!ALLOWED_FOREX_MARKETS.has(requestedMarket)) {
      throw new ApiError(400, "Invalid marketType parameter", "VALIDATION_ERROR");
    }
  }

  const instrumentType = isIndian
    ? String(req.query.instrumentType || "OPTION").toUpperCase()
    : undefined;

  if (isIndian && !ALLOWED_INDIAN_INSTRUMENTS.has(instrumentType)) {
    throw new ApiError(400, "Invalid instrumentType", "VALIDATION_ERROR");
  }

  const period = String(req.query.period || "weekly");
  const dateRange = resolveDateRange(req.query.days);

  // The in-memory snapshot already computes performance and timeline from the
  // same bounded trade set. Reusing them removes two full collection scans.
  const [snapshot, distributionSnapshot, qualitySnapshot, pnlBreakdown, disciplineSummary] = await Promise.all([
    analyticsSnapshotService.getSnapshot({ userId, market: marketType, instrumentType, dateRange, period, includeTrades: true }),
    analyticsSnapshotService.getTradeDistributionSnapshot({ userId, market: marketType, instrumentType, dateRange }),
    analyticsSnapshotService.getTradeQualitySnapshot({ userId, market: marketType, instrumentType, dateRange }),
    analyticsSnapshotService.getPnlBreakdownSnapshot({ userId, market: marketType, instrumentType, dateRange }),
    analyticsSnapshotService.getDisciplineSummarySnapshot({ userId, market: marketType, instrumentType, dateRange }),
  ]);

  const performance = snapshot.performance || {};
  // Hard cap on snapshot trades before they hit the 4 downstream compute
  // functions (riskReward, timeAnalysis, drawdown, psychology — each O(N)).
  // Without this guard, a runaway snapshot would spend 4× the iteration cost
  // on every refresh.
  const SNAPSHOT_TRADE_CAP = 10000;
  const rawTrades = Array.isArray(snapshot.trades) ? snapshot.trades : [];
  const trades = rawTrades.length > SNAPSHOT_TRADE_CAP
    ? rawTrades.slice(0, SNAPSHOT_TRADE_CAP)
    : rawTrades;
  const pnlReadyTrades = trades.filter(hasRecordedProfit);
  const tradesTruncated = rawTrades.length > SNAPSHOT_TRADE_CAP;
  const aiInsights = {
    insights: buildCoachFeed(snapshot, marketType).insights?.map((item) => item.title || item.insight).filter(Boolean) || [],
    recommendations: buildCoachFeed(snapshot, marketType).insights?.map((item) => item.recommendation).filter(Boolean) || [],
    score: snapshot.selfAwareness?.score ?? snapshot.basicStats?.winRate ?? 0,
    mistakeFeed: [],
    weeklyDisciplineTrend: [],
    behaviorDiscipline: {},
    psychologicalPatterns: {},
  };
  const response = {
    source: "analytics_snapshot",
    marketType,
    instrumentType: isIndian ? instrumentType : undefined,
    generatedAt: snapshot.generatedAt,
    sourceTradeCount: snapshot.sourceTradeCount,
    summary: buildSummary(performance),
    performance: buildPerformance(performance),
    performanceMetrics: buildPerformance(performance),
    distribution: distributionSnapshot.distribution,
    quality: buildQuality(qualitySnapshot, pnlReadyTrades, marketType),
    tradeQualityAnalysis: buildQuality(qualitySnapshot, pnlReadyTrades, marketType),
    pnlBreakdown: {
      daily: pnlBreakdown.daily || [],
      weekly: pnlBreakdown.weekly || [],
      monthly: pnlBreakdown.monthly || [],
    },
    riskReward: computeRiskReward(pnlReadyTrades),
    timeAnalysis: computeTimeAnalysis(pnlReadyTrades),
    drawdown: computeDrawdown(pnlReadyTrades),
    aiInsights,
    psychology: computePsychologyAnalytics(pnlReadyTrades),
    discipline: snapshot.discipline,
    disciplineSummary: disciplineSummary.disciplineSummary,
    tradingDNA: snapshot.tradingDNA,
    selfAwareness: snapshot.selfAwareness,
    psychologyCost: snapshot.psychologyCost,
    patterns: snapshot.patterns,
    timeline: snapshot.timeline,
    timelineSource: snapshot.timeline,
    coachFeed: buildCoachFeed(snapshot, marketType),
    cache: {
      snapshot: snapshot.cache,
      performance: snapshot.cache,
      distribution: distributionSnapshot.cache,
      quality: qualitySnapshot.cache,
      pnlBreakdown: pnlBreakdown.cache,
      timeline: snapshot.cache,
      discipline: disciplineSummary.cache,
    },
    tradesTruncated,
  };

  res.json(response);
});
