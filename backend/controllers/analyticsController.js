const Trade = require("../models/Trade");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");
const { appConfig } = require("../config");
const analyticsSnapshotService = require("../services/analyticsSnapshotService");

const ALLOWED_FOREX_MARKET_TYPES = new Set(["Forex", "Crypto", "Commodities", "Indices", "Stocks"]);

const forexQuery = (req) => {
  const { range, marketType } = req.query;
  
  if (range && !["all", "thisWeek", "lastWeek", "thisMonth", "lastMonth", "thisYear", "ytd"].includes(range)) {
    throw new ApiError(400, "Invalid range parameter");
  }
  
  if (marketType && !ALLOWED_FOREX_MARKET_TYPES.has(String(marketType))) {
    throw new ApiError(400, "Invalid marketType parameter", "VALIDATION_ERROR");
  }

  return {
    user: req.user._id,
    marketType: { $ne: "Indian_Market" },
    deletedAt: null,
    "parsedData.multiTradeGhost": { $ne: true },
  };
};

// Small helper to shift trade timestamps into a configurable
// "trader timezone" before bucketing by day/hour.
// Set TIMEZONE_OFFSET_HOURS in your backend .env (e.g. 5.5 for IST),
// leave unset/0 to keep server-local time.
const getAnalyticsLocalDate = (dateLike) => {
  const base = new Date(dateLike);
  const offsetHours = appConfig.timezoneOffsetHours;
  if (!offsetHours || Number.isNaN(offsetHours)) return base;
  const shiftedMs = base.getTime() + offsetHours * 60 * 60 * 1000;
  return new Date(shiftedMs);
};

const toNum = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const safeDivide = (a, b) => {
  const numerator = toNum(a);
  const denominator = toNum(b);
  if (denominator === 0) return 0;
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : 0;
};

const fixed = (value, digits = 2) => toNum(value).toFixed(digits);

const handleAnalyticsError = (error) => {
  if (error instanceof ApiError) {
    throw error;
  }
  throw new ApiError(500, error.message);
};

function getIsoWeekKey(dateInput) {
  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${weekNo}`;
}

// ============================================
// BASIC ANALYTICS
// ============================================

exports.getSummary = asyncHandler(async (req, res) => {
  try {
    forexQuery(req);
    const snapshot = await analyticsSnapshotService.getPerformanceSnapshot({
      userId: req.user._id,
      market: "Forex",
    });
    const performance = snapshot.performance;
    const avgSetupScore = performance.avgSetupScore ?? 0;

    res.json({
      totalTrades: performance.totalTrades,
      totalProfit: fixed(performance.grossPnL),
      netProfit: fixed(performance.netPnL),
      netPnL: fixed(performance.netPnL),
      winRate: fixed(performance.winRate, 1),
      avgTrade: fixed(performance.avgPnL),
      avgWin: fixed(performance.avgWin),
      avgLoss: fixed(performance.avgLoss),
      totalCosts: fixed(performance.totalCosts),
      winningTrades: performance.winningTrades,
      losingTrades: performance.losingTrades,
      avgSetupScore: fixed(avgSetupScore, 1)
    });
  } catch (error) {
    handleAnalyticsError(error);
  }
});

exports.getWeeklyStats = asyncHandler(async (req, res) => {
  try {
    forexQuery(req);
    const breakdown = await analyticsSnapshotService.getPnlBreakdownSnapshot({
      userId: req.user._id,
      market: "Forex",
    });
    res.json(Object.fromEntries(breakdown.weekly.map((row) => [row.week, row.profit])));
  } catch (error) {
    handleAnalyticsError(error);
  }
});

// ============================================
// ADVANCED ANALYTICS
// ============================================

// 1. Risk/Reward Analysis
exports.getRiskRewardAnalysis = asyncHandler(async (req, res) => {
  try {
    const query = forexQuery(req);
    const trades = await Trade.find(query).lean()
      .select("profit stopLoss takeProfit entryPrice riskRewardRatio riskRewardCustom")
      .limit(10000);

    const tradesWithRR = trades.filter(t => t.stopLoss && t.takeProfit && t.entryPrice);

    // Calculate realized R:R from actual profits (works for all trades with profit/loss)
    const winningTrades = trades.filter(t => t.profit > 0);
    const losingTrades = trades.filter(t => t.profit < 0);
    const avgWin = winningTrades.length ? winningTrades.reduce((acc, t) => acc + t.profit, 0) / winningTrades.length : 0;
    const avgLoss = losingTrades.length ? Math.abs(losingTrades.reduce((acc, t) => acc + t.profit, 0) / losingTrades.length) : 0;
    const actualRR = avgLoss > 0 ? avgWin / avgLoss : 0;

    // Calculate planned R:R from SL/TP (only for trades with stopLoss and takeProfit)
    let plannedRR = 0;
    let totalRRFromPrices = 0;
    let totalRisk = 0;
    let tradesCountedForRR = 0;

    // Additionally, calculate average R:R purely from the manual field
    // (riskRewardRatio / riskRewardCustom) so the UI reflects what the
    // trader actually planned (e.g. 1:2), without being distorted by
    // tiny price differences or P&L.
    let fieldRRTotal = 0;
    let fieldRRCount = 0;

    trades.forEach(trade => {
      let tradeRRFromPrices = 0;
      const hasValidPrices =
        trade.entryPrice &&
        trade.stopLoss &&
        trade.takeProfit &&
        Math.abs(trade.entryPrice - trade.stopLoss) > 0;

      if (hasValidPrices) {
        const risk = Math.abs(trade.entryPrice - trade.stopLoss);
        const reward = Math.abs(trade.takeProfit - trade.entryPrice);
        tradeRRFromPrices = reward / risk;
        totalRisk += risk;
      }

      // Always try to read the explicit riskRewardRatio field
      let tradeRRFromField = 0;
      if (trade.riskRewardRatio) {
        if (trade.riskRewardRatio === "custom" && trade.riskRewardCustom) {
          const parts = trade.riskRewardCustom.split(":");
          if (parts.length === 2) {
            const customVal = parseFloat(parts[1]);
            if (!isNaN(customVal)) tradeRRFromField = customVal;
          }
        } else if (trade.riskRewardRatio.includes(":")) {
          const parts = trade.riskRewardRatio.split(":");
          if (parts.length === 2) {
            const val = parseFloat(parts[1]);
            if (!isNaN(val)) tradeRRFromField = val;
          }
        }
      }

      // Aggregate price‑based RR (for risk per trade etc.)
      if (tradeRRFromPrices > 0) {
        totalRRFromPrices += tradeRRFromPrices;
        tradesCountedForRR++;
      }

      // Aggregate field‑based RR for the "planned" average shown in UI
      if (tradeRRFromField > 0) {
        fieldRRTotal += tradeRRFromField;
        fieldRRCount++;
      }
    });

    plannedRR = tradesCountedForRR > 0 ? totalRRFromPrices / tradesCountedForRR : 0;

    // For the avgRR we return to the client:
    // 1) Prefer the explicit RR field entered by the user (1:2, 1:3, custom)
    // 2) Fallback to price‑based planned RR
    // 3) Finally, fallback to realized RR from P&L
    let avgRR = 0;
    if (fieldRRCount > 0) {
      avgRR = fieldRRTotal / fieldRRCount;
    } else if (plannedRR > 0) {
      avgRR = plannedRR;
    } else {
      avgRR = actualRR;
    }
    const riskPerTrade = tradesCountedForRR > 0 ? totalRisk / tradesCountedForRR : 0;

    // Calculate expectancy
    const winRate = trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0;
    const expectancy = ((avgRR * (winRate / 100)) - ((100 - winRate) / 100)).toFixed(2);

    // Risk-adjusted return (Sharpe-like ratio)
    const returns = trades.map(t => t.profit || 0);
    const meanReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const variance = returns.length > 0 ? returns.reduce((acc, r) => acc + Math.pow(r - meanReturn, 2), 0) / returns.length : 0;
    const stdDev = Math.sqrt(variance);
    const riskAdjustedReturn = stdDev > 0 ? meanReturn / stdDev : 0;

    res.json({
      avgRR: avgRR.toFixed(2),
      actualRR: actualRR.toFixed(2),
      plannedRR: tradesWithRR.length > 0 ? plannedRR.toFixed(2) : "N/A",
      riskPerTrade: riskPerTrade.toFixed(2),
      riskAdjustedReturn: riskAdjustedReturn.toFixed(2),
      tradesWithRR: tradesWithRR.length,
      tradesWithoutRR: trades.length - tradesWithRR.length,
      avgWin: avgWin.toFixed(2),
      avgLoss: avgLoss.toFixed(2),
      expectancy,
      winRate: winRate.toFixed(1)
    });
  } catch (error) {
    handleAnalyticsError(error);
  }
});

// 2. Trade Distribution
exports.getTradeDistribution = asyncHandler(async (req, res) => {
  try {
    forexQuery(req);
    const snapshot = await analyticsSnapshotService.getTradeDistributionSnapshot({
      userId: req.user._id,
      market: "Forex",
    });
    res.json(snapshot.distribution);
  } catch (error) {
    handleAnalyticsError(error);
  }
});

// 3. Performance Metrics
//
// Rewritten: scalar metrics ($max, $min, $sum, $avg, counts) are computed
// in a single $group aggregation — one document round-tripped instead of
// up to 10K full trade docs. Streaks need ordered iteration; we keep that
// in Node but project ONLY {profit} via a cursor, capped at 10K because
// streak relevance falls off beyond that for a single user anyway.
exports.getPerformanceMetrics = asyncHandler(async (req, res) => {
  try {
    const query = forexQuery(req);

    const [scalars = {}] = await Trade.aggregate([
      { $match: query },
      { $project: { profit: { $ifNull: ["$profit", 0] } } },
      {
        $group: {
          _id: null,
          totalTrades:   { $sum: 1 },
          winningCount:  { $sum: { $cond: [{ $gt: ["$profit", 0] }, 1, 0] } },
          losingCount:   { $sum: { $cond: [{ $lt: ["$profit", 0] }, 1, 0] } },
          totalWins:     { $sum: { $cond: [{ $gt: ["$profit", 0] }, "$profit", 0] } },
          totalLossesNeg:{ $sum: { $cond: [{ $lt: ["$profit", 0] }, "$profit", 0] } },
          largestWin:    { $max: { $cond: [{ $gt: ["$profit", 0] }, "$profit", 0] } },
          largestLoss:   { $min: { $cond: [{ $lt: ["$profit", 0] }, "$profit", 0] } },
          // $avg ignores nulls but we projected default 0; gate later in JS
          avgWinDoc: {
            $avg: { $cond: [{ $gt: ["$profit", 0] }, "$profit", null] },
          },
          avgLossDoc: {
            $avg: { $cond: [{ $lt: ["$profit", 0] }, "$profit", null] },
          },
        },
      },
    ], { allowDiskUse: true });

    const totalTrades  = scalars.totalTrades   || 0;
    const winningCount = scalars.winningCount  || 0;
    const losingCount  = scalars.losingCount   || 0;
    const avgWin       = scalars.avgWinDoc     ?? 0;
    const avgLoss      = scalars.avgLossDoc    ?? 0;
    const totalWins    = scalars.totalWins     || 0;
    const totalLosses  = Math.abs(scalars.totalLossesNeg || 0);

    // Streak calculation requires ordered iteration. Cursor-stream ONLY
    // the profit field to keep memory bounded. We pull up to 10K trades
    // chronologically; beyond that, the streak signal is statistically
    // noisy for a single user's display anyway.
    let maxWinStreak = 0, maxLossStreak = 0, tempWinStreak = 0, tempLossStreak = 0;
    const cursor = Trade.find(query, { profit: 1, _id: 0 })
      .sort({ tradeDate: 1, createdAt: 1 })
      .limit(10000)
      .lean()
      .cursor();
    for await (const t of cursor) {
      if (t.profit > 0) {
        tempWinStreak++; tempLossStreak = 0;
        if (tempWinStreak > maxWinStreak) maxWinStreak = tempWinStreak;
      } else if (t.profit < 0) {
        tempLossStreak++; tempWinStreak = 0;
        if (tempLossStreak > maxLossStreak) maxLossStreak = tempLossStreak;
      }
    }

    const profitFactor = safeDivide(totalWins, totalLosses);
    const winRate = totalTrades ? (winningCount / totalTrades) * 100 : 0;
    const expectancy = (avgWin * (winRate / 100)) + (avgLoss * ((100 - winRate) / 100));

    res.json({
      largestWin:  fixed(scalars.largestWin  || 0),
      largestLoss: fixed(scalars.largestLoss || 0),
      avgWin:      fixed(avgWin),
      avgLoss:     fixed(avgLoss),
      maxWinStreak,
      maxLossStreak,
      profitFactor: fixed(profitFactor),
      expectancy:   fixed(expectancy),
      totalWins:    fixed(totalWins),
      totalLosses:  fixed(totalLosses),
      winRate:      fixed(winRate, 1),
      losingTradesCount:  losingCount,
      winningTradesCount: winningCount,
      recoveryFactor: "0.00",
    });
  } catch (error) {
    handleAnalyticsError(error);
  }
});

// 4. Time Analysis (Fixed)
exports.getTimeAnalysis = asyncHandler(async (req, res) => {
  try {
    const query = forexQuery(req);
    let trades = await Trade.find(query).lean()
      .select("profit tradeDate createdAt session")
      .limit(10000);

    // Optional date range filter for "byDay/byHour" style widgets.
    // range=all (default) | range=thisWeek
    const range = (req.query.range || "all").toString();
    if (range === "thisWeek") {
      const nowLocal = getAnalyticsLocalDate(new Date());
      const startOfToday = new Date(nowLocal);
      startOfToday.setHours(0, 0, 0, 0);
      // Monday-based week start
      const day = startOfToday.getDay(); // 0=Sun..6=Sat
      const daysSinceMonday = (day + 6) % 7;
      const weekStart = new Date(startOfToday);
      weekStart.setDate(weekStart.getDate() - daysSinceMonday);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);

      trades = trades.filter(t => {
        const d = getAnalyticsLocalDate(t.tradeDate || t.createdAt);
        return d >= weekStart && d < weekEnd;
      });
    }

    // By Month
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const byMonth = {};
    const byDate = {};

    trades.forEach(t => {
      const date = getAnalyticsLocalDate(t.tradeDate || t.createdAt);
      const key = `${monthNames[date.getMonth()]} ${date.getFullYear()}`;
      const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      if (!byMonth[key]) byMonth[key] = { total: 0, wins: 0, losses: 0, profit: 0, avgProfit: 0 };
      if (!byDate[dateKey]) byDate[dateKey] = { total: 0, wins: 0, losses: 0, profit: 0 };
      byMonth[key].total++;
      byDate[dateKey].total++;
      if (t.profit > 0) byMonth[key].wins++;
      else if (t.profit < 0) byMonth[key].losses++;
      if (t.profit > 0) byDate[dateKey].wins++;
      else if (t.profit < 0) byDate[dateKey].losses++;
      byMonth[key].profit += t.profit || 0;
      byDate[dateKey].profit += t.profit || 0;
    });

    // Calculate win rates for months
    Object.keys(byMonth).forEach(month => {
      byMonth[month].winRate = byMonth[month].total ? ((byMonth[month].wins / byMonth[month].total) * 100).toFixed(1) : 0;
      byMonth[month].avgProfit = byMonth[month].total ? (byMonth[month].profit / byMonth[month].total).toFixed(2) : 0;
    });
    Object.keys(byDate).forEach(dateKey => {
      byDate[dateKey].winRate = byDate[dateKey].total ? ((byDate[dateKey].wins / byDate[dateKey].total) * 100).toFixed(1) : 0;
      byDate[dateKey].avgProfit = byDate[dateKey].total ? (byDate[dateKey].profit / byDate[dateKey].total).toFixed(2) : 0;
      byDate[dateKey].profit = parseFloat(byDate[dateKey].profit.toFixed(2));
    });

    // By Day of Week
    const byDay = {
      Monday: { total: 0, wins: 0, losses: 0, profit: 0, winRate: 0, avgProfit: 0 },
      Tuesday: { total: 0, wins: 0, losses: 0, profit: 0, winRate: 0, avgProfit: 0 },
      Wednesday: { total: 0, wins: 0, losses: 0, profit: 0, winRate: 0, avgProfit: 0 },
      Thursday: { total: 0, wins: 0, losses: 0, profit: 0, winRate: 0, avgProfit: 0 },
      Friday: { total: 0, wins: 0, losses: 0, profit: 0, winRate: 0, avgProfit: 0 },
      Saturday: { total: 0, wins: 0, losses: 0, profit: 0, winRate: 0, avgProfit: 0 },
      Sunday: { total: 0, wins: 0, losses: 0, profit: 0, winRate: 0, avgProfit: 0 }
    };
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    trades.forEach(t => {
      const day = dayNames[getAnalyticsLocalDate(t.tradeDate || t.createdAt).getDay()];
      if (byDay[day]) {
        byDay[day].total++;
        if (t.profit > 0) byDay[day].wins++;
        else if (t.profit < 0) byDay[day].losses++;
        byDay[day].profit += t.profit || 0;
      }
    });

    Object.keys(byDay).forEach(day => {
      byDay[day].winRate = byDay[day].total ? ((byDay[day].wins / byDay[day].total) * 100).toFixed(1) : 0;
      byDay[day].avgProfit = byDay[day].total ? (byDay[day].profit / byDay[day].total).toFixed(2) : 0;
    });

    // By Hour (0-23)
    const byHour = {};
    for (let i = 0; i < 24; i++) { byHour[i] = { total: 0, wins: 0, losses: 0, profit: 0, winRate: 0, avgProfit: 0 }; }

    trades.forEach(t => {
      const hour = getAnalyticsLocalDate(t.tradeDate || t.createdAt).getHours();
      byHour[hour].total++;
      if (t.profit > 0) byHour[hour].wins++;
      else if (t.profit < 0) byHour[hour].losses++;
      byHour[hour].profit += t.profit || 0;
    });

    Object.keys(byHour).forEach(hour => {
      byHour[hour].winRate = byHour[hour].total ? ((byHour[hour].wins / byHour[hour].total) * 100).toFixed(1) : 0;
      byHour[hour].avgProfit = byHour[hour].total ? (byHour[hour].profit / byHour[hour].total).toFixed(2) : 0;
    });

    // Find best and worst (robust calculation)
    const dayEntries = Object.entries(byDay).filter(([_, d]) => d.total > 0);
    let bestDay = ["0", { profit: 0, winRate: 0 }];
    let worstDay = ["0", { profit: 0, winRate: 0 }];

    if (dayEntries.length > 0) {
      // Sort by profit desc
      const sortedDays = [...dayEntries].sort((a, b) => parseFloat(b[1].profit) - parseFloat(a[1].profit));
      if (parseFloat(sortedDays[0][1].profit) > 0) {
        bestDay = sortedDays[0];
      }
      // Only set worst if it's different and we have enough data
      if (sortedDays.length > 1) {
        worstDay = sortedDays[sortedDays.length - 1];
      }
    }

    const bestDayWinRate = dayEntries.length > 1 
      ? [...dayEntries].sort((a, b) => parseFloat(b[1].winRate) - parseFloat(a[1].winRate))[0]
      : ["0", { winRate: 0 }];
    
    const worstDayWinRate = dayEntries.length > 1 
      ? [...dayEntries].sort((a, b) => parseFloat(a[1].winRate) - parseFloat(b[1].winRate))[0]
      : ["0", { winRate: 0 }];

    const hourEntries = Object.entries(byHour).filter(([_, h]) => h.total > 0);
    let bestHour = [0, { profit: 0, winRate: 0 }];
    let worstHour = [0, { profit: 0, winRate: 0 }];

    if (hourEntries.length > 0) {
      const sortedHours = [...hourEntries].sort((a, b) => parseFloat(b[1].profit) - parseFloat(a[1].profit));
      if (parseFloat(sortedHours[0][1].profit) > 0) {
        bestHour = sortedHours[0];
      }
      if (sortedHours.length > 1) {
        worstHour = sortedHours[sortedHours.length - 1];
      }
    }

    const bestHourWinRate = hourEntries.length > 1 
      ? [...hourEntries].sort((a, b) => parseFloat(b[1].winRate) - parseFloat(a[1].winRate))[0]
      : [0, { winRate: 0 }];

    // Session Analysis
    // IMPORTANT: Only respect the session explicitly chosen by the user
    // (trade.session). If none is set, bucket into "Unspecified", but we
    // don't treat that as a "best" session in the summary.
    const bySession = {};

    trades.forEach(t => {
      const session = t.session || "Unspecified";
      if (!bySession[session]) {
        bySession[session] = {
          total: 0,
          wins: 0,
          losses: 0,
          profit: 0,
          winRate: 0,
          avgProfit: 0
        };
      }

      bySession[session].total++;
      if (t.profit > 0) bySession[session].wins++;
      else if (t.profit < 0) bySession[session].losses++;
      bySession[session].profit += t.profit || 0;
    });

    Object.keys(bySession).forEach(session => {
      const s = bySession[session];
      s.winRate = s.total ? ((s.wins / s.total) * 100).toFixed(1) : 0;
      s.avgProfit = s.total ? (s.profit / s.total).toFixed(2) : 0;
    });

    const sessionEntries = Object.entries(bySession).filter(
      ([name, s]) => name !== "Unspecified" && s.total > 0
    );

    let bestSession = ["0", { profit: 0, winRate: 0, total: 0 }];
    let worstSession = ["0", { profit: 0, winRate: 0, total: 0 }];

    if (sessionEntries.length > 0) {
      // Best = highest profit (even if all sessions are negative)
      bestSession = sessionEntries.reduce((a, b) =>
        parseFloat(a[1].profit) > parseFloat(b[1].profit) ? a : b
      );

      // Worst = lowest profit, only show if different from best
      const otherSessions = sessionEntries.filter(([name]) => name !== bestSession[0]);
      if (otherSessions.length > 0) {
        worstSession = otherSessions.reduce((a, b) =>
          parseFloat(a[1].profit) < parseFloat(b[1].profit) ? a : b
        );
      }
    }

    // Require at least 3 trades before a session qualifies for "Highest WR".
    // This prevents a single-trade session (1 win = 100% WR) from dominating.
    const MIN_WR_TRADES = 3;
    const wrCandidates = sessionEntries.filter(([_, s]) => s.total >= MIN_WR_TRADES);
    const wrPool = wrCandidates.length > 0 ? wrCandidates : sessionEntries;
    const bestSessionWR =
      wrPool.length > 0
        ? wrPool.reduce((a, b) =>
            parseFloat(a[1].winRate) > parseFloat(b[1].winRate) ? a : b
          )
        : ["0", { winRate: 0, total: 0 }];

    res.json({
      byMonth,
      byDate,
      byDay,
      byHour,
      bySession,
      bestDay: bestDay[0] !== "0" ? { name: bestDay[0], profit: parseFloat(bestDay[1].profit).toFixed(2), winRate: bestDay[1].winRate } : null,
      worstDay: (worstDay[0] !== "0" && worstDay[0] !== bestDay[0]) ? { name: worstDay[0], profit: parseFloat(worstDay[1].profit).toFixed(2), winRate: worstDay[1].winRate } : null,
      bestDayWinRate: bestDayWinRate[0] !== "0" ? { name: bestDayWinRate[0], winRate: bestDayWinRate[1].winRate } : null,
      worstDayWinRate: (worstDayWinRate[0] !== "0" && worstDayWinRate[0] !== bestDayWinRate[0]) ? { name: worstDayWinRate[0], winRate: worstDayWinRate[1].winRate } : null,
      bestHour: bestHour[1].total > 0 ? { hour: bestHour[0], profit: parseFloat(bestHour[1].profit).toFixed(2), winRate: bestHour[1].winRate } : null,
      worstHour: (worstHour[1].total > 0 && worstHour[0] !== bestHour[0]) ? { hour: worstHour[0], profit: parseFloat(worstHour[1].profit).toFixed(2), winRate: worstHour[1].winRate } : null,
      bestHourWinRate: bestHourWinRate[1].total > 0 ? { hour: bestHourWinRate[0], winRate: bestHourWinRate[1].winRate } : null,
      bestSession: bestSession[1].total > 0 ? { name: bestSession[0], profit: parseFloat(bestSession[1].profit).toFixed(2), winRate: bestSession[1].winRate, trades: bestSession[1].total } : null,
      worstSession: (worstSession[1].total > 0 && worstSession[0] !== bestSession[0]) ? { name: worstSession[0], profit: parseFloat(worstSession[1].profit).toFixed(2), winRate: worstSession[1].winRate, trades: worstSession[1].total } : null,
      bestSessionWR: bestSessionWR[1].total > 0 ? { name: bestSessionWR[0], winRate: bestSessionWR[1].winRate, trades: bestSessionWR[1].total } : null
    });
  } catch (error) {
    handleAnalyticsError(error);
  }
});

// 5. Trade Quality
exports.getTradeQuality = asyncHandler(async (req, res) => {
  try {
    const query = forexQuery(req);
    const trades = await Trade.find(query)
      .select("profit commission swap stopLoss takeProfit entryPrice riskRewardRatio riskRewardCustom setupScore")
      .lean()
      .limit(10000);

    const rrRanges = [
      { label: "0-0.5R", min: 0, max: 0.5, trades: [] },
      { label: "0.5-1R", min: 0.5, max: 1, trades: [] },
      { label: "1-1.5R", min: 1, max: 1.5, trades: [] },
      { label: "1.5-2R", min: 1.5, max: 2, trades: [] },
      { label: "2-3R", min: 2, max: 3, trades: [] },
      { label: "3R+", min: 3, max: Infinity, trades: [] }
    ];

    trades.forEach(t => {
      if (t.stopLoss && t.takeProfit && t.entryPrice) {
        const risk = Math.abs(t.entryPrice - t.stopLoss);
        const reward = Math.abs(t.takeProfit - t.entryPrice);
        const rr = risk > 0 ? reward / risk : 0;
        rrRanges.forEach(range => {
          if (rr >= range.min && rr < range.max) range.trades.push({ profit: t.profit, win: t.profit > 0 });
        });
      }
    });

    const rrAnalysis = rrRanges.map(range => {
      const total = range.trades.length;
      const wins = range.trades.filter(t => t.win).length;
      return {
        label: range.label,
        total,
        wins,
        losses: total - wins,
        winRate: total ? ((wins / total) * 100).toFixed(1) : 0,
        avgProfit: total ? (range.trades.reduce((a, t) => a + t.profit, 0) / total).toFixed(2) : 0
      };
    }).filter(r => r.total > 0);

    const breakevenTrades = trades.filter(t => Math.abs(t.profit) < 5);
    const breakevenRate = trades.length ? ((breakevenTrades.length / trades.length) * 100).toFixed(1) : 0;

    const totalCommission = trades.reduce((acc, t) => acc + (t.commission || 0), 0);
    const totalSwap = trades.reduce((acc, t) => acc + (t.swap || 0), 0);
    const totalCosts = totalCommission + totalSwap;

    let costImpactedTrades = 0;
    trades.forEach(t => { if (t.profit > 0 && (t.commission || 0) + (t.swap || 0) > t.profit) costImpactedTrades++; });

    const winningTrades = trades.filter(t => t.profit > 0).length;
    const avgRR = rrAnalysis.length > 0 ? rrAnalysis.reduce((a, r) => a + parseFloat(r.label), 0) / rrAnalysis.length : 0;
    const qualityScore = Math.min(100, Math.max(0, (winningTrades / Math.max(1, trades.length)) * 50 + (100 - parseFloat(breakevenRate)) * 0.3 + Math.min(20, avgRR * 5))).toFixed(0);

    res.json({
      rrAnalysis,
      breakevenTrades: breakevenTrades.length,
      breakevenRate,
      totalCommission: totalCommission.toFixed(2),
      totalSwap: totalSwap.toFixed(2),
      totalCosts: totalCosts.toFixed(2),
      costImpactedTrades,
      qualityScore,
      tradesWithRR: trades.filter(t => t.stopLoss && t.takeProfit && t.entryPrice).length
    });
  } catch (error) {
    handleAnalyticsError(error);
  }
});

// 6. Drawdown Analysis
exports.getDrawdownAnalysis = asyncHandler(async (req, res) => {
  try {
    const query = forexQuery(req);
    const trades = await Trade.find(query).lean()
      .sort({ tradeDate: 1, createdAt: 1 })
      .select("profit tradeDate createdAt")
      .limit(10000);

    if (trades.length === 0) {
      return res.json({ currentDrawdown: 0, maxDrawdown: 0, maxDrawdownPercent: 0, recoveryFactor: 0, avgDrawdown: 0, drawdownDuration: 0, equityCurve: [] });
    }

    // For journal apps, calculate drawdown from cumulative P&L (not balance)
    let cumulativeProfit = 0;
    let peakProfit = 0;
    let maxDrawdown = 0;
    let maxDrawdownPercent = 0;
    const equityCurve = [];

    trades.forEach(t => {
      cumulativeProfit += t.profit || 0;
      equityCurve.push({ date: t.tradeDate || t.createdAt, balance: cumulativeProfit });
      
      // Update peak if we're at a new high
      if (cumulativeProfit > peakProfit) {
        peakProfit = cumulativeProfit;
      }
      
      // Calculate drawdown from peak
      const drawdown = peakProfit - cumulativeProfit;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
        // Calculate percentage based on peak profit (avoid division by zero)
        maxDrawdownPercent = peakProfit > 0 ? Math.min(100, (drawdown / peakProfit) * 100) : 0;
      }
    });

    const totalProfit = cumulativeProfit;
    const currentDrawdown = peakProfit - cumulativeProfit;
    const currentDrawdownPercent = peakProfit > 0 ? Math.min(100, (currentDrawdown / peakProfit) * 100) : 0;
    
    // Recovery Factor: Total Profit / Max Drawdown
    const recoveryFactor = maxDrawdown > 0 ? totalProfit / maxDrawdown : 0;

    res.json({
      currentDrawdown: currentDrawdown.toFixed(2),
      currentDrawdownPercent: currentDrawdownPercent.toFixed(1),
      maxDrawdown: maxDrawdown.toFixed(2),
      maxDrawdownPercent: maxDrawdownPercent.toFixed(1),
      recoveryFactor: recoveryFactor.toFixed(2),
      avgDrawdown: "0",
      drawdownDurationDays: 0,
      peakBalance: peakProfit.toFixed(2),
      currentBalance: cumulativeProfit.toFixed(2),
      totalProfit: totalProfit.toFixed(2),
      equityCurve: equityCurve.slice(-30),
      drawdownPeriods: []
    });
  } catch (error) {
    handleAnalyticsError(error);
  }
});

// 7. AI Insights (Enhanced with Session) - OPTIMIZED
exports.getAIInsights = asyncHandler(async (req, res) => {
  try {
    const query = forexQuery(req);
    const trades = await Trade.find(query).lean()
      .select("profit entryPrice stopLoss takeProfit session pair tradeDate createdAt entryBasis strategy riskRewardRatio riskRewardCustom lotSize mistakeTag lesson")
      .lean()
      .limit(10000);

    if (trades.length < 5) {
      return res.json({
        insights: ["Not enough data for AI analysis. Keep logging trades!"],
        recommendations: ["Log at least 10 trades for meaningful insights"],
        score: 0
      });
    }

    // Single-pass data aggregation
    const stats = {
      winningTrades: [],
      losingTrades: [],
      bySession: {},
      byPair: {},
      byDay: { Monday: 0, Tuesday: 0, Wednesday: 0, Thursday: 0, Friday: 0 },
      behaviorBuckets: { Plan: { count: 0, pnl: 0 }, Emotion: { count: 0, pnl: 0 }, Impulsive: { count: 0, pnl: 0 }, Other: { count: 0, pnl: 0 } },
      weeklyPlan: {},
      strategyStats: {},
      mistakeTagStats: {}
    };

    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    let totalProfit = 0;
    let totalWinAmount = 0;
    let totalLossAmount = 0;

    // Single pass through all trades
    trades.forEach(t => {
      const profit = t.profit || 0;
      totalProfit += profit;

      if (profit > 0) {
        stats.winningTrades.push(t);
        totalWinAmount += profit;
      } else if (profit < 0) {
        stats.losingTrades.push(t);
        totalLossAmount += Math.abs(profit);
      }

      // Session stats
      const session = t.session || "Unspecified";
      if (!stats.bySession[session]) stats.bySession[session] = { profit: 0, wins: 0, total: 0 };
      stats.bySession[session].total++;
      stats.bySession[session].profit += profit;
      if (profit > 0) stats.bySession[session].wins++;

      // Pair stats
      if (!stats.byPair[t.pair]) stats.byPair[t.pair] = { wins: 0, total: 0, profit: 0 };
      stats.byPair[t.pair].total++;
      stats.byPair[t.pair].profit += profit;
      if (profit > 0) stats.byPair[t.pair].wins++;

      // Day stats
      const day = dayNames[getAnalyticsLocalDate(t.tradeDate || t.createdAt).getDay()];
      if (stats.byDay[day] !== undefined) stats.byDay[day] += profit;

      // Behavior stats
      const behaviorKey = ["Plan", "Emotion", "Impulsive"].includes(t.entryBasis) ? t.entryBasis : "Other";
      stats.behaviorBuckets[behaviorKey].count++;
      stats.behaviorBuckets[behaviorKey].pnl += profit;

      // Weekly plan
      const d = new Date(t.tradeDate || t.createdAt);
      const year = d.getFullYear();
      const week = Math.ceil(((d - new Date(year, 0, 1)) / 86400000 + d.getDay() + 1) / 7);
      const weekKey = `${year}-W${week}`;
      if (!stats.weeklyPlan[weekKey]) stats.weeklyPlan[weekKey] = { total: 0, plan: 0, pnl: 0 };
      stats.weeklyPlan[weekKey].total++;
      stats.weeklyPlan[weekKey].pnl += profit;
      if (t.entryBasis === "Plan") stats.weeklyPlan[weekKey].plan++;

      // Mistake tag
      if (t.mistakeTag && t.mistakeTag.trim()) {
        const mk = t.mistakeTag.trim();
        if (!stats.mistakeTagStats[mk]) stats.mistakeTagStats[mk] = { count: 0, pnl: 0, lessons: [] };
        stats.mistakeTagStats[mk].count++;
        stats.mistakeTagStats[mk].pnl += profit;
        if (t.lesson && t.lesson.trim() && stats.mistakeTagStats[mk].lessons.length < 3) {
          stats.mistakeTagStats[mk].lessons.push(t.lesson.trim());
        }
      }

      // Strategy stats
      const stratKey = t.strategy || "Unspecified";
      if (!stats.strategyStats[stratKey]) stats.strategyStats[stratKey] = { trades: 0, wins: 0, pnl: 0 };
      stats.strategyStats[stratKey].trades++;
      stats.strategyStats[stratKey].pnl += profit;
      if (profit > 0) stats.strategyStats[stratKey].wins++;
    });

    const winRate = (stats.winningTrades.length / trades.length) * 100;
    const avgWin = stats.winningTrades.length ? totalWinAmount / stats.winningTrades.length : 0;
    const avgLoss = stats.losingTrades.length ? totalLossAmount / stats.losingTrades.length : 0;

    const insights = [];
    const recommendations = [];

    // Win rate insights
    if (winRate >= 60) insights.push(`🔥 Excellent win rate of ${winRate.toFixed(1)}% - Your strategy has a strong edge!`);
    else if (winRate >= 50) insights.push(`✅ Good win rate of ${winRate.toFixed(1)}% - You're above breakeven`);
    else if (winRate < 40) insights.push(`⚠️ Win rate of ${winRate.toFixed(1)}% is below optimal - Consider reviewing your entries`);

    // R:R insights
    if (avgWin > 0 && avgLoss > 0) {
      const rr = avgWin / avgLoss;
      if (rr >= 2) insights.push(`📊 Great risk-reward ratio of 1:${rr.toFixed(1)} - You need fewer wins to be profitable`);
      else if (rr < 1) insights.push(`⚠️ Risk-reward ratio of 1:${rr.toFixed(1)} is unfavorable - Aim for at least 1:1.5`);
    }

    // Profit insights
    if (totalProfit > 0) insights.push(`💰 Total profit: $${totalProfit.toFixed(2)} - Keep up the good work!`);
    else insights.push(`📉 Currently in drawdown - Stay disciplined and follow your rules`);

    // Session Analysis - optimized
    const sessionEntries = Object.entries(stats.bySession).filter(([_, s]) => s.total > 0 && s.profit !== 0);
    let bestSessionEntry = null;
    let bestSessionWinRateEntry = null;

    if (sessionEntries.length > 0) {
      let maxProfit = -Infinity;
      let maxWinRate = -1;
      sessionEntries.forEach(([name, s]) => {
        if (s.profit > maxProfit) { maxProfit = s.profit; bestSessionEntry = [name, s]; }
        const wr = s.wins / s.total;
        if (wr > maxWinRate) { maxWinRate = wr; bestSessionWinRateEntry = [name, s]; }
      });

      if (bestSessionEntry[1].profit > 0) {
        insights.push(`🌏 Best trading session: ${bestSessionEntry[0]} ($${bestSessionEntry[1].profit.toFixed(2)})`);
      }
      insights.push(`📈 Highest win rate: ${bestSessionWinRateEntry[0]} (${((bestSessionWinRateEntry[1].wins / bestSessionWinRateEntry[1].total) * 100).toFixed(1)}%)`);

      if (!["London (08-16 UTC)", "Overlap (13-16 UTC)"].includes(bestSessionEntry[0])) {
        recommendations.push(`Consider trading during ${bestSessionEntry[0]} - your most profitable session`);
      }
    }

    // Pair analysis - optimized
    const pairs = Object.entries(stats.byPair)
      .map(([name, stats]) => ({ name, winRate: ((stats.wins / stats.total) * 100).toFixed(1), profit: stats.profit.toFixed(2), count: stats.total }))
      .sort((a, b) => parseFloat(b.profit) - parseFloat(a.profit));

    if (pairs.length > 0 && parseFloat(pairs[0].profit) > 0) insights.push(`🎯 Best performing pair: ${pairs[0].name} ($${pairs[0].profit})`);
    if (pairs.length > 2) recommendations.push(`Focus on: ${pairs.slice(0, 2).map(p => p.name).join(", ")} - your top performers`);

    // Day analysis - optimized
    const bestDay = Object.entries(stats.byDay).reduce((a, b) => a[1] > b[1] ? a : b);
    if (bestDay[1] > 0) {
      insights.push(`📅 Most profitable day: ${bestDay[0]} ($${bestDay[1].toFixed(2)})`);
      recommendations.push(`Focus your trading on ${bestDay[0]} - your best performing day`);
    }

    const worstDay = Object.entries(stats.byDay).reduce((a, b) => a[1] < b[1] ? a : b);
    if (worstDay[1] < -50) {
      recommendations.push(`Avoid or reduce size on ${worstDay[0]} - your least profitable day`);
    }

    // =====================================================
    // Structured analytics for AI Analytics page - OPTIMIZED
    // =====================================================

    // 1) Behavior & discipline
    const behaviorTotal = trades.length || 1;
    const behaviorRuleEmotion = {
      planPct: ((stats.behaviorBuckets.Plan.count / behaviorTotal) * 100).toFixed(1),
      emotionPct: (((stats.behaviorBuckets.Emotion.count + stats.behaviorBuckets.Impulsive.count) / behaviorTotal) * 100).toFixed(1),
      planPnl: stats.behaviorBuckets.Plan.pnl.toFixed(2),
      emotionPnl: (stats.behaviorBuckets.Emotion.pnl + stats.behaviorBuckets.Impulsive.pnl).toFixed(2)
    };

    // Weekly discipline trend (plan adherence + P&L per week)
    const weeklyDisciplineTrend = Object.entries(stats.weeklyPlan)
      .sort(([a], [b]) => (a > b ? 1 : -1))
      .slice(-12)
      .map(([week, v]) => ({
        week,
        planAdherencePct: v.total ? parseFloat(((v.plan / v.total) * 100).toFixed(1)) : 0,
        pnl: parseFloat(v.pnl.toFixed(2)),
        total: v.total,
      }));
    const planTimeline = weeklyDisciplineTrend.map(w => ({ week: w.week, planAdherencePct: String(w.planAdherencePct) }));

    // Revenge trading detector - optimized with early exit
    const revengeTrades = [];
    for (let i = 1; i < trades.length && revengeTrades.length < 10; i++) {
      const prev = trades[i - 1];
      const curr = trades[i];
      const prevLoss = (prev.profit || 0) < 0;
      const prevRisk = prev.entryPrice && prev.stopLoss ? Math.abs(prev.entryPrice - prev.stopLoss) : 0;
      const currRisk = curr.entryPrice && curr.stopLoss ? Math.abs(curr.entryPrice - curr.stopLoss) : 0;
      const sameDay = new Date(prev.tradeDate || prev.createdAt).toDateString() === new Date(curr.tradeDate || curr.createdAt).toDateString();

      if (prevLoss && sameDay && prevRisk > 0 && currRisk > prevRisk * 1.5) {
        revengeTrades.push({ id: curr._id, pair: curr.pair, createdAt: curr.tradeDate || curr.createdAt, prevProfit: prev.profit, currRisk, prevRisk });
      }
    }
    const revengeCostTotal = revengeTrades.reduce((acc, t) => acc + (t.prevProfit || 0), 0);

    // Mistake feed — top costly recurring mistakes
    const mistakeFeed = Object.entries(stats.mistakeTagStats)
      .map(([tag, s]) => ({ tag, count: s.count, totalPnl: parseFloat(s.pnl.toFixed(2)), avgPnl: parseFloat((s.pnl / s.count).toFixed(2)), lessons: s.lessons }))
      .sort((a, b) => a.totalPnl - b.totalPnl) // most costly first
      .slice(0, 5);

    const behaviorDiscipline = { ruleEmotion: behaviorRuleEmotion, planTimeline, revengeTradesCount: revengeTrades.length, revengeTrades, revengeCostTotal: revengeCostTotal.toFixed(2) };

    // 2) Session edge card
    const sessionEdge = sessionEntries.map(([name, s]) => ({
      session: name,
      winRate: ((s.wins / s.total) * 100).toFixed(1),
      avgProfit: (s.total ? s.profit / s.total : 0).toFixed(2),
      totalProfit: (s.profit || 0).toFixed(2),
      trades: s.total,
      tag: s.profit > 0 ? "Green" : "Red"
    }));

    // 3) Psychological patterns - simplified
    const afterBigWin = [], afterBigLoss = [];
    const tiltDays = [];
    let avgAbsLoss = stats.losingTrades.length ? totalLossAmount / stats.losingTrades.length : 0;
    const bigThreshold = avgAbsLoss > 0 ? avgAbsLoss * 1.5 : 0;

    if (bigThreshold > 0) {
      for (let i = 1; i < trades.length; i++) {
        const prevPnl = trades[i - 1].profit || 0;
        if (prevPnl >= bigThreshold) afterBigWin.push(trades[i]);
        else if (prevPnl <= -bigThreshold) afterBigLoss.push(trades[i]);
      }
    }

    const calcBucketStats = bucket => {
      if (!bucket.length) return { trades: 0, winRate: "0.0", avgProfit: "0.00" };
      const winsLocal = bucket.filter(t => (t.profit || 0) > 0).length;
      const pnlLocal = bucket.reduce((acc, t) => acc + (t.profit || 0), 0);
      return { trades: bucket.length, winRate: ((winsLocal / bucket.length) * 100).toFixed(1), avgProfit: (pnlLocal / bucket.length).toFixed(2) };
    };

    // Tilt detection - simplified
    let currentStreak = [];
    trades.forEach((t, idx) => {
      if ((t.profit || 0) < 0) {
        currentStreak.push(t);
        if (currentStreak.length >= 3 && idx < trades.length - 1 && (trades[idx + 1]?.profit || 0) >= 0) {
          const increasing = currentStreak.every((trade, i) => i === 0 || (trade.lotSize || 0) >= (currentStreak[i - 1]?.lotSize || 0));
          if (increasing) {
            tiltDays.push({ day: new Date(currentStreak[0].createdAt).toDateString(), streakLength: currentStreak.length, totalLoss: currentStreak.reduce((a, tr) => a + (tr.profit || 0), 0).toFixed(2) });
          }
        }
      } else {
        currentStreak = [];
      }
    });

    const psychologicalPatterns = { afterBigWin: calcBucketStats(afterBigWin), afterBigLoss: calcBucketStats(afterBigLoss), tiltDays: tiltDays.slice(0, 5) };

    // 4) Strategy performance league table
    const strategyLeague = Object.entries(stats.strategyStats)
      .map(([name, s]) => ({ strategy: name, trades: s.trades, winRate: s.trades ? ((s.wins / s.trades) * 100).toFixed(1) : "0.0", totalProfit: s.pnl.toFixed(2), avgProfit: (s.trades ? s.pnl / s.trades : 0).toFixed(2) }))
      .sort((a, b) => parseFloat(b.totalProfit) - parseFloat(a.totalProfit));

    // 5) Weekly narrative
    const recentWeeks = planTimeline.slice(-4);
    const latestWeek = recentWeeks[recentWeeks.length - 1];
    const bestSessionStructured = bestSessionEntry && bestSessionEntry[1].profit > 0 ? bestSessionEntry[0] : null;
    const weeklyNarrativeParts = [];
    if (latestWeek) weeklyNarrativeParts.push(`This week you followed your plan on ${latestWeek.planAdherencePct}% of trades.`);
    if (bestSessionStructured) weeklyNarrativeParts.push(`Most of your profit came from the ${bestSessionStructured} session.`);
    if (worstDay[1] < 0) weeklyNarrativeParts.push(`You lost the most on ${worstDay[0]}, especially when trading outside your best conditions.`);
    const weeklyNarrative = weeklyNarrativeParts.join(" ");

    const nextWeekChecklist = [];
    if (behaviorRuleEmotion.planPct < 70) nextWeekChecklist.push("Increase the share of 'Plan' trades above 70% by using your checklist.");
    if (tiltDays.length > 0) nextWeekChecklist.push("Avoid new trades after 3 consecutive losses or reduce size significantly.");
    if (bestSessionStructured) nextWeekChecklist.push(`Prioritize setups during the ${bestSessionStructured} session.`);
    if (nextWeekChecklist.length === 0) nextWeekChecklist.push("Keep following your current process; maintain discipline and journaling.");

    // Risk management
    const tradesWithSL = trades.filter(t => t.stopLoss).length;
    if (tradesWithSL / trades.length < 0.5) recommendations.push(`⚠️ Use stop losses on more trades - only ${((tradesWithSL / trades.length) * 100).toFixed(0)}% have SL set`);

    // Calculate score
    let score = 50;
    score += Math.min(20, winRate - 40);
    if (avgWin / Math.max(0.01, avgLoss) >= 2) score += 15;
    if (totalProfit > 0) score += 15;
    if (tradesWithSL / Math.max(1, trades.length) >= 0.8) score += 10;
    score = Math.min(100, Math.max(0, score));

    res.json({
      insights,
      recommendations,
      score: score.toFixed(0),
      behaviorDiscipline,
      sessionEdge,
      psychologicalPatterns,
      strategyLeague,
      weeklyNarrative,
      nextWeekChecklist,
      mistakeFeed,
      weeklyDisciplineTrend,
      topStrategies: strategyLeague.slice(0, 5),
      topPairs: pairs.slice(0, 5),
      bestDay: bestDay[0],
      worstDay: worstDay[0],
      bestSession: bestSessionStructured,
      stats: {
        totalTrades: trades.length,
        winRate: winRate.toFixed(1),
        avgWin: avgWin.toFixed(2),
        avgLoss: avgLoss.toFixed(2),
        profitFactor: avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) : avgWin > 0 ? "∞" : "0.00"
      }
    });
  } catch (error) {
    handleAnalyticsError(error);
  }
});

// 8. Advanced Analytics (all-in-one) - OPTIMIZED
exports.getAdvancedAnalytics = asyncHandler(async (req, res) => {
  try {
    const query = forexQuery(req);
    const trades = await Trade.find(query).lean()
      .sort({ tradeDate: 1, createdAt: 1 })
      .select("profit commission swap entryPrice stopLoss takeProfit riskRewardRatio pair type tradeDate createdAt balance")
      .limit(10000);

    if (!trades.length) {
      return res.json({ totalTrades: 0, totalProfit: "0.00", netProfit: "0.00", winRate: "0.0", avgWin: "0.00", avgLoss: "0.00", avgRR: "0.00", actualRR: "0.00", profitFactor: "0.00", maxWinStreak: 0, maxLossStreak: 0, maxDrawdown: "0.00", totalCosts: "0.00", aiScore: "0", recentTrades: [] });
    }

    // Single-pass aggregation
    let totalProfit = 0, totalCommission = 0, totalSwap = 0;
    let winningTrades = [], losingTrades = [];
    let maxWinStreak = 0, maxLossStreak = 0, tempWinStreak = 0, tempLossStreak = 0;
    let balance = trades[0]?.balance || 10000, peak = balance, maxDrawdown = 0;
    let totalRR = 0, rrCount = 0;

    trades.forEach(t => {
      const profit = t.profit || 0;
      totalProfit += profit;
      totalCommission += t.commission || 0;
      totalSwap += t.swap || 0;

      if (profit > 0) winningTrades.push(t);
      else if (profit < 0) losingTrades.push(t);

      // Streaks
      if (profit > 0) { tempWinStreak++; tempLossStreak = 0; maxWinStreak = Math.max(maxWinStreak, tempWinStreak); }
      else if (profit < 0) { tempLossStreak++; tempWinStreak = 0; maxLossStreak = Math.max(maxLossStreak, tempLossStreak); }

      // Drawdown
      balance += profit;
      if (balance > peak) peak = balance;
      maxDrawdown = Math.max(maxDrawdown, peak - balance);

      // RR calculation
      let trr = (t.entryPrice && t.stopLoss && t.takeProfit && Math.abs(t.entryPrice - t.stopLoss) > 0)
        ? Math.abs(t.takeProfit - t.entryPrice) / Math.abs(t.entryPrice - t.stopLoss)
        : 0;
      if (trr <= 0 && t.riskRewardRatio && t.riskRewardRatio.includes(":")) {
        const val = parseFloat(t.riskRewardRatio.split(":")[1]);
        if (!isNaN(val)) trr = val;
      }
      if (trr > 0) { totalRR += trr; rrCount++; }
    });

    const totalWins = winningTrades.reduce((acc, t) => acc + (t.profit || 0), 0);
    const totalLosses = Math.abs(losingTrades.reduce((acc, t) => acc + (t.profit || 0), 0));
    const avgWin = winningTrades.length ? totalWins / winningTrades.length : 0;
    const avgLoss = losingTrades.length ? totalLosses / losingTrades.length : 0;
    const winRate = (winningTrades.length / trades.length) * 100;
    const netProfit = totalProfit - totalCommission - totalSwap;
    const avgRR = rrCount > 0 ? totalRR / rrCount : (avgLoss > 0 ? avgWin / avgLoss : 0);

    // Score calculation
    let score = 50;
    score += Math.min(20, winRate - 40);
    if (avgRR >= 2) score += 15;
    if (totalProfit > 0) score += 15;
    const tradesWithSL = trades.filter(t => t.stopLoss).length;
    if (tradesWithSL / trades.length >= 0.8) score += 10;
    score = Math.min(100, Math.max(0, score));

    res.json({
      totalTrades: trades.length,
      totalProfit: totalProfit.toFixed(2),
      netProfit: netProfit.toFixed(2),
      winRate: winRate.toFixed(1),
      avgWin: avgWin.toFixed(2),
      avgLoss: avgLoss.toFixed(2),
      avgRR: avgRR.toFixed(2),
      actualRR: avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) : "0.00",
      profitFactor: totalLosses > 0 ? (totalWins / totalLosses).toFixed(2) : totalWins > 0 ? "∞" : "0.00",
      maxWinStreak,
      maxLossStreak,
      maxDrawdown: maxDrawdown.toFixed(2),
      totalCosts: (totalCommission + totalSwap).toFixed(2),
      aiScore: score.toFixed(0),
      recentTrades: trades.slice(-10).reverse().map(t => ({ pair: t.pair, type: t.type, profit: t.profit, createdAt: t.createdAt }))
    });
  } catch (error) {
    handleAnalyticsError(error);
  }
});

// ============================================
// PSYCHOLOGY ANALYTICS
// ============================================

exports.getPsychologyAnalytics = asyncHandler(async (req, res) => {
  try {
    const query = forexQuery(req);
    const trades = await Trade.find(query).lean().sort({ createdAt: 1 });

    if (trades.length === 0) {
      return res.json({
        moodAnalysis: [], confidenceAnalysis: [], emotionalTagImpact: [],
        psychologyScore: 0, scoreBreakdown: {},
        wouldRetakeAnalysis: { yes: null, no: null }, totalTrackedTrades: 0
      });
    }

    // 1) Mood Analysis (1–5)
    const moodBuckets = {};
    trades.forEach(t => {
      if (t.mood != null && t.mood >= 1 && t.mood <= 5) {
        if (!moodBuckets[t.mood]) moodBuckets[t.mood] = { trades: 0, wins: 0, losses: 0, pnl: 0 };
        moodBuckets[t.mood].trades++;
        moodBuckets[t.mood].pnl += t.profit || 0;
        if ((t.profit || 0) > 0) moodBuckets[t.mood].wins++;
        else if ((t.profit || 0) < 0) moodBuckets[t.mood].losses++;
      }
    });

    const moodLabels = { 1: "😰 Stressed", 2: "😟 Anxious", 3: "😐 Neutral", 4: "😊 Good", 5: "🔥 Peak" };
    const moodAnalysis = Object.entries(moodBuckets).map(([level, s]) => ({
      level: parseInt(level),
      label: moodLabels[level] || `Mood ${level}`,
      trades: s.trades, wins: s.wins, losses: s.losses,
      winRate: s.trades ? ((s.wins / s.trades) * 100).toFixed(1) : "0.0",
      avgProfit: s.trades ? (s.pnl / s.trades).toFixed(2) : "0.00",
      totalProfit: s.pnl.toFixed(2)
    })).sort((a, b) => a.level - b.level);

    // 2) Confidence Analysis
    const confBuckets = {};
    trades.forEach(t => {
      if (t.confidence && t.confidence !== "") {
        if (!confBuckets[t.confidence]) confBuckets[t.confidence] = { trades: 0, wins: 0, losses: 0, pnl: 0 };
        confBuckets[t.confidence].trades++;
        confBuckets[t.confidence].pnl += t.profit || 0;
        if ((t.profit || 0) > 0) confBuckets[t.confidence].wins++;
        else if ((t.profit || 0) < 0) confBuckets[t.confidence].losses++;
      }
    });

    const confOrder = ["Low", "Medium", "High", "Overconfident"];
    const confidenceAnalysis = confOrder.filter(c => confBuckets[c]).map(c => {
      const s = confBuckets[c];
      return {
        level: c, trades: s.trades, wins: s.wins, losses: s.losses,
        winRate: s.trades ? ((s.wins / s.trades) * 100).toFixed(1) : "0.0",
        avgProfit: s.trades ? (s.pnl / s.trades).toFixed(2) : "0.00",
        totalProfit: s.pnl.toFixed(2)
      };
    });

    // 3) Emotional Tag Impact
    const tagBuckets = {};
    trades.forEach(t => {
      if (Array.isArray(t.emotionalTags)) {
        t.emotionalTags.forEach(tag => {
          if (!tagBuckets[tag]) tagBuckets[tag] = { trades: 0, wins: 0, losses: 0, pnl: 0 };
          tagBuckets[tag].trades++;
          tagBuckets[tag].pnl += t.profit || 0;
          if ((t.profit || 0) > 0) tagBuckets[tag].wins++;
          else if ((t.profit || 0) < 0) tagBuckets[tag].losses++;
        });
      }
    });

    const tagEmojis = { FOMO: "😨", Revenge: "😡", Fear: "😰", Greed: "🤑", Calm: "🧘", Bored: "😴", Focused: "🎯", Frustrated: "😤" };
    const emotionalTagImpact = Object.entries(tagBuckets)
      .map(([tag, s]) => ({
        tag, emoji: tagEmojis[tag] || "", trades: s.trades, wins: s.wins, losses: s.losses,
        winRate: s.trades ? ((s.wins / s.trades) * 100).toFixed(1) : "0.0",
        avgProfit: s.trades ? (s.pnl / s.trades).toFixed(2) : "0.00",
        totalProfit: s.pnl.toFixed(2)
      }))
      .sort((a, b) => b.trades - a.trades);

    // 4) Psychology Score (0–100)
    const totalTrades = trades.length;
    const planTrades = trades.filter(t => t.entryBasis === "Plan").length;
    const planAdherencePct = totalTrades ? (planTrades / totalTrades) * 100 : 0;

    const calmTrades = trades.filter(t =>
      Array.isArray(t.emotionalTags) && (t.emotionalTags.includes("Calm") || t.emotionalTags.includes("Focused"))
    ).length;
    const calmPct = totalTrades ? (calmTrades / totalTrades) * 100 : 0;

    let revengeCount = 0;
    for (let i = 1; i < trades.length; i++) {
      const prev = trades[i - 1];
      const curr = trades[i];
      const prevLoss = (prev.profit || 0) < 0;
      const prevRisk = prev.entryPrice && prev.stopLoss ? Math.abs(prev.entryPrice - prev.stopLoss) : 0;
      const currRisk = curr.entryPrice && curr.stopLoss ? Math.abs(curr.entryPrice - curr.stopLoss) : 0;
      const sameDay = new Date(prev.createdAt).toDateString() === new Date(curr.createdAt).toDateString();
      if (prevLoss && sameDay && prevRisk > 0 && currRisk > prevRisk * 1.5) revengeCount++;
    }
    const noRevengePct = totalTrades ? ((totalTrades - revengeCount) / totalTrades) * 100 : 100;

    const goodMoodTrades = trades.filter(t => t.mood != null && t.mood >= 3).length;
    const moodTrackedTrades = trades.filter(t => t.mood != null).length;
    const goodMoodPct = moodTrackedTrades > 0 ? (goodMoodTrades / moodTrackedTrades) * 100 : 50;

    const retakeYes = trades.filter(t => t.wouldRetake === "Yes").length;
    const retakeTracked = trades.filter(t => t.wouldRetake === "Yes" || t.wouldRetake === "No").length;
    const wouldRetakePct = retakeTracked > 0 ? (retakeYes / retakeTracked) * 100 : 50;

    const psychologyScore = Math.min(100, Math.max(0, Math.round(
      (planAdherencePct * 0.30) + (calmPct * 0.25) + (noRevengePct * 0.20) +
      (goodMoodPct * 0.15) + (wouldRetakePct * 0.10)
    )));

    const scoreBreakdown = {
      planAdherencePct: planAdherencePct.toFixed(1),
      calmTradingPct: calmPct.toFixed(1),
      noRevengePct: noRevengePct.toFixed(1),
      goodMoodPct: goodMoodPct.toFixed(1),
      wouldRetakePct: wouldRetakePct.toFixed(1)
    };

    // 5) Would Retake Analysis
    const calcRetakeBucket = (filter) => {
      const bucket = trades.filter(filter);
      if (!bucket.length) return null;
      const wins = bucket.filter(t => (t.profit || 0) > 0).length;
      const pnl = bucket.reduce((acc, t) => acc + (t.profit || 0), 0);
      return {
        trades: bucket.length, wins,
        winRate: ((wins / bucket.length) * 100).toFixed(1),
        avgProfit: (pnl / bucket.length).toFixed(2),
        totalProfit: pnl.toFixed(2)
      };
    };

    const wouldRetakeAnalysis = {
      yes: calcRetakeBucket(t => t.wouldRetake === "Yes"),
      no: calcRetakeBucket(t => t.wouldRetake === "No")
    };

    const totalTrackedTrades = trades.filter(t =>
      t.mood != null || (t.confidence && t.confidence !== "") ||
      (Array.isArray(t.emotionalTags) && t.emotionalTags.length > 0) ||
      (t.wouldRetake && t.wouldRetake !== "")
    ).length;

    res.json({
      moodAnalysis, confidenceAnalysis, emotionalTagImpact,
      psychologyScore, scoreBreakdown, wouldRetakeAnalysis, totalTrackedTrades
    });
  } catch (error) {
    handleAnalyticsError(error);
  }
});

// ============================================
// TRADE QUALITY ANALYSIS
// ============================================

exports.getTradeQualityAnalysis = asyncHandler(async (req, res) => {
  try {
    forexQuery(req);
    const snapshot = await analyticsSnapshotService.getTradeQualitySnapshot({
      userId: req.user._id,
      market: "Forex",
    });
    res.json(snapshot.quality);
  } catch (error) {
    handleAnalyticsError(error);
  }
});

// ============================================
// SELF AWARENESS SCORE
// ============================================

exports.getSelfAwarenessScore = asyncHandler(async (req, res) => {
  try {
    forexQuery(req);
    const snapshot = await analyticsSnapshotService.getSnapshot({
      userId: req.user._id,
      market: "Forex",
    });
    res.json(snapshot.selfAwareness);
  } catch (error) {
    handleAnalyticsError(error);
  }
});

// ============================================
// TRADING DNA ENGINE
// ============================================

exports.getTradingDNA = asyncHandler(async (req, res) => {
  try {
    forexQuery(req);
    const snapshot = await analyticsSnapshotService.getSnapshot({
      userId: req.user._id,
      market: "Forex",
    });
    res.json(snapshot.tradingDNA);
  } catch (error) {
    handleAnalyticsError(error);
  }
});

// ============================================
// PSYCHOLOGY COST CALCULATOR
// ============================================

exports.getPsychologyCost = asyncHandler(async (req, res) => {
  try {
    forexQuery(req);
    const daysParam = parseInt(req.query.days, 10);
    const snapshot = await analyticsSnapshotService.getSnapshot({
      userId: req.user._id,
      market: "Forex",
      dateRange: daysParam > 0 && daysParam <= 3650
        ? { from: new Date(Date.now() - daysParam * 24 * 60 * 60 * 1000) }
        : undefined,
    });
    res.json(snapshot.psychologyCost);
  } catch (error) {
    handleAnalyticsError(error);
  }
});
