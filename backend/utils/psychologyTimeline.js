"use strict";

/**
 * Psychology Timeline Engine
 *
 * Aggregates trades into time buckets and computes per-bucket psychology metrics:
 *   - Psychology Score (0-100) — healthy vs unhealthy emotion balance
 *   - Self-Awareness Score (0-100) — how accurately trades are self-rated
 *   - Discipline Score (0-100) — setup adherence + rule compliance
 *   - Emotion Costs — P&L breakdown per emotional tag
 *   - P&L — net profit/loss for the bucket
 *
 * Also produces: milestones, trends (linear regression), and a template-based AI summary.
 *
 * All computation is O(n) — one pass groups trades into buckets, then each bucket
 * is scored inline without calling the full engine on the full dataset again.
 */

const { calculateActualTradeQuality } = require("./tradeEvaluation");
const {
  calculateDisciplineScore,
  calculatePerformanceMetrics,
  calculatePsychologyScore,
} = require("./metricEngine");

// ── Constants ──────────────────────────────────────────────────────────────────

const NEGATIVE_TAGS = new Set(["FOMO", "Revenge", "Fear", "Greed", "Frustrated", "Bored"]);
const POSITIVE_TAGS = new Set(["Calm", "Focused", "Patient", "Disciplined"]);

const MIN_BUCKET_TRADES = 1;
const TREND_MIN_POINTS  = 4;  // need ≥4 buckets to compute a meaningful trend
const TREND_SLOPE_THRESHOLD = 0.3; // score-units per bucket to count as improving/declining

// ── Date key helpers ───────────────────────────────────────────────────────────

function getDayKey(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getWeekKey(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function getMonthKey(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function getKeyFn(period) {
  if (period === "daily")   return getDayKey;
  if (period === "weekly")  return getWeekKey;
  return getMonthKey; // default monthly
}

function getLocalDate(trade, offsetHours = 0) {
  const raw = trade.tradeDate || trade.createdAt;
  if (!raw) return null;
  const ts = new Date(raw).getTime();
  if (Number.isNaN(ts)) return null;
  return new Date(ts + offsetHours * 3600 * 1000);
}

// ── Per-bucket score computation (inline, no full engine call) ─────────────────

function computeBucketPsychologyScore(trades) {
  return calculatePsychologyScore(trades);
}

function computeBucketSelfAwareness(trades) {
  let matched = 0;
  let evaluated = 0;
  for (const t of trades) {
    if (!t.tradeQuality) continue;
    const { tier } = calculateActualTradeQuality(t);
    if (!tier) continue;
    evaluated++;
    if (t.tradeQuality === tier) matched++;
  }
  if (!evaluated) return null;
  return Math.round((matched / evaluated) * 100);
}

function computeBucketDiscipline(trades) {
  return calculateDisciplineScore(trades);
}

function computeBucketEmotions(trades) {
  const tagCosts = {};
  let avgMood = null;
  let moodSum = 0;
  let moodCount = 0;

  for (const t of trades) {
    const pnl = t.profit || 0;
    for (const tag of (t.emotionalTags || [])) {
      if (!tag) continue;
      if (!tagCosts[tag]) tagCosts[tag] = { count: 0, netPnL: 0, isNeg: NEGATIVE_TAGS.has(tag) };
      tagCosts[tag].count++;
      tagCosts[tag].netPnL = Number((tagCosts[tag].netPnL + pnl).toFixed(2));
    }
    if (typeof t.mood === "number") {
      moodSum += t.mood;
      moodCount++;
    }
  }

  if (moodCount > 0) avgMood = Number((moodSum / moodCount).toFixed(2));

  return { tagCosts, avgMood };
}

function computeBucketPnL(trades) {
  const performance = calculatePerformanceMetrics(trades);
  return {
    net: performance.grossPnL,
    tradeCount: performance.totalTrades,
    winRate: performance.winRate,
  };
}

// ── Linear regression for trend ────────────────────────────────────────────────

function computeTrend(values) {
  const n = values.filter(v => v !== null).length;
  if (n < TREND_MIN_POINTS) return "stable";

  const pts = [];
  let xi = 0;
  for (const v of values) {
    if (v !== null) pts.push([xi, v]);
    xi++;
  }

  const sumX  = pts.reduce((s, [x]) => s + x, 0);
  const sumY  = pts.reduce((s, [, y]) => s + y, 0);
  const sumXY = pts.reduce((s, [x, y]) => s + x * y, 0);
  const sumX2 = pts.reduce((s, [x]) => s + x * x, 0);
  const denom = n * sumX2 - sumX * sumX;

  if (denom === 0) return "stable";
  const slope = (n * sumXY - sumX * sumY) / denom;

  if (slope >  TREND_SLOPE_THRESHOLD) return "improving";
  if (slope < -TREND_SLOPE_THRESHOLD) return "declining";
  return "stable";
}

// ── Milestone generation ───────────────────────────────────────────────────────

function generateMilestones(buckets) {
  const milestones = [];
  let psycho70Reached = false;
  let awareness80Reached = false;
  let bestPsycho = { score: -1, key: null };
  let worstPsycho = { score: 101, key: null };
  let revengeStreakBest = 0;
  let revengeStreakCurrent = 0;

  for (const b of buckets) {
    // Best/worst psychology bucket
    if (b.psychologyScore !== null) {
      if (b.psychologyScore > bestPsycho.score) {
        bestPsycho = { score: b.psychologyScore, key: b.key };
      }
      if (b.psychologyScore < worstPsycho.score) {
        worstPsycho = { score: b.psychologyScore, key: b.key };
      }
    }

    // First time crossing 70 psychology
    if (!psycho70Reached && b.psychologyScore !== null && b.psychologyScore >= 70) {
      psycho70Reached = true;
      milestones.push({
        type: "psychology_threshold",
        key: b.key,
        title: "Psychology Score ≥ 70",
        description: `First time reaching a healthy psychology score of ${b.psychologyScore} — emotional discipline is paying off.`,
        icon: "🧠",
      });
    }

    // First time crossing 80 self-awareness
    if (!awareness80Reached && b.selfAwarenessScore !== null && b.selfAwarenessScore >= 80) {
      awareness80Reached = true;
      milestones.push({
        type: "self_awareness_threshold",
        key: b.key,
        title: "Self-Awareness Score ≥ 80",
        description: `You accurately self-assessed ${b.selfAwarenessScore}% of trades — strong self-calibration.`,
        icon: "🔍",
      });
    }

    // Revenge-free streak (no revenge tag in bucket)
    const tags = b.emotions?.tagCosts || {};
    const hasRevenge = tags["Revenge"] && tags["Revenge"].count > 0;
    if (!hasRevenge && b.tradeCount > 0) {
      revengeStreakCurrent++;
      if (revengeStreakCurrent > revengeStreakBest) {
        revengeStreakBest = revengeStreakCurrent;
      }
    } else {
      revengeStreakCurrent = 0;
    }
  }

  // Best/worst bucket milestone
  if (bestPsycho.key && buckets.length >= 3) {
    milestones.push({
      type: "best_psychology",
      key: bestPsycho.key,
      title: "Peak Psychology",
      description: `Your best psychological state — score ${bestPsycho.score} — represents the mindset to replicate.`,
      icon: "🏆",
    });
  }
  if (worstPsycho.key && worstPsycho.score < 40 && buckets.length >= 3) {
    milestones.push({
      type: "worst_psychology",
      key: worstPsycho.key,
      title: "Psychological Low Point",
      description: `Score of ${worstPsycho.score} — emotional costs were highest during this period. Review what triggered it.`,
      icon: "⚠️",
    });
  }

  // Revenge-free streak milestone
  if (revengeStreakBest >= 4) {
    milestones.push({
      type: "revenge_free_streak",
      key: null,
      title: `${revengeStreakBest}-Period Revenge-Free Streak`,
      description: `You went ${revengeStreakBest} consecutive periods without revenge trading — a major discipline win.`,
      icon: "🎯",
    });
  }

  return milestones;
}

// ── Template-based AI summary ──────────────────────────────────────────────────

function generateAISummary(buckets, trends, totalTrades, marketType) {
  if (!buckets.length || totalTrades < 5) {
    return "Not enough trading history to generate a psychology summary. Keep logging trades — insights will appear once you have more data.";
  }

  const recent   = buckets.slice(-3);
  const avgRecent = (arr) => {
    const vals = arr.filter(v => v !== null);
    return vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null;
  };

  const recentPsycho   = avgRecent(recent.map(b => b.psychologyScore));
  const recentAwareness = avgRecent(recent.map(b => b.selfAwarenessScore));
  const recentDiscipline = avgRecent(recent.map(b => b.disciplineScore));

  const parts = [];

  // Opening: psychology trend
  if (trends.psychology === "improving") {
    parts.push(`Your psychology score has been trending upward — emotional decision-making is improving.`);
  } else if (trends.psychology === "declining") {
    parts.push(`Your psychology score has been declining — emotional patterns are worsening and costing money.`);
  } else {
    parts.push(`Your psychology score has remained relatively stable over the tracked period.`);
  }

  // Recent state
  if (recentPsycho !== null) {
    if (recentPsycho >= 70) {
      parts.push(`Recent psychology is healthy at ${recentPsycho}/100 — you are trading with good emotional balance.`);
    } else if (recentPsycho >= 50) {
      parts.push(`Recent psychology score of ${recentPsycho}/100 is average — there is room to reduce emotional interference.`);
    } else {
      parts.push(`Recent psychology score of ${recentPsycho}/100 is below healthy — emotional costs are actively reducing returns.`);
    }
  }

  // Self-awareness
  if (recentAwareness !== null) {
    if (recentAwareness >= 75) {
      parts.push(`Self-awareness is strong at ${recentAwareness}% — you accurately judge your own trade quality.`);
    } else if (recentAwareness >= 50) {
      parts.push(`Self-awareness is developing at ${recentAwareness}% — continue rating trades consistently to improve calibration.`);
    } else {
      parts.push(`Self-awareness is low at ${recentAwareness}% — your self-ratings frequently disagree with execution quality.`);
    }
  }

  // Discipline
  if (recentDiscipline !== null) {
    if (recentDiscipline >= 70) {
      parts.push(`Discipline is strong — setup adherence and rule compliance are both high.`);
    } else if (recentDiscipline >= 45) {
      parts.push(`Discipline is moderate — tighter rule compliance would improve execution quality.`);
    } else {
      parts.push(`Discipline score is low — frequent rule violations and poor setup adherence are costing you.`);
    }
  }

  // Closing advice
  if (trends.psychology === "improving" && recentPsycho !== null && recentPsycho >= 65) {
    parts.push(`Keep the momentum going — your psychological edge is building.`);
  } else if (trends.psychology === "declining") {
    parts.push(`Focus on identifying the emotional triggers driving the decline — review your most costly tagged trades.`);
  } else {
    parts.push(`Your next growth area: close the gap between self-rating and actual execution quality.`);
  }

  return parts.join(" ");
}

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * @param {object[]} trades     Lean MongoDB documents
 * @param {object}   options
 * @param {string}   options.period       "daily" | "weekly" | "monthly" (default "weekly")
 * @param {string}   options.marketType   "Forex" | "Indian_Market" etc.
 * @param {number}   options.offsetHours  timezone offset hours (default 0)
 * @returns {object}
 */
function computePsychologyTimeline(trades, { period = "weekly", marketType = "Forex", offsetHours = 0 } = {}) {
  if (!Array.isArray(trades) || trades.length === 0) {
    return {
      insufficient: true,
      reason: "no_trades",
      message: "No trades found. Start logging trades to see your psychology timeline.",
      buckets: [],
      trends: { psychology: "stable", selfAwareness: "stable", discipline: "stable" },
      milestones: [],
      aiSummary: "No trading history available yet.",
      period,
      marketType,
      generatedAt: new Date().toISOString(),
    };
  }

  const keyFn  = getKeyFn(period);
  const bucketMap = new Map(); // key → trades[]

  // Single pass: group into buckets
  for (const t of trades) {
    const localDate = getLocalDate(t, offsetHours);
    if (!localDate) continue;
    const key = keyFn(localDate);
    if (!key) continue;
    if (!bucketMap.has(key)) bucketMap.set(key, []);
    bucketMap.get(key).push(t);
  }

  if (bucketMap.size === 0) {
    return {
      insufficient: true,
      reason: "no_valid_dates",
      message: "Trade dates could not be parsed.",
      buckets: [],
      trends: { psychology: "stable", selfAwareness: "stable", discipline: "stable" },
      milestones: [],
      aiSummary: "Unable to build timeline — trade dates are missing or invalid.",
      period,
      marketType,
      generatedAt: new Date().toISOString(),
    };
  }

  // Sort bucket keys chronologically
  const sortedKeys = [...bucketMap.keys()].sort();

  const buckets = sortedKeys.map(key => {
    const bTrades = bucketMap.get(key);
    if (bTrades.length < MIN_BUCKET_TRADES) return null;

    const psychologyScore   = computeBucketPsychologyScore(bTrades);
    const selfAwarenessScore = computeBucketSelfAwareness(bTrades);
    const disciplineScore   = computeBucketDiscipline(bTrades);
    const emotions          = computeBucketEmotions(bTrades);
    const pnlStats          = computeBucketPnL(bTrades);

    return {
      key,
      tradeCount:       pnlStats.tradeCount,
      psychologyScore,
      selfAwarenessScore,
      disciplineScore,
      emotions,
      net:              pnlStats.net,
      winRate:          pnlStats.winRate,
    };
  }).filter(Boolean);

  if (buckets.length === 0) {
    return {
      insufficient: true,
      reason: "no_valid_buckets",
      message: "Not enough trade data per period to build a timeline.",
      buckets: [],
      trends: { psychology: "stable", selfAwareness: "stable", discipline: "stable" },
      milestones: [],
      aiSummary: "Not enough data per time period.",
      period,
      marketType,
      generatedAt: new Date().toISOString(),
    };
  }

  const trends = {
    psychology:    computeTrend(buckets.map(b => b.psychologyScore)),
    selfAwareness: computeTrend(buckets.map(b => b.selfAwarenessScore)),
    discipline:    computeTrend(buckets.map(b => b.disciplineScore)),
  };

  const milestones = generateMilestones(buckets);
  const aiSummary  = generateAISummary(buckets, trends, trades.length, marketType);

  // Aggregate stats over all buckets for quick access
  const allPsycho     = buckets.map(b => b.psychologyScore);
  const allAwareness  = buckets.filter(b => b.selfAwarenessScore !== null).map(b => b.selfAwarenessScore);
  const allDiscipline = buckets.filter(b => b.disciplineScore !== null).map(b => b.disciplineScore);
  const avg           = (arr) => arr.length ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : null;

  const stats = {
    avgPsychologyScore:    avg(allPsycho),
    avgSelfAwarenessScore: avg(allAwareness),
    avgDisciplineScore:    avg(allDiscipline),
    bestPsychologyScore:   allPsycho.length ? Math.max(...allPsycho) : null,
    worstPsychologyScore:  allPsycho.length ? Math.min(...allPsycho) : null,
    totalBuckets:          buckets.length,
    totalTrades:           trades.length,
  };

  return {
    insufficient: false,
    buckets,
    trends,
    milestones,
    stats,
    aiSummary,
    period,
    marketType,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  computePsychologyTimeline,
  getDayKey,
  getWeekKey,
  getMonthKey,
  computeBucketPsychologyScore,
  computeBucketSelfAwareness,
  computeBucketDiscipline,
  computeBucketEmotions,
  computeBucketPnL,
  computeTrend,
  generateMilestones,
  generateAISummary,
};
