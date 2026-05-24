const IndianTrade = require("../models/IndianTrade");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");
const toNum = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const safeDivide = (a, b) => {
  const d = toNum(b);
  if (d === 0) return 0;
  return toNum(a) / d;
};
const fixed = (value, digits = 2) => toNum(value).toFixed(digits);

const userQuery = (req) => {
  const instrumentType = (req.query.instrumentType || "OPTION").toUpperCase();
  if (!["OPTION", "EQUITY"].includes(instrumentType)) {
    throw new ApiError(400, "Invalid instrumentType");
  }
  return { user: req.user._id, instrumentType };
};

// ========== BASIC ANALYTICS ==========

exports.getSummary = asyncHandler(async (req, res) => {
  try {
    const trades = await IndianTrade.find(userQuery(req)).lean().sort({ createdAt: -1 });

    const totalTrades = trades.length;
    const totalProfit = trades.reduce((acc, t) => acc + toNum(t.profit), 0);
    const wins = trades.filter(t => t.profit > 0).length;
    const winRate = totalTrades ? (wins / totalTrades) * 100 : 0;

    const winningTrades = trades.filter(t => t.profit > 0);
    const losingTrades = trades.filter(t => t.profit < 0);
    const avgWin = winningTrades.length
      ? winningTrades.reduce((acc, t) => acc + toNum(t.profit), 0) / winningTrades.length
      : 0;
    const avgLoss = losingTrades.length
      ? Math.abs(losingTrades.reduce((acc, t) => acc + toNum(t.profit), 0) / losingTrades.length)
      : 0;

    const totalCosts = trades.reduce((acc, t) => acc + (t.brokerage || 0) + (t.sttTaxes || 0), 0);
    const netProfit = totalProfit - totalCosts;

    // Setup Quality Stats
    const tradesWithScore = trades.filter(t => t.setupScore !== null && t.setupScore !== undefined);
    const avgSetupScore = tradesWithScore.length
      ? tradesWithScore.reduce((acc, t) => acc + t.setupScore, 0) / tradesWithScore.length
      : 0;

    res.json({
      totalTrades,
      totalProfit: fixed(totalProfit),
      netProfit: fixed(netProfit),
      winRate: fixed(winRate, 1),
      avgTrade: fixed(totalTrades ? totalProfit / totalTrades : 0),
      avgWin: fixed(avgWin),
      avgLoss: fixed(avgLoss),
      totalCosts: fixed(totalCosts),
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      avgSetupScore: avgSetupScore.toFixed(1)
    });
  } catch (error) {
    throw new ApiError(500, error.message);
  }
});

exports.getWeeklyStats = asyncHandler(async (req, res) => {
  try {
    const trades = await IndianTrade.find(userQuery(req)).lean().sort({ createdAt: 1 });
    const weekly = {};
    
    trades.forEach(trade => {
      const date = new Date(trade.createdAt);
      // ISO week calculation helper
      const d = new Date(date.getTime());
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + 4 - (d.getDay() || 7));
      const yearStart = new Date(d.getFullYear(), 0, 1);
      const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
      const week = `${d.getFullYear()}-W${weekNo}`;
      
      if (!weekly[week]) weekly[week] = 0;
      weekly[week] += trade.profit || 0;
    });
    res.json(weekly);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/**
 * NEW: getPnLBreakdown
 * Returns daily, weekly, and monthly P&L series for charts.
 */
exports.getPnLBreakdown = asyncHandler(async (req, res) => {
  try {
    const trades = await IndianTrade.find(userQuery(req)).lean().sort({ createdAt: 1 });
    
    const dailyMap = {};
    const weeklyMap = {};
    const monthlyMap = {};

    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    trades.forEach(t => {
      const date = new Date(t.createdAt);
      const profit = t.profit || 0;

      // Daily
      const dKey = date.toISOString().split('T')[0];
      dailyMap[dKey] = (dailyMap[dKey] || 0) + profit;

      // Weekly (ISO)
      const d = new Date(date.getTime());
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + 4 - (d.getDay() || 7));
      const yearStart = new Date(d.getFullYear(), 0, 1);
      const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
      const wKey = `${d.getFullYear()}-W${weekNo}`;
      weeklyMap[wKey] = (weeklyMap[wKey] || 0) + profit;

      // Monthly
      const mKey = `${monthNames[date.getMonth()]} ${date.getFullYear()}`;
      monthlyMap[mKey] = (monthlyMap[mKey] || 0) + profit;
    });

    const daily = Object.entries(dailyMap).map(([date, profit]) => ({ date, profit: parseFloat(profit.toFixed(2)) }));
    const weekly = Object.entries(weeklyMap).map(([week, profit]) => ({ week, profit: parseFloat(profit.toFixed(2)) }));
    const monthly = Object.entries(monthlyMap).map(([month, profit]) => ({ month, profit: parseFloat(profit.toFixed(2)) }));

    res.json({ daily, weekly, monthly });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ========== ADVANCED ANALYTICS ==========

exports.getRiskRewardAnalysis = asyncHandler(async (req, res) => {
  try {
    const trades = await IndianTrade.find(userQuery(req)).lean();
    const tradesWithRR = trades.filter(t => t.stopLoss && t.takeProfit && t.entryPrice);

    const winningTrades = trades.filter(t => t.profit > 0);
    const losingTrades = trades.filter(t => t.profit < 0);
    const avgWin = winningTrades.length ? winningTrades.reduce((acc, t) => acc + t.profit, 0) / winningTrades.length : 0;
    const avgLoss = losingTrades.length ? Math.abs(losingTrades.reduce((acc, t) => acc + t.profit, 0) / losingTrades.length) : 0;
    const actualRR = avgLoss > 0 ? avgWin / avgLoss : 0;

    let plannedRR = 0;
    let totalRRFromPrices = 0;
    let totalRisk = 0;
    let tradesCountedForRR = 0;
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
      if (tradeRRFromPrices > 0) {
        totalRRFromPrices += tradeRRFromPrices;
        tradesCountedForRR++;
      }
      if (tradeRRFromField > 0) {
        fieldRRTotal += tradeRRFromField;
        fieldRRCount++;
      }
    });

    plannedRR = tradesCountedForRR > 0 ? totalRRFromPrices / tradesCountedForRR : 0;
    let avgRR = 0;
    if (fieldRRCount > 0) avgRR = fieldRRTotal / fieldRRCount;
    else if (plannedRR > 0) avgRR = plannedRR;
    else avgRR = actualRR;
    const riskPerTrade = tradesCountedForRR > 0 ? totalRisk / tradesCountedForRR : 0;

    const winRate = trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0;
    const expectancy = ((avgRR * (winRate / 100)) - ((100 - winRate) / 100)).toFixed(2);

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
    throw new ApiError(500, error.message);
  }
});

exports.getTradeDistribution = asyncHandler(async (req, res) => {
  try {
    const trades = await IndianTrade.find(userQuery(req)).lean();

    const byPair = {};
    trades.forEach(t => {
      if (!byPair[t.pair]) byPair[t.pair] = { total: 0, wins: 0, losses: 0, profit: 0 };
      byPair[t.pair].total++;
      if (t.profit > 0) byPair[t.pair].wins++;
      else if (t.profit < 0) byPair[t.pair].losses++;
      byPair[t.pair].profit += t.profit || 0;
    });
    Object.keys(byPair).forEach(pair => (byPair[pair].winRate = ((byPair[pair].wins / byPair[pair].total) * 100).toFixed(1)));

    const byType = { BUY: { total: 0, wins: 0, losses: 0, profit: 0 }, SELL: { total: 0, wins: 0, losses: 0, profit: 0 } };
    trades.forEach(t => {
      if (byType[t.type]) {
        byType[t.type].total++;
        if (t.profit > 0) byType[t.type].wins++;
        else if (t.profit < 0) byType[t.type].losses++;
        byType[t.type].profit += t.profit || 0;
      }
    });
    Object.keys(byType).forEach(type => (byType[type].winRate = byType[type].total ? ((byType[type].wins / byType[type].total) * 100).toFixed(1) : 0));

    const byStrategy = {};
    trades.forEach(t => {
      const strat = t.strategy || "Unspecified";
      if (!byStrategy[strat]) byStrategy[strat] = { total: 0, wins: 0, losses: 0, profit: 0 };
      byStrategy[strat].total++;
      if (t.profit > 0) byStrategy[strat].wins++;
      else if (t.profit < 0) byStrategy[strat].losses++;
      byStrategy[strat].profit += t.profit || 0;
    });
    Object.keys(byStrategy).forEach(strat => (byStrategy[strat].winRate = ((byStrategy[strat].wins / byStrategy[strat].total) * 100).toFixed(1)));

    // Indian market sessions in IST (UTC+5:30)
    // Opening Bell: 9:15â€“11:00 IST | Mid-Session: 11:00â€“13:30 IST
    // Post-Lunch:  13:30â€“15:00 IST | Closing:      15:00â€“15:30 IST
    const bySession = {
      "Opening Bell": { total: 0, wins: 0, losses: 0, profit: 0 },
      "Mid-Session":  { total: 0, wins: 0, losses: 0, profit: 0 },
      "Post-Lunch":   { total: 0, wins: 0, losses: 0, profit: 0 },
      "Closing":      { total: 0, wins: 0, losses: 0, profit: 0 },
      "Outside Market": { total: 0, wins: 0, losses: 0, profit: 0 },
    };
    trades.forEach(t => {
      let session;
      if (t.session && bySession[t.session]) {
        session = t.session;
      } else {
        // Convert UTC timestamp to IST minute-of-day
        const d = new Date(t.createdAt);
        const istMinutes = (d.getUTCHours() * 60 + d.getUTCMinutes() + 330) % 1440;
        if (istMinutes >= 555 && istMinutes < 660)       session = "Opening Bell"; // 9:15â€“11:00
        else if (istMinutes >= 660 && istMinutes < 810)  session = "Mid-Session";  // 11:00â€“13:30
        else if (istMinutes >= 810 && istMinutes < 900)  session = "Post-Lunch";   // 13:30â€“15:00
        else if (istMinutes >= 900 && istMinutes < 930)  session = "Closing";      // 15:00â€“15:30
        else                                              session = "Outside Market";
      }
      bySession[session].total++;
      if (t.profit > 0) bySession[session].wins++;
      else if (t.profit < 0) bySession[session].losses++;
      bySession[session].profit += t.profit || 0;
    });
    Object.keys(bySession).forEach(session => {
      bySession[session].winRate = bySession[session].total ? ((bySession[session].wins / bySession[session].total) * 100).toFixed(1) : 0;
    });

    // By trade type (INTRADAY / DELIVERY / SWING)
    const byTradeType = {};
    trades.forEach(t => {
      const key = t.tradeType && t.tradeType.trim() ? t.tradeType : "Unspecified";
      if (!byTradeType[key]) byTradeType[key] = { total: 0, wins: 0, losses: 0, profit: 0 };
      byTradeType[key].total++;
      if (t.profit > 0) byTradeType[key].wins++;
      else if (t.profit < 0) byTradeType[key].losses++;
      byTradeType[key].profit += t.profit || 0;
    });
    Object.keys(byTradeType).forEach(k => (byTradeType[k].winRate = byTradeType[k].total ? ((byTradeType[k].wins / byTradeType[k].total) * 100).toFixed(1) : 0));

    // By entry basis (Plan / Emotion / Impulsive / Custom)
    const byEntryBasis = {};
    trades.forEach(t => {
      const key = t.entryBasis && t.entryBasis.trim() ? t.entryBasis : "Plan";
      if (!byEntryBasis[key]) byEntryBasis[key] = { total: 0, wins: 0, losses: 0, profit: 0 };
      byEntryBasis[key].total++;
      if (t.profit > 0) byEntryBasis[key].wins++;
      else if (t.profit < 0) byEntryBasis[key].losses++;
      byEntryBasis[key].profit += t.profit || 0;
    });
    Object.keys(byEntryBasis).forEach(k => (byEntryBasis[k].winRate = byEntryBasis[k].total ? ((byEntryBasis[k].wins / byEntryBasis[k].total) * 100).toFixed(1) : 0));

    // By mistake tag (Overtraded, Held too long, etc.)
    const byMistakeTag = {};
    trades.forEach(t => {
      const key = t.mistakeTag && t.mistakeTag.trim() ? t.mistakeTag : "None";
      if (!byMistakeTag[key]) byMistakeTag[key] = { total: 0, wins: 0, losses: 0, profit: 0 };
      byMistakeTag[key].total++;
      if (t.profit > 0) byMistakeTag[key].wins++;
      else if (t.profit < 0) byMistakeTag[key].losses++;
      byMistakeTag[key].profit += t.profit || 0;
    });
    Object.keys(byMistakeTag).forEach(k => (byMistakeTag[k].winRate = byMistakeTag[k].total ? ((byMistakeTag[k].wins / byMistakeTag[k].total) * 100).toFixed(1) : 0));

    // By underlying (NIFTY, BANK NIFTY, etc.)
    const byUnderlying = {};
    trades.forEach(t => {
      const raw = (t.underlying && t.underlying.trim()) ? t.underlying.replace(/\s+/g, " ").trim() : (t.pair ? t.pair.replace(/\s+\d+\s*(CE|PE)$/i, "").trim() : "");
      const key = raw || "Unspecified";
      if (!byUnderlying[key]) byUnderlying[key] = { total: 0, wins: 0, losses: 0, profit: 0 };
      byUnderlying[key].total++;
      if (t.profit > 0) byUnderlying[key].wins++;
      else if (t.profit < 0) byUnderlying[key].losses++;
      byUnderlying[key].profit += t.profit || 0;
    });
    Object.keys(byUnderlying).forEach(k => (byUnderlying[k].winRate = byUnderlying[k].total ? ((byUnderlying[k].wins / byUnderlying[k].total) * 100).toFixed(1) : 0));

    // By option type (CE / PE)
    const byOptionType = {};
    trades.forEach(t => {
      const key = t.optionType && t.optionType.trim() ? t.optionType.trim().toUpperCase() : "Unspecified";
      if (!byOptionType[key]) byOptionType[key] = { total: 0, wins: 0, losses: 0, profit: 0 };
      byOptionType[key].total++;
      if (t.profit > 0) byOptionType[key].wins++;
      else if (t.profit < 0) byOptionType[key].losses++;
      byOptionType[key].profit += t.profit || 0;
    });
    Object.keys(byOptionType).forEach(k => (byOptionType[k].winRate = byOptionType[k].total ? ((byOptionType[k].wins / byOptionType[k].total) * 100).toFixed(1) : 0));

    // By direction: BUY vs SELL (from type field)
    const byDirection = {};
    trades.forEach(t => {
      const key = t.type ? t.type.trim().toUpperCase() : "Unspecified";
      if (!byDirection[key]) byDirection[key] = { total: 0, wins: 0, losses: 0, profit: 0 };
      byDirection[key].total++;
      if (t.profit > 0) byDirection[key].wins++;
      else if (t.profit < 0) byDirection[key].losses++;
      byDirection[key].profit += t.profit || 0;
    });
    Object.keys(byDirection).forEach(k => (byDirection[k].winRate = byDirection[k].total ? ((byDirection[k].wins / byDirection[k].total) * 100).toFixed(1) : 0));

    const isEquity = (req.query.instrumentType || "").toUpperCase() === "EQUITY";

    // Equity-specific: by stock symbol and by sector
    const byStockSymbol = {};
    const bySector = {};
    if (isEquity) {
      trades.forEach(t => {
        const symKey = (t.stockSymbol && t.stockSymbol.trim()) ? t.stockSymbol.toUpperCase() : "Unspecified";
        if (!byStockSymbol[symKey]) byStockSymbol[symKey] = { total: 0, wins: 0, losses: 0, profit: 0 };
        byStockSymbol[symKey].total++;
        if (t.profit > 0) byStockSymbol[symKey].wins++;
        else if (t.profit < 0) byStockSymbol[symKey].losses++;
        byStockSymbol[symKey].profit += t.profit || 0;

        const secKey = (t.sector && t.sector.trim()) ? t.sector : "Other";
        if (!bySector[secKey]) bySector[secKey] = { total: 0, wins: 0, losses: 0, profit: 0 };
        bySector[secKey].total++;
        if (t.profit > 0) bySector[secKey].wins++;
        else if (t.profit < 0) bySector[secKey].losses++;
        bySector[secKey].profit += t.profit || 0;
      });
      Object.keys(byStockSymbol).forEach(k => (byStockSymbol[k].winRate = byStockSymbol[k].total ? ((byStockSymbol[k].wins / byStockSymbol[k].total) * 100).toFixed(1) : 0));
      Object.keys(bySector).forEach(k => (bySector[k].winRate = bySector[k].total ? ((bySector[k].wins / bySector[k].total) * 100).toFixed(1) : 0));
    }

    res.json({
      byPair, byType, byDirection, byStrategy, bySession, byTradeType, byEntryBasis, byMistakeTag,
      // Options-specific (empty for equity)
      byUnderlying: isEquity ? {} : byUnderlying,
      byOptionType: isEquity ? {} : byOptionType,
      // Equity-specific (empty for options)
      byStockSymbol: isEquity ? byStockSymbol : {},
      bySector: isEquity ? bySector : {},
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

exports.getPerformanceMetrics = asyncHandler(async (req, res) => {
  try {
    const trades = await IndianTrade.find(userQuery(req)).lean().sort({ createdAt: 1 });

    const winningTrades = trades.filter(t => t.profit > 0);
    const losingTrades = trades.filter(t => t.profit < 0);

    const largestWin = winningTrades.length > 0 ? Math.max(...winningTrades.map(t => t.profit)) : 0;
    const largestLoss = losingTrades.length > 0 ? Math.min(...losingTrades.map(t => t.profit)) : 0;

    const avgWin = winningTrades.length ? winningTrades.reduce((acc, t) => acc + t.profit, 0) / winningTrades.length : 0;
    const avgLoss = losingTrades.length ? losingTrades.reduce((acc, t) => acc + t.profit, 0) / losingTrades.length : 0;

    let maxWinStreak = 0, maxLossStreak = 0, tempWinStreak = 0, tempLossStreak = 0;
    trades.forEach(t => {
      if (t.profit > 0) { tempWinStreak++; tempLossStreak = 0; maxWinStreak = Math.max(maxWinStreak, tempWinStreak); }
      else if (t.profit < 0) { tempLossStreak++; tempWinStreak = 0; maxLossStreak = Math.max(maxLossStreak, tempLossStreak); }
      // breakeven trades (profit === 0) intentionally don't touch either streak
    });

    const totalWins = winningTrades.reduce((acc, t) => acc + t.profit, 0);
    const totalLosses = Math.abs(losingTrades.reduce((acc, t) => acc + t.profit, 0));
    const profitFactor = fixed(safeDivide(totalWins, totalLosses));

    const winRate = trades.length ? (winningTrades.length / trades.length) * 100 : 0;
    const expectancy = ((avgWin * (winRate / 100)) + (avgLoss * ((100 - winRate) / 100))).toFixed(2);

    // Max drawdown for recovery factor
    let ddBalance = 0, ddPeak = 0, maxDD = 0;
    trades.forEach(t => {
      ddBalance += t.profit || 0;
      if (ddBalance > ddPeak) ddPeak = ddBalance;
      const dd = ddPeak - ddBalance;
      if (dd > maxDD) maxDD = dd;
    });
    const netProfit = totalWins - totalLosses;
    const recoveryFactor = maxDD > 0 ? (netProfit / maxDD).toFixed(2) : netProfit > 0 ? "âˆž" : "0.00";

    res.json({
      largestWin: fixed(largestWin),
      largestLoss: fixed(largestLoss),
      avgWin: fixed(avgWin),
      avgLoss: fixed(avgLoss),
      maxWinStreak,
      maxLossStreak,
      profitFactor,
      expectancy,
      totalWins: totalWins.toFixed(2),
      totalLosses: totalLosses.toFixed(2),
      winRate: winRate.toFixed(1),
      losingTradesCount: losingTrades.length,
      winningTradesCount: winningTrades.length,
      recoveryFactor,
    });
  } catch (error) {
    throw new ApiError(500, error.message);
  }
});

exports.getTimeAnalysis = asyncHandler(async (req, res) => {
  try {
    const trades = await IndianTrade.find(userQuery(req)).lean();

    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const byMonth = {};
    const byDate = {};
    trades.forEach(t => {
      const date = new Date(t.createdAt);
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
    Object.keys(byMonth).forEach(month => {
      byMonth[month].winRate = byMonth[month].total ? ((byMonth[month].wins / byMonth[month].total) * 100).toFixed(1) : 0;
      byMonth[month].avgProfit = byMonth[month].total ? (byMonth[month].profit / byMonth[month].total).toFixed(2) : 0;
    });
    Object.keys(byDate).forEach(dateKey => {
      byDate[dateKey].winRate = byDate[dateKey].total ? ((byDate[dateKey].wins / byDate[dateKey].total) * 100).toFixed(1) : 0;
      byDate[dateKey].avgProfit = byDate[dateKey].total ? (byDate[dateKey].profit / byDate[dateKey].total).toFixed(2) : 0;
      byDate[dateKey].profit = parseFloat(byDate[dateKey].profit.toFixed(2));
    });

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
      const day = dayNames[new Date(t.createdAt).getDay()];
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

    // All hours in IST (UTC+5:30) â€” Indian market only trades 9:15â€“15:30 IST
    const byHour = {};
    for (let i = 0; i < 24; i++) byHour[i] = { total: 0, wins: 0, losses: 0, profit: 0, winRate: 0, avgProfit: 0 };
    trades.forEach(t => {
      const d = new Date(t.createdAt);
      const istHour = Math.floor((d.getUTCHours() * 60 + d.getUTCMinutes() + 330) % 1440 / 60);
      byHour[istHour].total++;
      if (t.profit > 0) byHour[istHour].wins++;
      else if (t.profit < 0) byHour[istHour].losses++;
      byHour[istHour].profit += t.profit || 0;
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

    const bySession = {};
    trades.forEach(t => {
      const session = t.session || "Unspecified";
      if (!bySession[session]) bySession[session] = { total: 0, wins: 0, losses: 0, profit: 0, winRate: 0, avgProfit: 0 };
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
    const sessionEntries = Object.entries(bySession).filter(([name, s]) => name !== "Unspecified" && s.total > 0);
    let bestSession = ["0", { profit: 0, winRate: 0, total: 0 }];
    let worstSession = ["0", { profit: 0, winRate: 0, total: 0 }];
    if (sessionEntries.length > 0) {
      worstSession = sessionEntries.reduce((a, b) => (parseFloat(a[1].profit) < parseFloat(b[1].profit) ? a : b));
      const positiveSessions = sessionEntries.filter(([_, s]) => parseFloat(s.profit) > 0);
      if (positiveSessions.length > 0) bestSession = positiveSessions.reduce((a, b) => (parseFloat(a[1].profit) > parseFloat(b[1].profit) ? a : b));
    }
    const bestSessionWR = sessionEntries.length > 1 ? sessionEntries.reduce((a, b) => (parseFloat(a[1].winRate) > parseFloat(b[1].winRate) ? a : b)) : ["0", { winRate: 0, total: 0 }];

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
    res.status(500).json({ message: error.message });
  }
});

exports.getTradeQuality = asyncHandler(async (req, res) => {
  try {
    const trades = await IndianTrade.find(userQuery(req)).lean();

    const rrRanges = [
      { label: "0-0.5R", min: 0, max: 0.5, trades: [] },
      { label: "0.5-1R", min: 0.5, max: 1, trades: [] },
      { label: "1-1.5R", min: 1, max: 1.5, trades: [] },
      { label: "1.5-2R", min: 1.5, max: 2, trades: [] },
      { label: "2-3R", min: 2, max: 3, trades: [] },
      { label: "3R+", min: 3, max: Infinity, trades: [] }
    ];
    let rrSum = 0;
    let rrCount = 0;
    trades.forEach(t => {
      if (t.stopLoss && t.takeProfit && t.entryPrice) {
        const risk = Math.abs(t.entryPrice - t.stopLoss);
        const reward = Math.abs(t.takeProfit - t.entryPrice);
        const rr = risk > 0 ? reward / risk : 0;
        if (rr > 0) {
          rrSum += rr;
          rrCount += 1;
        }
        rrRanges.forEach(range => {
          if (rr >= range.min && rr < range.max) range.trades.push({ profit: t.profit, win: t.profit > 0 });
        });
      }
    });
    const rrAnalysis = rrRanges.map(range => ({
      label: range.label,
      total: range.trades.length,
      wins: range.trades.filter(x => x.win).length,
      losses: range.trades.length - range.trades.filter(x => x.win).length,
      winRate: range.trades.length ? ((range.trades.filter(x => x.win).length / range.trades.length) * 100).toFixed(1) : 0,
      avgProfit: range.trades.length ? (range.trades.reduce((a, x) => a + x.profit, 0) / range.trades.length).toFixed(2) : 0
    })).filter(r => r.total > 0);

    const breakevenTrades = trades.filter(t => Math.abs(t.profit) < 5);
    const breakevenRate = trades.length ? ((breakevenTrades.length / trades.length) * 100).toFixed(1) : 0;

    const totalCosts = trades.reduce((acc, t) => acc + (t.brokerage || 0) + (t.sttTaxes || 0), 0);
    let costImpactedTrades = 0;
    trades.forEach(t => {
      if (t.profit > 0 && (t.brokerage || 0) + (t.sttTaxes || 0) > t.profit) costImpactedTrades++;
    });
    const winningTrades = trades.filter(t => t.profit > 0).length;
    const avgRR = rrCount > 0 ? rrSum / rrCount : 0;
    const qualityScore = Math.min(100, Math.max(0, (winningTrades / Math.max(1, trades.length)) * 50 + (100 - parseFloat(breakevenRate)) * 0.3 + Math.min(20, avgRR * 5))).toFixed(0);

    res.json({
      rrAnalysis,
      breakevenTrades: breakevenTrades.length,
      breakevenRate,
      totalCommission: "0",
      totalSwap: "0",
      totalCosts: totalCosts.toFixed(2),
      costImpactedTrades,
      qualityScore,
      tradesWithRR: trades.filter(t => t.stopLoss && t.takeProfit && t.entryPrice).length
    });
  } catch (error) {
    throw new ApiError(500, error.message);
  }
});

exports.getDrawdownAnalysis = asyncHandler(async (req, res) => {
  try {
    const trades = await IndianTrade.find(userQuery(req)).lean().sort({ createdAt: 1 });

    if (trades.length === 0) {
      return res.json({
        currentDrawdown: 0,
        maxDrawdown: 0,
        maxDrawdownPercent: 0,
        recoveryFactor: 0,
        avgDrawdown: 0,
        drawdownDuration: 0,
        equityCurve: []
      });
    }

    let balance = 0;
    let peak = 0;
    let maxDrawdown = 0;
    let maxDrawdownPercent = 0;
    const equityCurve = [];

    trades.forEach(t => {
      balance += t.profit || 0;
      equityCurve.push({ date: t.createdAt, balance });
      if (balance > peak) peak = balance;
      const drawdown = peak - balance;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
        maxDrawdownPercent = peak > 0 ? (drawdown / peak) * 100 : 0;
      }
    });

    const totalProfit = trades.reduce((acc, t) => acc + (t.profit || 0), 0);
    const totalCosts = trades.reduce((acc, t) => acc + (t.brokerage || 0) + (t.sttTaxes || 0), 0);
    const netProfit = totalProfit - totalCosts;
    const currentDrawdown = peak - balance;
    const currentDrawdownPercent = peak > 0 ? (currentDrawdown / peak) * 100 : 0;
    const recoveryFactor = maxDrawdown > 0 ? netProfit / maxDrawdown : 0;

    res.json({
      currentDrawdown: currentDrawdown.toFixed(2),
      currentDrawdownPercent: currentDrawdownPercent.toFixed(1),
      maxDrawdown: maxDrawdown.toFixed(2),
      maxDrawdownPercent: maxDrawdownPercent.toFixed(1),
      recoveryFactor: recoveryFactor.toFixed(2),
      avgDrawdown: "0",
      drawdownDurationDays: 0,
      peakBalance: peak.toFixed(2),
      currentBalance: balance.toFixed(2),
      totalProfit: totalProfit.toFixed(2),
      equityCurve: equityCurve.slice(-30),
      drawdownPeriods: []
    });
  } catch (error) {
    throw new ApiError(500, error.message);
  }
});

exports.getAIInsights = asyncHandler(async (req, res) => {
  try {
    const trades = await IndianTrade.find(userQuery(req)).lean();

    if (trades.length < 5) {
      return res.json({
        insights: ["Not enough data for Indian Market AI analysis. Keep logging trades!"],
        recommendations: ["Log at least 10 trades for meaningful insights"],
        score: 0
      });
    }

    const winningTrades = trades.filter(t => t.profit > 0);
    const losingTrades = trades.filter(t => t.profit < 0);
    const winRate = (winningTrades.length / trades.length) * 100;
    const totalProfit = trades.reduce((acc, t) => acc + (t.profit || 0), 0);
    const avgWin = winningTrades.length ? winningTrades.reduce((acc, t) => acc + t.profit, 0) / winningTrades.length : 0;
    const avgLoss = losingTrades.length ? Math.abs(losingTrades.reduce((acc, t) => acc + t.profit, 0) / losingTrades.length) : 0;

    const insights = [];
    const recommendations = [];
    const currency = "â‚¹";

    if (winRate >= 60) insights.push(`Excellent win rate of ${winRate.toFixed(1)}% â€” Your strategy has a strong edge!`);
    else if (winRate >= 50) insights.push(`Good win rate of ${winRate.toFixed(1)}% â€” You're above breakeven`);
    else if (winRate < 40) insights.push(`Win rate of ${winRate.toFixed(1)}% is below optimal â€” Consider reviewing your entries`);

    if (avgWin > 0 && avgLoss > 0) {
      const rr = avgWin / avgLoss;
      if (rr >= 2) insights.push(`Great risk-reward ratio of 1:${rr.toFixed(1)} â€” You need fewer wins to be profitable`);
      else if (rr < 1) insights.push(`Risk-reward ratio of 1:${rr.toFixed(1)} is unfavorable â€” Aim for at least 1:1.5`);
    }

    if (totalProfit > 0) insights.push(`Total P&L: ${currency}${totalProfit.toFixed(2)} â€” Keep up the good work!`);
    else insights.push(`Currently in drawdown â€” Stay disciplined and follow your rules`);

    const bySession = {};
    trades.forEach(t => {
      const session = t.session || "Unspecified";
      if (!bySession[session]) bySession[session] = { profit: 0, wins: 0, total: 0 };
      bySession[session].total++;
      bySession[session].profit += t.profit || 0;
      if (t.profit > 0) bySession[session].wins++;
    });
    const sessionEntries = Object.entries(bySession).filter(([name, s]) => name !== "Unspecified" && s.total > 0);

    let bestSessionEntry = null;
    let bestSessionWinRateEntry = null;
    if (sessionEntries.length > 0) {
      bestSessionEntry = sessionEntries.reduce((a, b) => (a[1].profit > b[1].profit ? a : b));
      bestSessionWinRateEntry = sessionEntries.reduce((a, b) => ((a[1].wins / a[1].total) > (b[1].wins / b[1].total) ? a : b));
      if (bestSessionEntry[1].profit > 0) {
        insights.push(`Best trading session: ${bestSessionEntry[0]} (${currency}${bestSessionEntry[1].profit.toFixed(2)})`);
      }
      insights.push(`Highest win rate: ${bestSessionWinRateEntry[0]} (${((bestSessionWinRateEntry[1].wins / bestSessionWinRateEntry[1].total) * 100).toFixed(1)}%)`);
      if (bestSessionEntry[0] !== "London (08-16 UTC)" && bestSessionEntry[0] !== "Overlap (13-16 UTC)") {
        recommendations.push(`Consider trading during ${bestSessionEntry[0]} â€” your most profitable session`);
      }
    }

    const pairStats = {};
    trades.forEach(t => {
      if (!pairStats[t.pair]) pairStats[t.pair] = { wins: 0, total: 0, profit: 0 };
      pairStats[t.pair].total++;
      if (t.profit > 0) pairStats[t.pair].wins++;
      pairStats[t.pair].profit += t.profit || 0;
    });
    const pairs = Object.entries(pairStats)
      .map(([name, stats]) => ({
        name,
        winRate: ((stats.wins / stats.total) * 100).toFixed(1),
        profit: stats.profit.toFixed(2),
        count: stats.total
      }))
      .sort((a, b) => parseFloat(b.profit) - parseFloat(a.profit));

    if (pairs.length > 0 && parseFloat(pairs[0].profit) > 0) insights.push(`Best performing symbol: ${pairs[0].name} (${currency}${pairs[0].profit})`);
    if (pairs.length > 2) recommendations.push(`Focus on: ${pairs.slice(0, 2).map(p => p.name).join(", ")} â€” your top performers`);

    const dayStats = { Monday: 0, Tuesday: 0, Wednesday: 0, Thursday: 0, Friday: 0 };
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    trades.forEach(t => {
      const day = dayNames[new Date(t.createdAt).getDay()];
      if (dayStats[day] !== undefined) dayStats[day] += t.profit || 0;
    });
    const bestDay = Object.entries(dayStats).reduce((a, b) => (a[1] > b[1] ? a : b));
    if (bestDay[1] > 0) {
      insights.push(`Most profitable day: ${bestDay[0]} (${currency}${bestDay[1].toFixed(2)})`);
      recommendations.push(`Focus your trading on ${bestDay[0]} â€” your best performing day`);
    }
    const worstDay = Object.entries(dayStats).reduce((a, b) => (a[1] < b[1] ? a : b));
    if (worstDay[1] < -50) {
      recommendations.push(`Avoid or reduce size on ${worstDay[0]} â€” your least profitable day`);
    }

    const behaviorBuckets = { Plan: { count: 0, pnl: 0 }, Emotion: { count: 0, pnl: 0 }, Impulsive: { count: 0, pnl: 0 }, Other: { count: 0, pnl: 0 } };
    const mistakeTagStats = {};
    trades.forEach(t => {
      // Treat missing/empty entryBasis as "Plan" (model default) so legacy trades don't distort the metric
      const basis = t.entryBasis && t.entryBasis.trim() ? t.entryBasis : "Plan";
      const key = basis === "Plan" || basis === "Emotion" || basis === "Impulsive" ? basis : "Other";
      behaviorBuckets[key].count += 1;
      behaviorBuckets[key].pnl += t.profit || 0;

      // Mistake tag
      if (t.mistakeTag && t.mistakeTag.trim()) {
        const mk = t.mistakeTag.trim();
        if (!mistakeTagStats[mk]) mistakeTagStats[mk] = { count: 0, pnl: 0, lessons: [] };
        mistakeTagStats[mk].count++;
        mistakeTagStats[mk].pnl += t.profit || 0;
        if (t.lesson && t.lesson.trim() && mistakeTagStats[mk].lessons.length < 3) {
          mistakeTagStats[mk].lessons.push(t.lesson.trim());
        }
      }
    });
    const behaviorTotal = trades.length || 1;
    const behaviorRuleEmotion = {
      planPct: ((behaviorBuckets.Plan.count / behaviorTotal) * 100).toFixed(1),
      emotionPct: (((behaviorBuckets.Emotion.count + behaviorBuckets.Impulsive.count) / behaviorTotal) * 100).toFixed(1),
      planPnl: behaviorBuckets.Plan.pnl.toFixed(2),
      emotionPnl: (behaviorBuckets.Emotion.pnl + behaviorBuckets.Impulsive.pnl).toFixed(2)
    };

    const weeklyPlan = {};
    trades.forEach(t => {
      const d = new Date(t.createdAt);
      const year = d.getFullYear();
      const week = Math.ceil(((d - new Date(year, 0, 1)) / 86400000 + d.getDay() + 1) / 7);
      const key = `${year}-W${week}`;
      if (!weeklyPlan[key]) weeklyPlan[key] = { total: 0, plan: 0, pnl: 0 };
      weeklyPlan[key].total += 1;
      weeklyPlan[key].pnl += t.profit || 0;
      const eb = t.entryBasis && t.entryBasis.trim() ? t.entryBasis : "Plan";
      if (eb === "Plan") weeklyPlan[key].plan += 1;
    });
    const weeklyDisciplineTrend = Object.entries(weeklyPlan)
      .sort(([a], [b]) => (a > b ? 1 : -1))
      .slice(-12)
      .map(([week, v]) => ({
        week,
        planAdherencePct: v.total ? parseFloat(((v.plan / v.total) * 100).toFixed(1)) : 0,
        pnl: parseFloat(v.pnl.toFixed(2)),
        total: v.total,
      }));
    const planTimeline = weeklyDisciplineTrend.map(w => ({ week: w.week, planAdherencePct: String(w.planAdherencePct) }));

    const revengeTrades = [];
    for (let i = 1; i < trades.length; i++) {
      const prev = trades[i - 1];
      const curr = trades[i];
      const prevLoss = (prev.profit || 0) < 0;
      const prevRisk = prev.entryPrice && prev.stopLoss ? Math.abs(prev.entryPrice - prev.stopLoss) : 0;
      const currRisk = curr.entryPrice && curr.stopLoss ? Math.abs(curr.entryPrice - curr.stopLoss) : 0;
      const sameDay = new Date(prev.createdAt).toDateString() === new Date(curr.createdAt).toDateString();
      if (prevLoss && sameDay && prevRisk > 0 && currRisk > prevRisk * 1.5) {
        revengeTrades.push({ id: curr._id, pair: curr.pair, createdAt: curr.createdAt, prevProfit: prev.profit, currRisk, prevRisk });
      }
    }
    const revengeCostTotal = revengeTrades.reduce((acc, t) => acc + (t.prevProfit || 0), 0);

    const mistakeFeed = Object.entries(mistakeTagStats)
      .map(([tag, s]) => ({ tag, count: s.count, totalPnl: parseFloat(s.pnl.toFixed(2)), avgPnl: parseFloat((s.pnl / s.count).toFixed(2)), lessons: s.lessons }))
      .sort((a, b) => a.totalPnl - b.totalPnl)
      .slice(0, 5);

    const behaviorDiscipline = { ruleEmotion: behaviorRuleEmotion, planTimeline, revengeTradesCount: revengeTrades.length, revengeTrades: revengeTrades.slice(-10), revengeCostTotal: revengeCostTotal.toFixed(2) };

    const sessionEdge = sessionEntries.map(([name, s]) => ({
      session: name,
      winRate: (s.total ? (s.wins / s.total) * 100 : 0).toFixed(1),
      avgProfit: (s.total ? s.profit / s.total : 0).toFixed(2),
      totalProfit: (s.profit || 0).toFixed(2),
      trades: s.total,
      tag: s.profit > 0 ? "Green" : "Red"
    }));

    let avgAbsLoss = 0;
    if (losingTrades.length > 0) avgAbsLoss = Math.abs(losingTrades.reduce((acc, t) => acc + (t.profit || 0), 0) / losingTrades.length) || 0;
    const bigThreshold = avgAbsLoss > 0 ? avgAbsLoss * 1.5 : 0;
    const afterBigWin = [];
    const afterBigLoss = [];
    for (let i = 1; i < trades.length; i++) {
      const prev = trades[i - 1];
      const curr = trades[i];
      const prevPnl = prev.profit || 0;
      if (bigThreshold > 0) {
        if (prevPnl >= bigThreshold) afterBigWin.push(curr);
        else if (prevPnl <= -bigThreshold) afterBigLoss.push(curr);
      }
    }
    const calcBucketStats = bucket => {
      if (!bucket.length) return { trades: 0, winRate: "0.0", avgProfit: "0.00" };
      const winsLocal = bucket.filter(t => (t.profit || 0) > 0).length;
      const pnlLocal = bucket.reduce((acc, t) => acc + (t.profit || 0), 0);
      return { trades: bucket.length, winRate: ((winsLocal / bucket.length) * 100).toFixed(1), avgProfit: (pnlLocal / bucket.length).toFixed(2) };
    };
    let currentStreak = [];
    const tiltDays = [];
    const pushTiltStreakIfNeeded = () => {
      if (currentStreak.length >= 3) {
        const increasing = currentStreak.every((t, idx) => {
          if (idx === 0) return true;
          const prev = currentStreak[idx - 1];
          const sizePrev = prev.quantity || 0;
          const sizeCurr = t.quantity || 0;
          return sizeCurr >= sizePrev;
        });
        if (increasing) {
          tiltDays.push({
            day: new Date(currentStreak[0].createdAt).toDateString(),
            streakLength: currentStreak.length,
            totalLoss: currentStreak.reduce((acc, t) => acc + (t.profit || 0), 0).toFixed(2)
          });
        }
      }
      currentStreak = [];
    };
    trades.forEach(t => {
      if ((t.profit || 0) < 0) currentStreak.push(t);
      else pushTiltStreakIfNeeded();
    });
    pushTiltStreakIfNeeded();
    const psychologicalPatterns = { afterBigWin: calcBucketStats(afterBigWin), afterBigLoss: calcBucketStats(afterBigLoss), tiltDays };

    const strategyStats = {};
    trades.forEach(t => {
      const key = t.strategy || "Unspecified";
      if (!strategyStats[key]) strategyStats[key] = { trades: 0, wins: 0, pnl: 0 };
      strategyStats[key].trades += 1;
      strategyStats[key].pnl += t.profit || 0;
      if ((t.profit || 0) > 0) strategyStats[key].wins += 1;
    });
    const strategyLeague = Object.entries(strategyStats)
      .map(([name, s]) => ({
        strategy: name,
        trades: s.trades,
        winRate: s.trades ? ((s.wins / s.trades) * 100).toFixed(1) : "0.0",
        totalProfit: s.pnl.toFixed(2),
        avgProfit: (s.trades ? s.pnl / s.trades : 0).toFixed(2)
      }))
      .sort((a, b) => parseFloat(b.totalProfit) - parseFloat(a.totalProfit));

    const recentWeeks = planTimeline.slice(-4);
    const latestWeek = recentWeeks[recentWeeks.length - 1];
    const bestSessionStructured = bestSessionEntry && bestSessionEntry[1].profit > 0 ? bestSessionEntry[0] : null;
    const worstHourEntry = Object.entries(dayStats).reduce((a, b) => (a[1] < b[1] ? a : b));
    const weeklyNarrativeParts = [];
    if (latestWeek) weeklyNarrativeParts.push(`This week you followed your plan on ${latestWeek.planAdherencePct}% of trades.`);
    if (bestSessionStructured) weeklyNarrativeParts.push(`Most of your profit came from the ${bestSessionStructured} session.`);
    if (worstDay[1] < 0) weeklyNarrativeParts.push(`You lost the most on ${worstDay[0]}, especially when trading outside your best conditions.`);
    const weeklyNarrative = weeklyNarrativeParts.join(" ");
    const nextWeekChecklist = [];
    if (parseFloat(behaviorRuleEmotion.planPct) < 70) nextWeekChecklist.push("Increase the share of 'Plan' trades above 70% by using your checklist.");
    if (tiltDays.length > 0) nextWeekChecklist.push("Avoid new trades after 3 consecutive losses or reduce size significantly.");
    if (bestSessionStructured) nextWeekChecklist.push(`Prioritize setups during the ${bestSessionStructured} session.`);
    if (nextWeekChecklist.length === 0) nextWeekChecklist.push("Keep following your current process; maintain discipline and journaling.");

    const tradesWithSL = trades.filter(t => t.stopLoss).length;
    if (tradesWithSL / trades.length < 0.5) recommendations.push(`Use stop losses on more trades â€” only ${((tradesWithSL / trades.length) * 100).toFixed(0)}% have SL set`);

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
      topStrategies: [],
      topPairs: pairs.slice(0, 5),
      bestDay: bestDay[0],
      worstDay: worstDay[0],
      bestSession: bestSessionStructured,
      stats: {
        totalTrades: trades.length,
        winRate: winRate.toFixed(1),
        avgWin: avgWin.toFixed(2),
        avgLoss: avgLoss.toFixed(2),
        profitFactor: avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) : avgWin > 0 ? "âˆž" : "0.00"
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

exports.getAdvancedAnalytics = asyncHandler(async (req, res) => {
  try {
    const trades = await IndianTrade.find(userQuery(req)).lean().sort({ createdAt: 1 });

    const totalTrades = trades.length;
    const totalProfit = trades.reduce((acc, t) => acc + (t.profit || 0), 0);
    const wins = trades.filter(t => t.profit > 0).length;
    const winRate = totalTrades ? (wins / totalTrades) * 100 : 0;

    const winningTrades = trades.filter(t => t.profit > 0);
    const losingTrades = trades.filter(t => t.profit < 0);
    const avgWin = winningTrades.length ? winningTrades.reduce((acc, t) => acc + t.profit, 0) / winningTrades.length : 0;
    const avgLoss = losingTrades.length ? Math.abs(losingTrades.reduce((acc, t) => acc + t.profit, 0) / losingTrades.length) : 0;

    const totalCosts = trades.reduce((acc, t) => acc + (t.brokerage || 0) + (t.sttTaxes || 0), 0);
    const netProfit = totalProfit - totalCosts;

    let maxWinStreak = 0, maxLossStreak = 0, tempWinStreak = 0, tempLossStreak = 0;
    trades.forEach(t => {
      if (t.profit > 0) { tempWinStreak++; tempLossStreak = 0; maxWinStreak = Math.max(maxWinStreak, tempWinStreak); }
      else if (t.profit < 0) { tempLossStreak++; tempWinStreak = 0; maxLossStreak = Math.max(maxLossStreak, tempLossStreak); }
    });

    let balance = 0;
    let peak = 0;
    let maxDrawdown = 0;
    trades.forEach(t => {
      balance += t.profit || 0;
      if (balance > peak) peak = balance;
      maxDrawdown = Math.max(maxDrawdown, peak - balance);
    });

    const totalWins = winningTrades.reduce((acc, t) => acc + t.profit, 0);
    const totalLosses = Math.abs(losingTrades.reduce((acc, t) => acc + t.profit, 0));
    const profitFactor = totalLosses > 0 ? (totalWins / totalLosses).toFixed(2) : totalWins > 0 ? "âˆž" : "0.00";

    let totalRR = 0, rrCount = 0;
    trades.forEach(t => {
      let trr = (t.entryPrice && t.stopLoss && t.takeProfit && Math.abs(t.entryPrice - t.stopLoss) > 0)
        ? Math.abs(t.takeProfit - t.entryPrice) / Math.abs(t.entryPrice - t.stopLoss)
        : 0;
      if (trr <= 0 && t.riskRewardRatio && t.riskRewardRatio.includes(":")) {
        const val = parseFloat(t.riskRewardRatio.split(":")[1]);
        if (!isNaN(val)) trr = val;
      }
      if (trr > 0) { totalRR += trr; rrCount++; }
    });
    const avgRR = rrCount > 0 ? totalRR / rrCount : (avgLoss > 0 ? avgWin / avgLoss : 0);

    let score = 50;
    score += Math.min(20, winRate - 40);
    if (avgRR >= 2) score += 15;
    if (totalProfit > 0) score += 15;
    const tradesWithSL = trades.filter(t => t.stopLoss).length;
    if (tradesWithSL / Math.max(1, trades.length) >= 0.8) score += 10;
    score = Math.min(100, Math.max(0, score));

    res.json({
      totalTrades,
      totalProfit: totalProfit.toFixed(2),
      netProfit: netProfit.toFixed(2),
      winRate: winRate.toFixed(1),
      avgWin: avgWin.toFixed(2),
      avgLoss: avgLoss.toFixed(2),
      avgRR: avgRR.toFixed(2),
      actualRR: avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) : "0.00",
      profitFactor,
      maxWinStreak,
      maxLossStreak,
      maxDrawdown: maxDrawdown.toFixed(2),
      totalCosts: totalCosts.toFixed(2),
      aiScore: score.toFixed(0),
      recentTrades: trades.slice(-10).reverse().map(t => ({ pair: t.pair, type: t.type, profit: t.profit, createdAt: t.createdAt }))
    });
  } catch (error) {
    throw new ApiError(500, error.message);
  }
});

// ============================================
// PSYCHOLOGY ANALYTICS
// ============================================

exports.getPsychologyAnalytics = asyncHandler(async (req, res) => {
  try {
    const trades = await IndianTrade.find(userQuery(req)).lean().sort({ createdAt: 1 });

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

    const moodLabels = { 1: "ðŸ˜° Stressed", 2: "ðŸ˜Ÿ Anxious", 3: "ðŸ˜ Neutral", 4: "ðŸ˜Š Good", 5: "ðŸ”¥ Peak" };
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

    const tagEmojis = { FOMO: "ðŸ˜¨", Revenge: "ðŸ˜¡", Fear: "ðŸ˜°", Greed: "ðŸ¤‘", Calm: "ðŸ§˜", Bored: "ðŸ˜´", Focused: "ðŸŽ¯", Frustrated: "ðŸ˜¤" };
    const emotionalTagImpact = Object.entries(tagBuckets)
      .map(([tag, s]) => ({
        tag, emoji: tagEmojis[tag] || "", trades: s.trades, wins: s.wins, losses: s.losses,
        winRate: s.trades ? ((s.wins / s.trades) * 100).toFixed(1) : "0.0",
        avgProfit: s.trades ? (s.pnl / s.trades).toFixed(2) : "0.00",
        totalProfit: s.pnl.toFixed(2)
      }))
      .sort((a, b) => b.trades - a.trades);

    // 4) Psychology Score (0â€“100)
    const totalTrades = trades.length;
    const planTrades = trades.filter(t => !t.entryBasis || !t.entryBasis.trim() || t.entryBasis === "Plan").length;
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
    res.status(500).json({ message: error.message });
  }
});
