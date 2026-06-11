"use strict";

const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const analyticsSnapshotService = require("../services/analyticsSnapshotService");
const { generateCoachFeed } = require("../utils/aiCoachFeed");

const ALLOWED_FOREX_MARKETS = new Set(["Forex", "Crypto", "Commodities", "Indices", "Stocks"]);
const ALLOWED_INDIAN_INSTRUMENTS = new Set(["OPTION", "EQUITY"]);

const toNum = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const fixed = (value, digits = 2) => toNum(value).toFixed(digits);

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
    avgSetupScore: fixed(performance.avgSetupScore ?? 0, 1),
  };
}

function buildPerformance(performance = {}) {
  const totalWins = toNum(performance.avgWin) * toNum(performance.winningTrades || performance.wins);
  const totalLosses = Math.abs(toNum(performance.avgLoss) * toNum(performance.losingTrades || performance.losses));
  const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;
  const winRate = toNum(performance.winRate) / 100;
  const expectancy = (toNum(performance.avgWin) * winRate) - (toNum(performance.avgLoss) * (1 - winRate));

  return {
    ...performance,
    totalTrades: performance.totalTrades || 0,
    largestWin: fixed(performance.bestTrade?.profit || 0),
    largestLoss: fixed(performance.worstTrade?.profit || 0),
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

function buildQuality(qualitySnapshot) {
  if (!qualitySnapshot) return null;
  return qualitySnapshot.quality || qualitySnapshot;
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

function computeRiskReward(trades = []) {
  const winners = trades.filter((trade) => toNum(trade.profit) > 0);
  const losers = trades.filter((trade) => toNum(trade.profit) < 0);
  const avgWin = winners.length ? winners.reduce((sum, trade) => sum + toNum(trade.profit), 0) / winners.length : 0;
  const avgLoss = losers.length ? Math.abs(losers.reduce((sum, trade) => sum + toNum(trade.profit), 0) / losers.length) : 0;
  const actualRR = avgLoss > 0 ? avgWin / avgLoss : 0;
  let totalRR = 0;
  let rrCount = 0;
  let totalRisk = 0;
  let tradesWithRR = 0;

  for (const trade of trades) {
    let rr = 0;
    if (trade.entryPrice && trade.stopLoss && trade.takeProfit && Math.abs(trade.entryPrice - trade.stopLoss) > 0) {
      const risk = Math.abs(trade.entryPrice - trade.stopLoss);
      rr = Math.abs(trade.takeProfit - trade.entryPrice) / risk;
      totalRisk += risk;
      tradesWithRR += 1;
    } else if (typeof trade.riskRewardRatio === "string" && trade.riskRewardRatio.includes(":")) {
      rr = parseFloat(trade.riskRewardRatio.split(":")[1]) || 0;
    } else if (trade.riskRewardRatio === "custom" && typeof trade.riskRewardCustom === "string" && trade.riskRewardCustom.includes(":")) {
      rr = parseFloat(trade.riskRewardCustom.split(":")[1]) || 0;
    }
    if (rr > 0) {
      totalRR += rr;
      rrCount += 1;
    }
  }

  const winRate = trades.length ? winners.length / trades.length : 0;
  const avgRR = rrCount ? totalRR / rrCount : actualRR;
  return {
    avgRR: fixed(avgRR),
    actualRR: fixed(actualRR),
    plannedRR: rrCount ? fixed(totalRR / rrCount) : "N/A",
    riskPerTrade: fixed(tradesWithRR ? totalRisk / tradesWithRR : 0),
    riskAdjustedReturn: "0.00",
    tradesWithRR,
    tradesWithoutRR: Math.max(0, trades.length - tradesWithRR),
    avgWin: fixed(avgWin),
    avgLoss: fixed(avgLoss),
    expectancy: fixed((avgRR * winRate) - (1 - winRate)),
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
  const bestFrom = (map) => Object.entries(materialize(map))
    .map(([name, stats]) => ({ name, ...stats }))
    .sort((a, b) => b.profit - a.profit)[0] || null;
  const worstFrom = (map) => Object.entries(materialize(map))
    .map(([name, stats]) => ({ name, ...stats }))
    .sort((a, b) => a.profit - b.profit)[0] || null;

  return {
    byDate: materialize(byDate),
    byDay: materialize(byDay),
    byMonth: materialize(byMonth),
    byHour: materialize(byHour),
    bySession: materialize(bySession),
    bestDay: bestFrom(byDay),
    worstDay: worstFrom(byDay),
    bestHour: bestFrom(byHour),
    worstHour: worstFrom(byHour),
    bestSession: bestFrom(bySession),
    worstSession: worstFrom(bySession),
  };
}

function computeDrawdown(trades = []) {
  let balance = 0;
  let peak = 0;
  let maxDrawdown = 0;
  const equityCurve = trades.map((trade) => {
    balance += toNum(trade.profit);
    peak = Math.max(peak, balance);
    maxDrawdown = Math.max(maxDrawdown, peak - balance);
    return { date: trade.tradeDate || trade.createdAt, balance: fixed(balance), drawdown: fixed(peak - balance) };
  });
  const currentDrawdown = Math.max(0, peak - balance);
  return {
    equityCurve,
    maxDrawdown: fixed(maxDrawdown),
    currentDrawdown: fixed(currentDrawdown),
    peakBalance: fixed(peak),
    currentBalance: fixed(balance),
    maxDrawdownPercent: peak > 0 ? fixed((maxDrawdown / peak) * 100, 1) : "0.0",
    currentDrawdownPercent: peak > 0 ? fixed((currentDrawdown / peak) * 100, 1) : "0.0",
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

  return {
    moodAnalysis,
    confidenceAnalysis,
    emotionalTagImpact,
    psychologyScore: trades.length ? Math.round(((planTrades / trades.length) * 50) + ((calmTrades / trades.length) * 50)) : 0,
    scoreBreakdown: {
      planAdherencePct: trades.length ? ((planTrades / trades.length) * 100).toFixed(1) : "0.0",
      calmTradingPct: trades.length ? ((calmTrades / trades.length) * 100).toFixed(1) : "0.0",
      noRevengePct: "100.0",
      goodMoodPct: "50.0",
      wouldRetakePct: "50.0",
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

  const [snapshot, performanceSnapshot, distributionSnapshot, qualitySnapshot, pnlBreakdown, timelineSnapshot, disciplineSummary] = await Promise.all([
    analyticsSnapshotService.getSnapshot({ userId, market: marketType, instrumentType, dateRange, period, includeTrades: true }),
    analyticsSnapshotService.getPerformanceSnapshot({ userId, market: marketType, instrumentType, dateRange }),
    analyticsSnapshotService.getTradeDistributionSnapshot({ userId, market: marketType, instrumentType, dateRange }),
    analyticsSnapshotService.getTradeQualitySnapshot({ userId, market: marketType, instrumentType, dateRange }),
    analyticsSnapshotService.getPnlBreakdownSnapshot({ userId, market: marketType, instrumentType, dateRange }),
    analyticsSnapshotService.getTimelineSnapshot({ userId, market: marketType, instrumentType, dateRange, period }),
    analyticsSnapshotService.getDisciplineSummarySnapshot({ userId, market: marketType, instrumentType, dateRange }),
  ]);

  const performance = performanceSnapshot.performance || snapshot.performance || {};
  const trades = Array.isArray(snapshot.trades) ? snapshot.trades : [];
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
    quality: buildQuality(qualitySnapshot),
    tradeQualityAnalysis: buildQuality(qualitySnapshot),
    pnlBreakdown: {
      daily: pnlBreakdown.daily || [],
      weekly: pnlBreakdown.weekly || [],
      monthly: pnlBreakdown.monthly || [],
    },
    riskReward: computeRiskReward(trades),
    timeAnalysis: computeTimeAnalysis(trades),
    drawdown: computeDrawdown(trades),
    aiInsights,
    psychology: computePsychologyAnalytics(trades),
    discipline: snapshot.discipline,
    disciplineSummary: disciplineSummary.disciplineSummary,
    tradingDNA: snapshot.tradingDNA,
    selfAwareness: snapshot.selfAwareness,
    psychologyCost: snapshot.psychologyCost,
    patterns: snapshot.patterns,
    timeline: timelineSnapshot.timeline,
    timelineSource: timelineSnapshot.timeline,
    coachFeed: buildCoachFeed(snapshot, marketType),
    cache: {
      snapshot: snapshot.cache,
      performance: performanceSnapshot.cache,
      distribution: distributionSnapshot.cache,
      quality: qualitySnapshot.cache,
      pnlBreakdown: pnlBreakdown.cache,
      timeline: timelineSnapshot.cache,
      discipline: disciplineSummary.cache,
    },
  };

  res.json(response);
});
