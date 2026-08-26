const ApiError = require("../utils/ApiError");
const { appConfig } = require("../config");
const { logger } = require("../utils/logger");
const { generateWeeklyFeedback } = require("./geminiService");
const { onWeeklyReportSaved } = require("./missionProgressService");
const weeklyReportRepository = require("../repositories/weeklyReport.repository");
const analyticsSnapshotService = require("./analyticsSnapshotService");
const { notifyWeeklyInsight } = require("./smartNotificationEvaluator");
const { getTradeCacheVersion } = require("../utils/cacheUtils");
const { calculateCostBreakdown, calculatePsychologyScore } = require("../utils/metricEngine");

function getLocalShiftMs() {
  const offsetHours = appConfig.timezoneOffsetHours;
  if (!offsetHours || Number.isNaN(offsetHours)) return 0;
  return offsetHours * 60 * 60 * 1000;
}

function getRolling7dUtcRange() {
  const shiftMs = getLocalShiftMs();
  const nowUtc = new Date();
  const nowLocal = new Date(nowUtc.getTime() + shiftMs);

  // "End of today" must be end-of-day in the configured local timezone, not
  // UTC -- otherwise the query window and the human-readable week label (built
  // from the same shift) disagree by shiftMs near day boundaries. Shift to
  // local, truncate to end-of-day using the shifted instant's UTC-rendered
  // fields as local wall-clock fields, then shift back to a real UTC instant.
  const weekEndLocalWall = new Date(nowLocal);
  weekEndLocalWall.setUTCHours(23, 59, 59, 999);
  const weekEndUtc = new Date(weekEndLocalWall.getTime() - shiftMs);
  const weekStartUtc = new Date(weekEndUtc.getTime() - 7 * 24 * 60 * 60 * 1000);

  const weekStartLocal = new Date(weekStartUtc.getTime() + shiftMs);
  const weekEndLocal = new Date(weekEndUtc.getTime() + shiftMs);
  return { weekStartUtc, weekEndUtc, weekStartLocal, weekEndLocal };
}

function computeSnapshot(trades, marketType, analytics = {}) {
  const sourceSnapshot = analytics?.performance || analytics?.basicStats
    ? analytics
    : analyticsSnapshotService.generateSnapshotFromTrades({
        trades,
        marketLabel: marketType,
        period: "weekly",
      });
  const performance = sourceSnapshot.performance || sourceSnapshot.basicStats || {};
  const costs = calculateCostBreakdown(trades, marketType);
  const psychologyCostSnapshot = sourceSnapshot.psychologyCost?.trackedTrades >= 2
    ? sourceSnapshot.psychologyCost
    : null;
  const selfAwarenessSnapshot = sourceSnapshot.selfAwareness?.trackedCount >= 3
    ? sourceSnapshot.selfAwareness
    : null;
  const patternsSnapshot = sourceSnapshot.patterns?.insufficient
    ? null
    : sourceSnapshot.patterns;
  const dnaSnapshot = sourceSnapshot.tradingDNA?.insufficient
    ? null
    : sourceSnapshot.tradingDNA;

  const bestTrades = [...(trades || [])]
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

  const worstTrades = [...(trades || [])]
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
    counts: {
      totalTrades: performance.totalTrades || 0,
      wins: performance.wins || 0,
      losses: performance.losses || 0,
      breakEven: performance.breakEven || 0,
    },
    pnl: {
      gross: Number((performance.grossPnL || 0).toFixed(2)),
      costs,
      net: Number((performance.netPnL || 0).toFixed(2)),
    },
    rates: {
      winRatePct: Number((performance.winRate || 0).toFixed(1)),
      profitFactor: performance.profitFactor === Infinity ? "∞" : Number((performance.profitFactor || 0).toFixed(2)),
      avgWin: Number((performance.avgWin || 0).toFixed(2)),
      avgLoss: Number((performance.avgLoss || 0).toFixed(2)),
    },
    discipline: sourceSnapshot.disciplineSummary || {},
    breakdowns: {
      topStrategies: sourceSnapshot.tradingDNA?.strategyDNA?.all?.slice(0, 5) || [],
      topSessions: sourceSnapshot.tradingDNA?.sessionDNA?.all?.slice(0, 5) || [],
    },
    tradeSamples: { bestTrades, worstTrades },
    ...(sourceSnapshot.tradeQualityAnalysis ? { tradeQualityAnalysis: sourceSnapshot.tradeQualityAnalysis } : {}),
    ...(selfAwarenessSnapshot ? { selfAwareness: selfAwarenessSnapshot } : {}),
    ...(psychologyCostSnapshot ? { psychologyCost: psychologyCostSnapshot } : {}),
    ...(dnaSnapshot ? { dna: dnaSnapshot } : {}),
    ...(patternsSnapshot ? { patterns: patternsSnapshot } : {}),
    ...(sourceSnapshot.timeline ? { timeline: sourceSnapshot.timeline } : {}),
    source: {
      metricSource: "analytics_snapshot",
      analyticsSnapshotCache: sourceSnapshot.cache || null,
      analyticsPeriod: sourceSnapshot.period || "weekly",
    },
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

  const psychologyScore = calculatePsychologyScore(trades);

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

/**
 * Validates that the snapshot is internally consistent before we hand it to AI.
 * Returns null on success, or an object describing the first mismatch found.
 */
function validateSnapshot(snapshot, trades) {
  const { totalTrades, wins, losses, breakEven } = snapshot.counts || {};

  // 1. Trade count must match the raw array length
  if (totalTrades !== trades.length) {
    return {
      field: "counts.totalTrades",
      expected: trades.length,
      actual: totalTrades,
      source: "computeSnapshot vs raw trades array",
    };
  }

  // 2. wins + losses + breakEven must equal totalTrades
  const sumCheck = (wins || 0) + (losses || 0) + (breakEven || 0);
  if (sumCheck !== totalTrades) {
    return {
      field: "counts.wins+losses+breakEven",
      expected: totalTrades,
      actual: sumCheck,
      source: "wins + losses + breakEven does not equal totalTrades",
    };
  }

  // 3. Net P&L must equal gross minus costs (within floating-point tolerance)
  const { gross, costs, net } = snapshot.pnl || {};
  if (gross !== undefined && net !== undefined && costs) {
    const totalCosts = (costs.commission || 0) + (costs.swap || 0) + (costs.brokerage || 0) + (costs.sttTaxes || 0);
    const expectedNet = Number((gross - totalCosts).toFixed(2));
    if (Math.abs(expectedNet - net) > 0.01) {
      return {
        field: "pnl.net",
        expected: expectedNet,
        actual: net,
        source: "gross - costs does not equal net",
      };
    }
  }

  return null;
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

  const analyticsSnapshot = await analyticsSnapshotService.getSnapshot({
    userId,
    market: isIndian ? "Indian_Market" : "Forex",
    dateRange: { from: weekStartUtc, to: weekEndUtc },
    period: "weekly",
    includeTrades: true,
  });
  const trades = analyticsSnapshot.trades;

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
    ...computeSnapshot(trades, marketType, analyticsSnapshot),
  };

  // Attach a compact psychology snapshot from THIS week trades.
  const psychology = computePsychologySnapshot(trades);

  const snapshot = psychology ? { ...snapshotBase, psychology } : snapshotBase;

  // Read the prior state before the upsert below overwrites `snapshot`, so we
  // can tell whether trades changed since any AI feedback already on record
  // was generated. Without this, upsert always overwrites snapshot in place,
  // making that comparison impossible after the fact -- which previously let
  // a same-day regenerate refresh the numeric snapshot while silently leaving
  // stale AI narrative text describing the old trade set.
  const previousReport = await weeklyReportRepository.findExistingRollingReport(
    userId,
    marketType,
    weekStartDay,
    weekEndDay
  );
  const previousVersion = previousReport?.snapshot?.source?.analyticsSnapshotCache?.version;
  const newVersion = snapshot?.source?.analyticsSnapshotCache?.version;
  const tradesChangedSincePriorFeedback = previousReport
    ? String(previousVersion) !== String(newVersion)
    : false;

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

  if (report.aiFeedback && report.aiFeedback.psychologyFeedback && !tradesChangedSincePriorFeedback) {
    return report;
  }

  // Validate snapshot consistency before sending to AI.
  // If data is internally inconsistent, surface an error rather than produce
  // AI feedback that contradicts what the user sees on the dashboard.
  const inconsistency = validateSnapshot(snapshot, trades);
  if (inconsistency) {
    logger.error("[WeeklyReport] Snapshot inconsistency detected — aborting AI generation", { inconsistency, userId, marketType });
    return weeklyReportRepository.updateWeeklyReportById(report._id, {
      aiFeedback: {
        week: weekLabel,
        summary: `Data inconsistency detected. Expected ${inconsistency.field} = ${inconsistency.expected}, but got ${inconsistency.actual}. Source: ${inconsistency.source}. Please refresh your trade journal and try regenerating.`,
        mistakes: [],
        improvements: [],
        nextWeekChecklist: [],
        psychologyFeedback: "",
        _dataInconsistency: inconsistency,
      },
      aiModel: "validation-error",
    });
  }

  try {
    const { model, feedback } = await generateWeeklyFeedback({ snapshot, weekLabel });
    const updatedReport = await weeklyReportRepository.updateWeeklyReportById(report._id, {
      aiFeedback: feedback,
      aiModel: model,
    });
    try {
      const notification = await notifyWeeklyInsight({ userId, report: updatedReport, marketType });
      logger.info("[WeeklyInsight]", {
        userId: userId?.toString?.(),
        reportId: updatedReport?._id?.toString?.(),
        notificationSent: Boolean(notification),
      });
    } catch (notificationError) {
      logger.error("[WeeklyInsight] notification failed", {
        userId: userId?.toString?.(),
        reportId: updatedReport?._id?.toString?.(),
        error: notificationError.message,
      });
    }
    const weekKey = `${updatedReport.weekStart?.toISOString?.()?.slice?.(0, 10) || "unknown"}`;
    onWeeklyReportSaved(userId, weekKey).catch(() => {});
    return updatedReport;
  } catch (aiError) {
    logger.warn("[WeeklyReport] AI generation failed, saving report without AI feedback", { error: aiError.message });
    return weeklyReportRepository.updateWeeklyReportById(report._id, {
      aiFeedback: {
        summary: "AI coaching is temporarily unavailable. Your trade data has been saved — please try regenerating in a few minutes.",
        focusAreas: [],
        nextWeekChecklist: ["Log every trade", "Use your checklist before saving"],
        psychologyFeedback: null,
      },
      aiModel: "unavailable",
    });
  }
}

async function generateNowOnce(userId, marketType = "Forex") {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const lastGenerated = await weeklyReportRepository.findRecentlyGeneratedWeeklyReport(userId, marketType, since);
  const currentTradeVersion = await getTradeCacheVersion(userId);
  const lastReportedVersion = lastGenerated?.snapshot?.source?.analyticsSnapshotCache?.version;

  // Backward compatibility: allow one regeneration if old AI feedback exists
  // but psychologyFeedback or trade-version metadata was never stored.
  const hasPsychFeedback = Boolean(lastGenerated?.aiFeedback?.psychologyFeedback);
  if (lastGenerated && hasPsychFeedback && String(lastReportedVersion) === String(currentTradeVersion)) {
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
  computeSnapshot,
  generateNowOnce,
  generateRolling7dReportForUser,
  getWeeklyReport,
  listWeeklyReports,
};
