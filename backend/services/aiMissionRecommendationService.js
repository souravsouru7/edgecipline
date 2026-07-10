"use strict";

/**
 * AI Mission Recommendation Engine
 *
 * Analyzes the user's trading behavior over a configurable lookback window
 * and recommends the most relevant mission(s) from the active template pool.
 *
 * Recommendation is rule-based first (fast, deterministic, explainable) and
 * optionally enriched by a brief Gemini call for the coaching rationale copy.
 */

const Trade = require("../models/Trade");
const IndianTrade = require("../models/IndianTrade");
const DailyReflection = require("../models/DailyReflection");
const WeeklyReport = require("../models/WeeklyReport");
const ChecklistTracking = require("../models/ChecklistTracking");
const MissionTemplate = require("../models/MissionTemplate");
const MissionAssignment = require("../models/MissionAssignment");
const { assignMission } = require("./missionService");
const { logger } = require("../utils/logger");

const DEFAULT_LOOKBACK_DAYS = 30;
const MIN_TRADES_FOR_ANALYSIS = 3;

// ─── Behavior profile builder ─────────────────────────────────────────────────

async function buildBehaviorProfile(userId, lookbackDays = DEFAULT_LOOKBACK_DAYS) {
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  // Fetch recent trades from both markets
  const [forexTrades, indianTrades] = await Promise.all([
    Trade.find({ user: userId, createdAt: { $gte: since }, deleted: { $ne: true } })
      .select("profit stopLoss riskPercent riskRewardRatio notes setupRules setupScore tradeDate marketType")
      .lean(),
    IndianTrade.find({ user: userId, createdAt: { $gte: since }, deleted: { $ne: true } })
      .select("profit stopLoss riskPercent riskRewardRatio notes setupRules setupScore tradeDate")
      .lean(),
  ]);

  const trades = [...forexTrades, ...indianTrades];
  const tradeCount = trades.length;

  if (tradeCount < MIN_TRADES_FOR_ANALYSIS) {
    return { tradeCount, insufficient: true };
  }

  // ── Risk metrics ──
  const tradesWithRisk = trades.filter(t => Number.isFinite(t.riskPercent) && t.riskPercent > 0);
  const avgRiskPercent = tradesWithRisk.length
    ? tradesWithRisk.reduce((s, t) => s + t.riskPercent, 0) / tradesWithRisk.length
    : null;
  const highRiskTrades = tradesWithRisk.filter(t => t.riskPercent > 1.0).length;

  const tradesWithRR = trades.filter(t => Number.isFinite(t.riskRewardRatio) && t.riskRewardRatio > 0);
  const avgRiskReward = tradesWithRR.length
    ? tradesWithRR.reduce((s, t) => s + t.riskRewardRatio, 0) / tradesWithRR.length
    : null;

  const stopLossMissingRate = trades.filter(t => !t.stopLoss || Number(t.stopLoss) === 0).length / tradeCount;

  // ── Discipline metrics ──
  const tradesWithChecklist = trades.filter(t => Array.isArray(t.setupRules) && t.setupRules.length > 0).length;
  const checklistAdherence = tradeCount ? tradesWithChecklist / tradeCount : 0;

  const tradesWithNotes = trades.filter(t => t.notes && String(t.notes).trim().length > 10).length;
  const losingTrades = trades.filter(t => Number.isFinite(t.profit) && t.profit < 0);
  const losingTradesWithNotes = losingTrades.filter(t => t.notes && String(t.notes).trim().length > 10).length;
  const lossNotesRate = losingTrades.length ? losingTradesWithNotes / losingTrades.length : 1;

  // ── Psychology metrics ──
  const reflections = await DailyReflection.find({ user: userId, createdAt: { $gte: since } })
    .select("mood confidence followPlan")
    .lean();

  const reflectionCount = reflections.length;
  const tradingDays = new Set(trades.map(t => {
    const d = t.tradeDate || t.createdAt;
    return d ? new Date(d).toISOString().slice(0, 10) : null;
  }).filter(Boolean)).size;

  const reflectionCompletionRate = tradingDays ? Math.min(reflectionCount / tradingDays, 1) : 0;

  const avgMood = reflectionCount
    ? reflections.reduce((s, r) => s + (r.mood || 0), 0) / reflectionCount
    : null;
  const avgConfidence = reflectionCount
    ? reflections.reduce((s, r) => s + (r.confidence || 0), 0) / reflectionCount
    : null;

  const planAdherenceCount = reflections.filter(r => r.followedPlan === "yes").length;
  const planAdherenceRate = reflectionCount ? planAdherenceCount / reflectionCount : null;

  // ── Weekly review metrics ──
  const weeklyReports = await WeeklyReport.countDocuments({ user: userId, createdAt: { $gte: since } });
  const expectedWeeklyReports = Math.floor(lookbackDays / 7);
  const weeklyReviewCompletionRate = expectedWeeklyReports
    ? Math.min(weeklyReports / expectedWeeklyReports, 1)
    : 1;

  // ── Journal consistency ──
  const tradeDays = new Set(trades.map(t => {
    const d = t.tradeDate || t.createdAt;
    return d ? new Date(d).toISOString().slice(0, 10) : null;
  }).filter(Boolean));
  const journalConsistency = tradingDays >= 3 ? tradeDays.size / tradingDays : 1;

  // ── Setup quality ──
  const setupScores = trades.filter(t => Number.isFinite(t.setupScore)).map(t => t.setupScore);
  const setupQualityScore = setupScores.length
    ? setupScores.reduce((s, v) => s + v, 0) / setupScores.length / 100
    : null;

  // ── Revenge / FOMO proxies ──
  // We approximate revenge trading as: trade placed within 30 min of a losing trade
  const sortedTrades = [...trades].sort((a, b) => {
    const da = new Date(a.tradeDate || a.createdAt).getTime();
    const db = new Date(b.tradeDate || b.createdAt).getTime();
    return da - db;
  });
  let revengeTradeCount = 0;
  for (let i = 1; i < sortedTrades.length; i++) {
    const prev = sortedTrades[i - 1];
    const curr = sortedTrades[i];
    if (Number.isFinite(prev.profit) && prev.profit < 0) {
      const prevTime = new Date(prev.tradeDate || prev.createdAt).getTime();
      const currTime = new Date(curr.tradeDate || curr.createdAt).getTime();
      if (currTime - prevTime < 30 * 60 * 1000) revengeTradeCount++;
    }
  }
  const revengeTradeRate = tradeCount > 1 ? revengeTradeCount / tradeCount : 0;

  // FOMO: trade where notes contain "fomo" or very low confidence + no checklist
  const fomoTrades = trades.filter(t => {
    const hasTag = t.notes && /\bfomo\b/i.test(t.notes);
    return hasTag;
  });
  const fomoTradeRate = fomoTrades.length / tradeCount;

  // Low confidence trades
  const lowConfidenceTrades = reflections.filter(r => Number.isFinite(r.confidence) && r.confidence <= 2).length;
  const lowConfidenceTradeRate = reflectionCount ? lowConfidenceTrades / reflectionCount : 0;

  return {
    tradeCount,
    insufficient: false,
    tradingDays,
    // Risk
    avgRiskPercent,
    highRiskTrades,
    stopLossMissingRate,
    avgRiskReward,
    // Discipline
    checklistAdherence,
    lossNotesRate,
    planAdherenceRate,
    // Psychology
    reflectionCompletionRate,
    avgMood,
    avgConfidence,
    revengeTradeRate,
    fomoTradeRate,
    lowConfidenceTradeRate,
    // Journal
    journalConsistency,
    weeklyReviewCompletionRate,
    setupQualityScore,
  };
}

// ─── Rule-based scorer ───────────────────────────────────────────────────────

/**
 * Score each template against the behavior profile.
 * Returns sorted list of { template, score, reason }.
 */
function scoreTemplates(templates, profile) {
  const scored = [];

  for (const template of templates) {
    const { triggerMetric, triggerOperator, triggerThreshold } = template;
    if (!triggerMetric || triggerThreshold == null) {
      scored.push({ template, score: 0.1, reason: null });
      continue;
    }

    const value = profile[triggerMetric];
    if (value == null || !Number.isFinite(value)) {
      scored.push({ template, score: 0, reason: null });
      continue;
    }

    let triggered = false;
    switch (triggerOperator) {
      case "gt":  triggered = value > triggerThreshold; break;
      case "lt":  triggered = value < triggerThreshold; break;
      case "gte": triggered = value >= triggerThreshold; break;
      case "lte": triggered = value <= triggerThreshold; break;
      case "eq":  triggered = Math.abs(value - triggerThreshold) < 0.001; break;
    }

    if (!triggered) {
      scored.push({ template, score: 0, reason: null });
      continue;
    }

    // Score is proportional to how far outside the threshold the value is
    const deviation = Math.abs(value - triggerThreshold);
    const relativeDeviation = triggerThreshold !== 0 ? deviation / Math.abs(triggerThreshold) : deviation;
    const score = Math.min(relativeDeviation + 0.1, 2.0);

    const reason = buildReason(template, profile, value);
    scored.push({ template, score, reason });
  }

  return scored.sort((a, b) => b.score - a.score);
}

function buildReason(template, profile, metricValue) {
  const formatted = Number.isFinite(metricValue)
    ? Math.round(metricValue * 100) + (metricValue <= 1 ? "%" : "")
    : "N/A";

  const reasonMap = {
    revengeTradeRate:         `Revenge trades detected in ${formatted} of your recent trades`,
    avgRiskPercent:           `Your average risk per trade is ${formatted} — above the 1% target`,
    stopLossMissingRate:      `Stop loss missing on ${formatted} of your recent trades`,
    avgRiskReward:            `Your average R:R is ${formatted} — below the 1:1.5 target`,
    checklistAdherence:       `You completed your checklist on only ${formatted} of trades`,
    reflectionCompletionRate: `You completed daily reflection only ${formatted} of trading days`,
    avgMood:                  `Your average trading mood score is ${Math.round(metricValue * 10) / 10}/5`,
    avgConfidence:            `Your average confidence score is ${Math.round(metricValue * 10) / 10}/5`,
    planAdherenceRate:        `You followed your plan only ${formatted} of the time`,
    journalConsistency:       `You logged trades on only ${formatted} of your trading days`,
    weeklyReviewCompletionRate: `You completed only ${formatted} of your weekly reviews`,
    fomoTradeRate:            `FOMO trades detected in ${formatted} of recent trades`,
    lossNotesRate:            `Only ${formatted} of your losing trades had lesson notes`,
    setupQualityScore:        `Your setup quality score is ${formatted}`,
    lowConfidenceTradeRate:   `${formatted} of your trades were low confidence`,
  };

  return reasonMap[template.triggerMetric] || `Your ${template.triggerMetric} needs attention`;
}

// ─── Main recommendation function ────────────────────────────────────────────

/**
 * Generate and assign recommended missions for a user.
 *
 * @param {string} userId
 * @param {object} opts
 * @param {number} opts.maxRecommendations - How many missions to recommend (default 3)
 * @param {number} opts.lookbackDays       - Behavior analysis window (default 30)
 * @returns {{ assigned: object[], profile: object, reason: string }}
 */
async function recommendMissions(userId, { maxRecommendations = 3, lookbackDays = DEFAULT_LOOKBACK_DAYS } = {}) {
  const profile = await buildBehaviorProfile(userId, lookbackDays);

  if (profile.insufficient) {
    return {
      assigned: [],
      profile,
      reason: "Not enough trade data for personalized recommendations. Log more trades first.",
    };
  }

  // Fetch all active templates
  const templates = await MissionTemplate.find({ isActive: true }).lean();

  // Filter out templates the user already has active
  const existingAssignments = await MissionAssignment.find({
    user: userId,
    status: { $in: ["available", "accepted", "active"] },
  })
    .select("template")
    .lean();
  const existingTemplateIds = new Set(existingAssignments.map(a => String(a.template)));

  const eligibleTemplates = templates.filter(t => !existingTemplateIds.has(String(t._id)));

  // Score and rank
  const scored = scoreTemplates(eligibleTemplates, profile);
  const topCandidates = scored.filter(s => s.score > 0).slice(0, maxRecommendations);

  if (topCandidates.length === 0) {
    // Fallback: pick beginner templates from different categories if no strong signal
    const fallback = eligibleTemplates
      .filter(t => t.difficulty === "beginner")
      .slice(0, maxRecommendations);
    topCandidates.push(...fallback.map(t => ({ template: t, score: 0.05, reason: "Good habit to build" })));
  }

  // Assign (create available assignments)
  const assigned = [];
  for (const { template, reason } of topCandidates.slice(0, maxRecommendations)) {
    try {
      const assignment = await assignMission(userId, template._id, {
        recommendedBy: "ai",
        recommendationReason: reason,
      });
      assigned.push(assignment);
    } catch (err) {
      logger.warn("[Mission] Skipped duplicate assignment", { userId, templateId: template._id, err: err.message });
    }
  }

  logger.info("[Mission] AI recommendations generated", { userId, count: assigned.length });
  return { assigned, profile, reason: null };
}

/**
 * Get current behavior profile without assigning anything.
 */
async function getUserBehaviorProfile(userId, lookbackDays = DEFAULT_LOOKBACK_DAYS) {
  return buildBehaviorProfile(userId, lookbackDays);
}

module.exports = {
  recommendMissions,
  getUserBehaviorProfile,
  buildBehaviorProfile,
  scoreTemplates,
};
