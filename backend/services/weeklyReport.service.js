const ApiError = require("../utils/ApiError");
const { appConfig } = require("../config");
const { generateWeeklyFeedback } = require("./geminiService");
const tradeRepository = require("../repositories/trade.repository");
const indianTradeRepository = require("../repositories/indianTrade.repository");
const weeklyReportRepository = require("../repositories/weeklyReport.repository");

function getLocalShiftMs() {
  const offsetHours = appConfig.timezoneOffsetHours;
  if (!offsetHours || Number.isNaN(offsetHours)) return 0;
  return offsetHours * 60 * 60 * 1000;
}

function getRolling7dUtcRange() {
  const shiftMs = getLocalShiftMs();
  const nowUtc = new Date();
  const weekEndUtc = nowUtc;
  const weekStartUtc = new Date(nowUtc.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekStartLocal = new Date(weekStartUtc.getTime() + shiftMs);
  const weekEndLocal = new Date(weekEndUtc.getTime() + shiftMs);
  return { weekStartUtc, weekEndUtc, weekStartLocal, weekEndLocal };
}

function computeSnapshot(trades, marketType) {
  const totalTrades = trades.length;
  const wins = trades.filter((trade) => (trade.profit || 0) > 0).length;
  const losses = trades.filter((trade) => (trade.profit || 0) < 0).length;
  const grossProfit = trades.reduce((sum, trade) => sum + (trade.profit || 0), 0);
  const isIndian = marketType === "Indian_Market";
  const commission = isIndian ? 0 : trades.reduce((sum, trade) => sum + (trade.commission || 0), 0);
  const swap = isIndian ? 0 : trades.reduce((sum, trade) => sum + (trade.swap || 0), 0);
  const brokerage = isIndian ? trades.reduce((sum, trade) => sum + (trade.brokerage || 0), 0) : 0;
  const sttTaxes = isIndian ? trades.reduce((sum, trade) => sum + (trade.sttTaxes || 0), 0) : 0;
  const netProfit = grossProfit - commission - swap - brokerage - sttTaxes;
  const winRatePct = totalTrades ? (wins / totalTrades) * 100 : 0;

  const winningTrades = trades.filter((trade) => (trade.profit || 0) > 0);
  const losingTrades = trades.filter((trade) => (trade.profit || 0) < 0);
  const avgWin = winningTrades.length
    ? winningTrades.reduce((sum, trade) => sum + (trade.profit || 0), 0) / winningTrades.length
    : 0;
  const avgLossAbs = losingTrades.length
    ? Math.abs(losingTrades.reduce((sum, trade) => sum + (trade.profit || 0), 0) / losingTrades.length)
    : 0;
  const totalWinsPnl = winningTrades.reduce((sum, trade) => sum + (trade.profit || 0), 0);
  const totalLossesAbs = Math.abs(losingTrades.reduce((sum, trade) => sum + (trade.profit || 0), 0));
  const profitFactor = totalLossesAbs > 0 ? totalWinsPnl / totalLossesAbs : totalWinsPnl > 0 ? Infinity : 0;

  let discipline = {};
  if (!isIndian) {
    const scored = trades.filter((trade) => typeof trade.setupScore === "number");
    const avgSetupScore = scored.length
      ? scored.reduce((sum, trade) => sum + trade.setupScore, 0) / scored.length
      : null;

    const ruleBreakCounts = {};
    trades.forEach((trade) => {
      if (!Array.isArray(trade.setupRules)) return;
      trade.setupRules.forEach((rule) => {
        if (!rule || !rule.label || rule.followed !== false) return;
        const label = String(rule.label).trim();
        if (label) ruleBreakCounts[label] = (ruleBreakCounts[label] || 0) + 1;
      });
    });

    discipline = {
      avgSetupScore: avgSetupScore === null ? null : Number(avgSetupScore.toFixed(1)),
      topRuleBreaks: Object.entries(ruleBreakCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([label, count]) => ({ label, count })),
    };
  } else {
    const entryBasisCounts = { Plan: 0, Emotion: 0, Impulsive: 0, Other: 0 };
    const mistakeTagCounts = {};
    trades.forEach((trade) => {
      const basis =
        trade.entryBasis === "Plan" || trade.entryBasis === "Emotion" || trade.entryBasis === "Impulsive"
          ? trade.entryBasis
          : "Other";
      entryBasisCounts[basis] += 1;
      const tag = (trade.mistakeTag || "").trim() || "None";
      mistakeTagCounts[tag] = (mistakeTagCounts[tag] || 0) + 1;
    });

    discipline = {
      entryBasis: {
        planPct: Number((totalTrades ? (entryBasisCounts.Plan / totalTrades) * 100 : 0).toFixed(1)),
        emotionPct: Number(
          (
            totalTrades
              ? ((entryBasisCounts.Emotion + entryBasisCounts.Impulsive) / totalTrades) * 100
              : 0
          ).toFixed(1)
        ),
        counts: entryBasisCounts,
      },
      topMistakeTags: Object.entries(mistakeTagCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([label, count]) => ({ label, count })),
    };
  }

  const byStrategy = {};
  const bySession = {};
  trades.forEach((trade) => {
    const strategy = trade.strategy || "Unspecified";
    const session = trade.session || "Unspecified";
    if (!byStrategy[strategy]) byStrategy[strategy] = { trades: 0, wins: 0, net: 0 };
    if (!bySession[session]) bySession[session] = { trades: 0, wins: 0, net: 0 };

    byStrategy[strategy].trades += 1;
    bySession[session].trades += 1;

    const pnl = marketType === "Indian_Market"
      ? (trade.profit || 0) - (trade.brokerage || 0) - (trade.sttTaxes || 0)
      : (trade.profit || 0) - (trade.commission || 0) - (trade.swap || 0);

    byStrategy[strategy].net += pnl;
    bySession[session].net += pnl;

    if ((trade.profit || 0) > 0) {
      byStrategy[strategy].wins += 1;
      bySession[session].wins += 1;
    }
  });

  const topStrategies = Object.entries(byStrategy)
    .map(([name, stats]) => ({
      name,
      trades: stats.trades,
      winRatePct: stats.trades ? (stats.wins / stats.trades) * 100 : 0,
      net: stats.net,
    }))
    .sort((a, b) => b.net - a.net)
    .slice(0, 5);

  const topSessions = Object.entries(bySession)
    .map(([name, stats]) => ({
      name,
      trades: stats.trades,
      winRatePct: stats.trades ? (stats.wins / stats.trades) * 100 : 0,
      net: stats.net,
    }))
    .sort((a, b) => b.net - a.net)
    .slice(0, 5);

  const bestTrades = [...trades]
    .sort((a, b) => (b.profit || 0) - (a.profit || 0))
    .slice(0, 3)
    .map((trade) => ({
      id: trade._id,
      pair: trade.pair,
      profit: trade.profit || 0,
      session: trade.session || "",
      strategy: trade.strategy || "",
      setupScore: typeof trade.setupScore === "number" ? trade.setupScore : null,
    }));

  const worstTrades = [...trades]
    .sort((a, b) => (a.profit || 0) - (b.profit || 0))
    .slice(0, 3)
    .map((trade) => ({
      id: trade._id,
      pair: trade.pair,
      profit: trade.profit || 0,
      session: trade.session || "",
      strategy: trade.strategy || "",
      setupScore: typeof trade.setupScore === "number" ? trade.setupScore : null,
    }));

  return {
    counts: { totalTrades, wins, losses },
    pnl: {
      gross: Number(grossProfit.toFixed(2)),
      costs: {
        commission: Number(commission.toFixed(2)),
        swap: Number(swap.toFixed(2)),
        brokerage: Number(brokerage.toFixed(2)),
        sttTaxes: Number(sttTaxes.toFixed(2)),
      },
      net: Number(netProfit.toFixed(2)),
    },
    rates: {
      winRatePct: Number(winRatePct.toFixed(1)),
      profitFactor: profitFactor === Infinity ? "∞" : Number(profitFactor.toFixed(2)),
      avgWin: Number(avgWin.toFixed(2)),
      avgLoss: Number(avgLossAbs.toFixed(2)),
    },
    discipline,
    breakdowns: { topStrategies, topSessions },
    tradeSamples: { bestTrades, worstTrades },
  };
}

function computePsychologySnapshot(trades) {
  if (!Array.isArray(trades) || trades.length === 0) return null;

  const withMood = trades.filter((t) => typeof t.mood === "number");
  const withConfidence = trades.filter((t) => t.confidence && String(t.confidence).trim());
  const withTags = trades.filter((t) => Array.isArray(t.emotionalTags) && t.emotionalTags.length > 0);
  const trackedTrades = trades.filter((t) =>
    typeof t.mood === "number" ||
    (t.confidence && String(t.confidence).trim()) ||
    (Array.isArray(t.emotionalTags) && t.emotionalTags.length > 0) ||
    (t.wouldRetake && String(t.wouldRetake).trim())
  );

  if (trackedTrades.length === 0) return null;

  const planTrades = trades.filter((t) => t.entryBasis === "Plan").length;
  const planAdherencePct = trades.length ? (planTrades / trades.length) * 100 : 0;

  const calmFocusedTrades = trades.filter(
    (t) =>
      Array.isArray(t.emotionalTags) &&
      (t.emotionalTags.includes("Calm") || t.emotionalTags.includes("Focused"))
  ).length;
  const calmTradingPct = trades.length ? (calmFocusedTrades / trades.length) * 100 : 0;

  let revengeTradesCount = 0;
  for (let i = 1; i < trades.length; i += 1) {
    const prev = trades[i - 1];
    const curr = trades[i];
    const prevLoss = (prev.profit || 0) < 0;
    const prevRisk = prev.entryPrice && prev.stopLoss ? Math.abs(prev.entryPrice - prev.stopLoss) : 0;
    const currRisk = curr.entryPrice && curr.stopLoss ? Math.abs(curr.entryPrice - curr.stopLoss) : 0;
    const sameDay = new Date(prev.createdAt).toDateString() === new Date(curr.createdAt).toDateString();
    if (prevLoss && sameDay && prevRisk > 0 && currRisk > prevRisk * 1.5) revengeTradesCount += 1;
  }
  const noRevengePct = trades.length ? ((trades.length - revengeTradesCount) / trades.length) * 100 : 100;

  const moodAvg = withMood.length
    ? withMood.reduce((sum, t) => sum + Number(t.mood || 0), 0) / withMood.length
    : null;

  const confidenceCounts = {};
  withConfidence.forEach((t) => {
    const c = String(t.confidence).trim();
    confidenceCounts[c] = (confidenceCounts[c] || 0) + 1;
  });
  const topConfidence = Object.entries(confidenceCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([label, count]) => ({ label, count }));

  const tagCounts = {};
  withTags.forEach((t) => {
    t.emotionalTags.forEach((tag) => {
      const key = String(tag || "").trim();
      if (!key) return;
      tagCounts[key] = (tagCounts[key] || 0) + 1;
    });
  });
  const topEmotionalTags = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag, count]) => ({ tag, count }));

  const retakeYes = trades.filter((t) => t.wouldRetake === "Yes").length;
  const retakeTracked = trades.filter((t) => t.wouldRetake === "Yes" || t.wouldRetake === "No").length;
  const wouldRetakePct = retakeTracked ? (retakeYes / retakeTracked) * 100 : 50;

  const psychologyScore = Math.min(
    100,
    Math.max(
      0,
      Math.round(
        planAdherencePct * 0.35 +
          calmTradingPct * 0.25 +
          noRevengePct * 0.25 +
          wouldRetakePct * 0.15
      )
    )
  );

  return {
    totalTrackedTrades: trackedTrades.length,
    psychologyScore,
    scoreBreakdown: {
      planAdherencePct: Number(planAdherencePct.toFixed(1)),
      calmTradingPct: Number(calmTradingPct.toFixed(1)),
      noRevengePct: Number(noRevengePct.toFixed(1)),
      wouldRetakePct: Number(wouldRetakePct.toFixed(1)),
    },
    mood: {
      tracked: withMood.length,
      average: moodAvg === null ? null : Number(moodAvg.toFixed(2)),
    },
    topConfidence,
    topEmotionalTags,
  };
}

async function listWeeklyReports(userId, marketType = "Forex", rawLimit = "12") {
  const limit = Math.min(50, Math.max(1, parseInt(rawLimit, 10)));
  return weeklyReportRepository.findWeeklyReportsByUser(userId, marketType, limit);
}

async function getWeeklyReport(userId, reportId) {
  const report = await weeklyReportRepository.findWeeklyReportByIdAndUser(reportId, userId);
  if (!report) {
    throw new ApiError(404, "Report not found", "NOT_FOUND");
  }
  return report;
}

async function generateRolling7dReportForUser({ userId, marketType }) {
  const isIndian = marketType === "Indian_Market";
  const { weekStartUtc, weekEndUtc, weekStartLocal, weekEndLocal } = getRolling7dUtcRange();

  const weekStartDay = new Date(weekStartUtc);
  weekStartDay.setUTCHours(0, 0, 0, 0);
  const weekEndDay = new Date(weekEndUtc);
  weekEndDay.setUTCHours(0, 0, 0, 0);

  const trades = isIndian
    ? await indianTradeRepository.findIndianTradesForWeeklyWindow(userId, weekStartUtc, weekEndUtc)
    : await tradeRepository.findTradesForWeeklyWindow(userId, weekStartUtc, weekEndUtc);

  const weekLabel = `${weekStartLocal.toDateString()} -> ${weekEndLocal.toDateString()} (Last 7 days)`;
  const snapshotBase = {
    week: {
      startUtc: weekStartUtc.toISOString(),
      endUtc: weekEndUtc.toISOString(),
      label: weekLabel,
      timezoneOffsetHours: appConfig.timezoneOffsetHours || 0,
    },
    marketType,
    periodType: "rolling7d",
    ...computeSnapshot(trades, marketType),
  };

  // Attach a compact psychology snapshot from THIS week trades.
  const psychology = computePsychologySnapshot(trades);

  const snapshot = psychology ? { ...snapshotBase, psychology } : snapshotBase;

  let report = await weeklyReportRepository.upsertRollingWeeklyReport(
    userId,
    marketType,
    weekStartDay,  // day-level key → same record on repeated same-day calls
    weekEndDay,
    snapshot
  );

  if (trades.length === 0) {
    if (!report.aiFeedback) {
      report = await weeklyReportRepository.updateWeeklyReportById(report._id, {
        aiFeedback: {
          week: weekLabel,
          summary: "No trades logged in the last 7 days, so there is nothing to analyse yet.",
          mistakes: [],
          improvements: [
            {
              title: "Start logging trades",
              why: "AI can only give feedback based on your real trades.",
              how: "Log every trade you take over the next few days.",
            },
          ],
          nextWeekChecklist: ["Log every trade", "Use your checklist before saving"],
        },
        aiModel: "",
      });
    }

    return report;
  }

  if (report.aiFeedback && report.aiFeedback.psychologyFeedback) {
    return report;
  }

  const { model, feedback } = await generateWeeklyFeedback({ snapshot, weekLabel });
  return weeklyReportRepository.updateWeeklyReportById(report._id, {
    aiFeedback: feedback,
    aiModel: model,
  });
}

async function generateNowOnce(userId, marketType = "Forex") {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const lastGenerated = await weeklyReportRepository.findRecentlyGeneratedWeeklyReport(userId, marketType, since);

  // Backward compatibility: allow one regeneration if old AI feedback exists
  // but psychologyFeedback was never stored.
  const hasPsychFeedback = Boolean(lastGenerated?.aiFeedback?.psychologyFeedback);
  if (lastGenerated && hasPsychFeedback) {
    throw new ApiError(
      409,
      "AI feedback already generated in the last 7 days. Please wait before generating again.",
      "CONFLICT",
      { reportId: lastGenerated._id }
    );
  }

  return generateRolling7dReportForUser({ userId, marketType });
}

module.exports = {
  generateNowOnce,
  generateRolling7dReportForUser,
  getWeeklyReport,
  listWeeklyReports,
};
