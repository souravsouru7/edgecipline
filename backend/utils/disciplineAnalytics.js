"use strict";

/**
 * Discipline Analytics Engine
 *
 * Computes 13 modules of discipline analytics from trade history:
 *   1.  Overview        — current/weekly/monthly/all-time scores + trend
 *   2.  Compliance      — total rules evaluated, followed, broken
 *   3.  Rule Performance — per-rule win rate, P&L when followed vs broken
 *   4.  Rule Cost        — cost of each violation + top by cost/frequency
 *   5.  Setup Performance — per-strategy win rate, P&L, avg discipline
 *   6.  Timeline         — discipline score per daily/weekly/monthly bucket
 *   7.  Psychology Correlation — discipline vs mood/confidence/emotion
 *   8.  Discipline Patterns    — best/worst discipline+psychology combos
 *   9.  DNA Integration  — strongest rule, most valuable rule, best setup
 *   10. Coach Insights   — data-driven coaching messages
 *
 * Convention (matches existing engines):
 *   rule.followed === false  → explicitly broken
 *   rule.followed === true   → explicitly followed
 *   anything else            → not tracked (excluded from compliance calc)
 *
 * P&L fields:   All read trade.profit, which computeDisciplineAnalytics has
 *               already normalised to NET for the market being analysed.
 * Performance:  O(n × m) where m = avg rules per trade ≤ 20
 */

const { withLabels } = require("./setupScoreBuckets");
const { withNetPnL } = require("./metricEngine");

// ── Constants ──────────────────────────────────────────────────────────────────

// Shared boundaries (see utils/setupScoreBuckets.js)
const SETUP_SCORE_RANGES = withLabels({
  poor:    "0–39",
  low:     "40–59",
  average: "60–79",
  strong:  "80–100",
});

const NEGATIVE_TAGS = new Set(["FOMO", "Revenge", "Fear", "Greed", "Frustrated", "Bored"]);
const POSITIVE_TAGS = new Set(["Calm", "Focused", "Patient", "Disciplined"]);

const MIN_INSIGHT_TRADES  = 3;
const TREND_MIN_POINTS    = 4;
const TREND_SLOPE_THRESH  = 0.3;

// ── Math helpers ───────────────────────────────────────────────────────────────

const pct  = (n, d) => (d ? Number(((n / d) * 100).toFixed(1)) : 0);
const fix2 = (n)    => Number(Number(n || 0).toFixed(2));

function getConfidence(count) {
  if (!count || count < 5)  return null;
  if (count < 10)            return "Low";
  if (count < 30)            return "Medium";
  return "High";
}

function getSetupScoreBucket(score) {
  for (const r of SETUP_SCORE_RANGES) {
    if (score >= r.min && score < r.max) return r.label;
  }
  return "0–39";
}

// ── Date key helpers (UTC-based, after timezone shift via getLocalTs) ──────────

function getLocalTs(trade, offsetHours) {
  const raw = trade.tradeDate || trade.createdAt;
  if (!raw) return null;
  const ts = new Date(raw).getTime();
  if (Number.isNaN(ts)) return null;
  return new Date(ts + (offsetHours || 0) * 3600 * 1000);
}

function getDayKey(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function getWeekKey(d) {
  const copy = new Date(d.getTime());
  copy.setUTCHours(0, 0, 0, 0);
  copy.setUTCDate(copy.getUTCDate() + 4 - (copy.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(copy.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((copy - yearStart) / 86400000) + 1) / 7);
  return `${copy.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function getMonthKey(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function getKeyFn(period) {
  if (period === "daily")  return getDayKey;
  if (period === "weekly") return getWeekKey;
  return getMonthKey;
}

// ── Trend (linear regression on last N values) ─────────────────────────────────

function computeTrend(values) {
  const pts = values.filter(v => v !== null && v !== undefined);
  if (pts.length < TREND_MIN_POINTS) return "stable";
  const n    = pts.length;
  const sumX  = pts.reduce((s, _, i) => s + i, 0);
  const sumY  = pts.reduce((s, v)    => s + v, 0);
  const sumXY = pts.reduce((s, v, i) => s + i * v, 0);
  const sumX2 = pts.reduce((s, _, i) => s + i * i, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return "stable";
  const slope = (n * sumXY - sumX * sumY) / denom;
  if (slope >  TREND_SLOPE_THRESH) return "improving";
  if (slope < -TREND_SLOPE_THRESH) return "declining";
  return "stable";
}

// ── Shared per-trade rule helpers ──────────────────────────────────────────────

function getTrackedRules(trade) {
  if (!Array.isArray(trade.setupRules) || trade.setupRules.length === 0) return [];
  return trade.setupRules.filter(r => r?.label && (r.followed === true || r.followed === false));
}

// ── Module 2: Checklist Compliance ────────────────────────────────────────────

function computeChecklistCompliance(trades) {
  let totalEvaluated = 0;
  let totalFollowed  = 0;
  let totalBroken    = 0;
  const followCounts = {};
  const breakCounts  = {};

  for (const t of trades) {
    const rules = getTrackedRules(t);
    for (const rule of rules) {
      const label = String(rule.label).trim();
      totalEvaluated++;
      if (rule.followed === true) {
        totalFollowed++;
        followCounts[label] = (followCounts[label] || 0) + 1;
      } else {
        totalBroken++;
        breakCounts[label] = (breakCounts[label] || 0) + 1;
      }
    }
  }

  const compliancePct = totalEvaluated > 0
    ? pct(totalFollowed, totalEvaluated)
    : null;

  const sortedFollowed = Object.entries(followCounts).sort((a, b) => b[1] - a[1]);
  const sortedBroken   = Object.entries(breakCounts).sort((a, b) => b[1] - a[1]);

  return {
    totalRulesEvaluated: totalEvaluated,
    totalRulesFollowed:  totalFollowed,
    totalRulesBroken:    totalBroken,
    compliancePct,
    mostFollowedRule: sortedFollowed[0]?.[0] ?? null,
    mostSkippedRule:  sortedBroken[0]?.[0]   ?? null,
  };
}

// ── Modules 3 + 4: Rule Performance & Cost ────────────────────────────────────

function computeRuleAnalytics(trades) {
  // Map: label → { label, followedPnls[], followedWins, brokenPnls[], brokenWins }
  const map = new Map();

  for (const t of trades) {
    const rules = getTrackedRules(t);
    if (!rules.length) continue;
    const pnl = t.profit || 0;
    const win = pnl > 0;

    for (const rule of rules) {
      const label = String(rule.label).trim();
      if (!map.has(label)) {
        map.set(label, {
          label,
          followedPnls: [], followedWins: 0,
          brokenPnls:   [], brokenWins:   0,
        });
      }
      const e = map.get(label);
      if (rule.followed === true) {
        e.followedPnls.push(pnl);
        if (win) e.followedWins++;
      } else {
        e.brokenPnls.push(pnl);
        if (win) e.brokenWins++;
      }
    }
  }

  const results = [];
  for (const [, e] of map) {
    const fCount = e.followedPnls.length;
    const bCount = e.brokenPnls.length;
    const total  = fCount + bCount;

    const fNet  = fix2(e.followedPnls.reduce((s, p) => s + p, 0));
    const bNet  = fix2(e.brokenPnls.reduce((s, p) => s + p, 0));
    const fAvg  = fCount ? fix2(fNet / fCount) : null;
    const bAvg  = bCount ? fix2(bNet / bCount) : null;

    results.push({
      label:            e.label,
      timesFollowed:    fCount,
      timesBroken:      bCount,
      compliancePct:    total ? pct(fCount, total) : null,
      winRateFollowed:  fCount ? pct(e.followedWins, fCount) : null,
      winRateBroken:    bCount ? pct(e.brokenWins,   bCount) : null,
      netPnLFollowed:   fNet,
      netPnLBroken:     bNet,
      avgPnLFollowed:   fAvg,
      avgPnLBroken:     bAvg,
      // Only a meaningful edge when the rule has been both followed and broken at least once
      pnlDifference:    (fCount && bCount) ? fix2(fAvg - bAvg) : null,   // +ve = following is better
      costOfBreaking:   bCount > 0 ? fix2(Math.max(0, -bNet)) : 0,
      confidence:       getConfidence(total),
    });
  }

  // Sort: most appearances first, then alphabetical for ties
  results.sort((a, b) => {
    const totA = a.timesFollowed + a.timesBroken;
    const totB = b.timesFollowed + b.timesBroken;
    return totB !== totA ? totB - totA : a.label.localeCompare(b.label);
  });

  // Module 4 views
  const withCost = results.filter(r => r.timesBroken > 0);
  const topByCost      = [...withCost].sort((a, b) => b.costOfBreaking - a.costOfBreaking).slice(0, 10);
  const topByFrequency = [...withCost].sort((a, b) => b.timesBroken - a.timesBroken).slice(0, 10);

  return { ruleAnalytics: results, topByCost, topByFrequency };
}

// ── Module 5: Setup Performance ────────────────────────────────────────────────

function computeSetupPerformance(trades) {
  // Map: strategy name → accumulated stats
  const map = new Map();

  for (const t of trades) {
    const name = (t.strategy || "").trim() || "Unspecified";
    if (!map.has(name)) {
      map.set(name, {
        name,
        pnls: [],
        wins: 0,
        setupScores:     [],
        disciplineScores: [],  // fraction of rules followed per trade
      });
    }
    const e   = map.get(name);
    const pnl = t.profit || 0;
    e.pnls.push(pnl);
    if (pnl > 0) e.wins++;

    if (typeof t.setupScore === "number") e.setupScores.push(t.setupScore);

    const tracked = getTrackedRules(t);
    if (tracked.length > 0) {
      const followed = tracked.filter(r => r.followed === true).length;
      e.disciplineScores.push(followed / tracked.length);
    }
  }

  const results = [];
  for (const [, e] of map) {
    const count = e.pnls.length;
    const net   = fix2(e.pnls.reduce((s, p) => s + p, 0));
    const avgSetupScore     = e.setupScores.length
      ? Number((e.setupScores.reduce((s, v) => s + v, 0) / e.setupScores.length).toFixed(1))
      : null;
    const avgDisciplineScore = e.disciplineScores.length
      ? Number(((e.disciplineScores.reduce((s, v) => s + v, 0) / e.disciplineScores.length) * 100).toFixed(1))
      : null;

    results.push({
      setupName:           e.name,
      trades:              count,
      winRate:             pct(e.wins, count),
      netPnL:              net,
      avgPnL:              count ? fix2(net / count) : 0,
      avgSetupScore,
      avgDisciplineScore,
      confidence:          getConfidence(count),
    });
  }

  results.sort((a, b) => b.netPnL - a.netPnL || b.trades - a.trades);

  const qualified = results.filter(r => r.confidence !== null);
  const bestSetup  = qualified.length ? qualified[0] : null;
  const worstSetup = qualified.length > 1 ? qualified[qualified.length - 1] : null;

  return { setupPerformance: results, bestSetup, worstSetup };
}

// ── Module 6: Discipline Timeline ─────────────────────────────────────────────

function computeDisciplineTimeline(trades, { period = "monthly", offsetHours = 0 } = {}) {
  const keyFn   = getKeyFn(period);
  const bucketM = new Map(); // key → { pnls, wins, scores, disciplineNums, disciplineDens }

  for (const t of trades) {
    const localDate = getLocalTs(t, offsetHours);
    if (!localDate) continue;
    const key = keyFn(localDate);
    if (!key) continue;

    if (!bucketM.has(key)) {
      bucketM.set(key, {
        pnls: [], wins: 0,
        scores: [],          // setupScore values
        disciplineNums: 0,   // sum of rules followed
        disciplineDens: 0,   // sum of total tracked rules
      });
    }
    const b   = bucketM.get(key);
    const pnl = t.profit || 0;
    b.pnls.push(pnl);
    if (pnl > 0) b.wins++;

    if (typeof t.setupScore === "number") b.scores.push(t.setupScore);

    const tracked = getTrackedRules(t);
    if (tracked.length > 0) {
      b.disciplineNums += tracked.filter(r => r.followed === true).length;
      b.disciplineDens += tracked.length;
    }
  }

  const sortedKeys = [...bucketM.keys()].sort();
  const buckets = sortedKeys.map(key => {
    const b     = bucketM.get(key);
    const count = b.pnls.length;
    const net   = fix2(b.pnls.reduce((s, p) => s + p, 0));
    const disciplineScore = b.scores.length
      ? Number((b.scores.reduce((s, v) => s + v, 0) / b.scores.length).toFixed(1))
      : null;
    const compliancePct = b.disciplineDens > 0
      ? pct(b.disciplineNums, b.disciplineDens)
      : null;

    return {
      key,
      tradeCount:      count,
      disciplineScore,
      compliancePct,
      netPnL:          net,
      winRate:         pct(b.wins, count),
    };
  });

  const trend = computeTrend(buckets.map(b => b.disciplineScore));

  return { period, buckets, trend };
}

// ── Module 7: Psychology Correlation ──────────────────────────────────────────

function computePsychologyCorrelation(trades) {
  // By setup score range: win rate + avg P&L
  const rangeMap = {};
  for (const r of SETUP_SCORE_RANGES) rangeMap[r.label] = { pnls: [], wins: 0 };

  // By mood: avg setup score
  const moodMap = {};
  // By confidence: avg setup score
  const confMap = {};
  // By emotion tag: avg setup score
  const tagMap  = {};

  for (const t of trades) {
    const pnl = t.profit || 0;
    const win = pnl > 0;

    if (typeof t.setupScore === "number") {
      const bucket = getSetupScoreBucket(t.setupScore);
      rangeMap[bucket].pnls.push(pnl);
      if (win) rangeMap[bucket].wins++;

      if (typeof t.mood === "number") {
        const mk = String(t.mood);
        if (!moodMap[mk]) moodMap[mk] = { sum: 0, count: 0 };
        moodMap[mk].sum += t.setupScore;
        moodMap[mk].count++;
      }

      if (t.confidence) {
        if (!confMap[t.confidence]) confMap[t.confidence] = { sum: 0, count: 0 };
        confMap[t.confidence].sum   += t.setupScore;
        confMap[t.confidence].count++;
      }

      for (const tag of (t.emotionalTags || [])) {
        if (!tag) continue;
        if (!tagMap[tag]) tagMap[tag] = { sum: 0, count: 0 };
        tagMap[tag].sum   += t.setupScore;
        tagMap[tag].count++;
      }
    }
  }

  const bySetupRange = SETUP_SCORE_RANGES.map(r => {
    const b   = rangeMap[r.label];
    const cnt = b.pnls.length;
    if (!cnt) return null;
    const net = b.pnls.reduce((s, p) => s + p, 0);
    return {
      range:      r.label,
      count:      cnt,
      winRate:    pct(b.wins, cnt),
      netPnL:     fix2(net),
      avgPnL:     fix2(net / cnt),
      confidence: getConfidence(cnt),
    };
  }).filter(Boolean);

  const byMood = Object.entries(moodMap)
    .map(([mood, { sum, count }]) => ({
      mood:          Number(mood),
      avgSetupScore: Number((sum / count).toFixed(1)),
      count,
    }))
    .sort((a, b) => a.mood - b.mood);

  const CONF_ORDER = ["Low", "Medium", "High", "Overconfident"];
  const byConfidence = Object.entries(confMap)
    .map(([conf, { sum, count }]) => ({
      confidence:    conf,
      avgSetupScore: Number((sum / count).toFixed(1)),
      count,
    }))
    .sort((a, b) => CONF_ORDER.indexOf(a.confidence) - CONF_ORDER.indexOf(b.confidence));

  const byEmotionalTag = Object.entries(tagMap)
    .map(([tag, { sum, count }]) => ({
      tag,
      isNeg:         NEGATIVE_TAGS.has(tag),
      isPos:         POSITIVE_TAGS.has(tag),
      avgSetupScore: Number((sum / count).toFixed(1)),
      count,
    }))
    .sort((a, b) => b.avgSetupScore - a.avgSetupScore);

  // Optimal threshold: lowest setup range with meaningfully positive win rate
  const positiveRanges = bySetupRange.filter(r => r.winRate >= 50 && r.count >= MIN_INSIGHT_TRADES);
  const optimalThreshold = positiveRanges.length
    ? Math.min(...positiveRanges.map(r => SETUP_SCORE_RANGES.find(sr => sr.label === r.range)?.min ?? 100))
    : null;

  return { bySetupRange, byMood, byConfidence, byEmotionalTag, optimalThreshold };
}

// ── Module 8: Discipline Patterns ─────────────────────────────────────────────

function computeDisciplinePatterns(trades) {
  const groups = {
    "high_disc_pos_emotion":   { label: "High Discipline + Positive Emotion", type: "positive",  pnls: [], wins: 0 },
    "high_disc_neg_emotion":   { label: "High Discipline + Negative Emotion", type: "negative",  pnls: [], wins: 0 },
    "low_disc_neg_emotion":    { label: "Low Discipline + Negative Emotion",  type: "negative",  pnls: [], wins: 0 },
    "low_disc_pos_emotion":    { label: "Low Discipline + Positive Emotion",  type: "neutral",   pnls: [], wins: 0 },
    "plan_high_disc":          { label: "Planned Entry + High Discipline",     type: "positive",  pnls: [], wins: 0 },
    "impulsive_low_disc":      { label: "Impulsive Entry + Low Discipline",    type: "negative",  pnls: [], wins: 0 },
    "high_disc_no_emotion":    { label: "High Discipline + No Emotion Tag",   type: "positive",  pnls: [], wins: 0 },
  };

  for (const t of trades) {
    if (typeof t.setupScore !== "number") continue;
    const pnl    = t.profit || 0;
    const win    = pnl > 0;
    const high   = t.setupScore >= 80;
    const low    = t.setupScore < 40;
    const tags   = t.emotionalTags || [];
    const hasNeg = tags.some(tg => NEGATIVE_TAGS.has(tg));
    const hasPos = tags.some(tg => POSITIVE_TAGS.has(tg));
    const noTag  = tags.length === 0;
    const isImpulsive = t.entryBasis === "Emotion" || t.entryBasis === "Impulsive";
    const isPlan      = t.entryBasis === "Plan";

    const push = (key) => {
      groups[key].pnls.push(pnl);
      if (win) groups[key].wins++;
    };

    if (high && hasPos)  push("high_disc_pos_emotion");
    if (high && hasNeg)  push("high_disc_neg_emotion");
    if (low  && hasNeg)  push("low_disc_neg_emotion");
    if (low  && hasPos)  push("low_disc_pos_emotion");
    if (high && isPlan)  push("plan_high_disc");
    if (low  && isImpulsive) push("impulsive_low_disc");
    if (high && noTag)   push("high_disc_no_emotion");
  }

  const patterns = Object.entries(groups)
    .map(([key, g]) => {
      const count = g.pnls.length;
      const conf  = getConfidence(count);
      if (count < MIN_INSIGHT_TRADES || !conf) return null;
      const net = fix2(g.pnls.reduce((s, p) => s + p, 0));
      return {
        key,
        label:      g.label,
        type:       g.type,
        count,
        winRate:    pct(g.wins, count),
        netPnL:     net,
        avgPnL:     fix2(net / count),
        confidence: conf,
      };
    })
    .filter(Boolean)
    .sort((a, b) => Math.abs(b.netPnL) - Math.abs(a.netPnL));

  const positive = patterns.filter(p => p.type === "positive").sort((a, b) => b.winRate - a.winRate);
  const negative = patterns.filter(p => p.type === "negative").sort((a, b) => a.netPnL - b.netPnL);

  return {
    patterns,
    positive,
    negative,
    best:  positive[0] || null,
    worst: negative[0] || null,
  };
}

// ── Module 1: Overview ────────────────────────────────────────────────────────

function scoreForTrades(subset) {
  const applicable = subset.filter(
    t => typeof t.setupScore === "number" || getTrackedRules(t).length > 0
  );
  if (!applicable.length) return null;

  // Prefer setupScore if available; fall back to rule compliance
  const withScore = applicable.filter(t => typeof t.setupScore === "number");
  if (withScore.length > 0) {
    return Number(
      (withScore.reduce((s, t) => s + t.setupScore, 0) / withScore.length).toFixed(1)
    );
  }
  // Pure compliance
  let num = 0, den = 0;
  for (const t of applicable) {
    const rules = getTrackedRules(t);
    num += rules.filter(r => r.followed === true).length;
    den += rules.length;
  }
  return den > 0 ? pct(num, den) : null;
}

function computeOverview(trades, timelineBuckets) {
  const now   = Date.now();
  const MS7   = 7  * 24 * 60 * 60 * 1000;
  const MS30  = 30 * 24 * 60 * 60 * 1000;

  const getTs = t => new Date(t.tradeDate || t.createdAt || 0).getTime();

  const currentScore  = scoreForTrades(trades.filter(t => getTs(t) > now - MS7));
  const weeklyScore   = currentScore;  // same window, alias
  const monthlyScore  = scoreForTrades(trades.filter(t => getTs(t) > now - MS30));
  const allTimeScore  = scoreForTrades(trades);

  const trend = computeTrend(timelineBuckets.map(b => b.disciplineScore));

  const tradesWithRules  = trades.filter(t => getTrackedRules(t).length > 0).length;
  const tradesWithScore  = trades.filter(t => typeof t.setupScore === "number").length;

  return {
    currentScore,
    weeklyScore,
    monthlyScore,
    allTimeScore,
    trend,
    totalTradesWithRules: tradesWithRules,
    totalTradesWithScore: tradesWithScore,
  };
}

// ── Module 9: DNA Integration ──────────────────────────────────────────────────

function computeDNAIntegration(ruleAnalytics, setupData) {
  const qualified = ruleAnalytics.filter(r => r.confidence !== null);

  const strongestRule  = qualified.length
    ? [...qualified].sort((a, b) => (b.compliancePct ?? 0) - (a.compliancePct ?? 0))[0]
    : null;

  const weakestRule    = qualified.length
    ? [...qualified].sort((a, b) => (a.compliancePct ?? 100) - (b.compliancePct ?? 100))[0]
    : null;

  // Most valuable: highest pnlDifference (following >> breaking).
  // Both sides need a real sample — a single broken trade cannot establish a
  // per-trade edge, and pnlDifference is a difference of two averages.
  const valuableCandidates = qualified.filter(
    r => r.timesFollowed >= MIN_INSIGHT_TRADES &&
         r.timesBroken   >= MIN_INSIGHT_TRADES &&
         r.pnlDifference !== null
  );
  const mostValuableRule = valuableCandidates.length
    ? [...valuableCandidates].sort((a, b) => b.pnlDifference - a.pnlDifference)[0]
    : null;

  // Most expensive violation: highest cost of breaking (absolute loss)
  const mostExpensiveViolation = qualified.filter(r => r.timesBroken >= MIN_INSIGHT_TRADES).length
    ? [...qualified.filter(r => r.timesBroken >= MIN_INSIGHT_TRADES)]
        .sort((a, b) => b.costOfBreaking - a.costOfBreaking)[0]
    : null;

  return {
    strongestRule,
    weakestRule,
    mostValuableRule,
    mostExpensiveViolation,
    bestSetup:  setupData.bestSetup,
    worstSetup: setupData.worstSetup,
  };
}

// ── Module 10: Coach Insights ─────────────────────────────────────────────────

function computeCoachInsights(data, currency) {
  const { overview, compliance, ruleAnalytics, setupData, correlation, patterns, dna } = data;
  const sym = currency || "$";
  const fmtAmt = (v) => {
    const abs = Math.abs(v || 0);
    if (abs >= 1000000) return `${sym}${(abs / 1000000).toFixed(1)}M`;
    if (abs >= 1000)    return `${sym}${(abs / 1000).toFixed(1)}K`;
    return `${sym}${abs.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  };
  // fmtAmt is magnitude-only; use this whenever the value can be negative so
  // the sign lands before the currency symbol ("-$94", never "$-94").
  const signedAmt = (v) => `${(v || 0) < 0 ? "-" : ""}${fmtAmt(v)}`;

  const insights = [];

  // 1. Most violated rule by frequency
  const mostViolated = (ruleAnalytics || [])
    .filter(r => r.timesBroken >= MIN_INSIGHT_TRADES && r.confidence !== null)
    .sort((a, b) => b.timesBroken - a.timesBroken)[0];
  if (mostViolated) {
    const wr = mostViolated.winRateBroken !== null ? `${mostViolated.winRateBroken}%` : "N/A";
    insights.push({
      id:             `discipline-violation-freq-${mostViolated.label.replace(/\s+/g, "-").toLowerCase().slice(0, 40)}`,
      type:           "negative",
      priority:       mostViolated.timesBroken >= 10 ? "high" : "medium",
      title:          `"${mostViolated.label}" Broken ${mostViolated.timesBroken} Times`,
      insight:        `You've skipped "${mostViolated.label}" ${mostViolated.timesBroken} times. Those trades produced a ${wr} win rate.`,
      evidence:       `Followed: ${mostViolated.timesFollowed} times (${mostViolated.winRateFollowed ?? "N/A"}% WR) · Broken: ${mostViolated.timesBroken} times (${wr} WR)`,
      recommendation: `Add "${mostViolated.label}" to your pre-trade checklist. Do not enter if this rule is not met.`,
    });
  }

  // 2. Most expensive violation by cost
  if (dna.mostExpensiveViolation && dna.mostExpensiveViolation.label !== mostViolated?.label) {
    const r = dna.mostExpensiveViolation;
    insights.push({
      id:             `discipline-violation-cost-${r.label.replace(/\s+/g, "-").toLowerCase().slice(0, 40)}`,
      type:           "negative",
      priority:       r.costOfBreaking > 1000 ? "high" : "medium",
      title:          `Breaking "${r.label}" Has Cost You ${fmtAmt(r.costOfBreaking)}`,
      insight:        `Violating "${r.label}" ${r.timesBroken} times has generated a total loss of ${fmtAmt(r.costOfBreaking)}.`,
      evidence:       `Net P&L when broken: -${fmtAmt(r.costOfBreaking)} · Win rate when broken: ${r.winRateBroken ?? "N/A"}%`,
      recommendation: `Treat "${r.label}" as a non-negotiable entry condition. Consider it a hard stop before entry.`,
    });
  }

  // 3. Most valuable rule (following it adds value)
  if (dna.mostValuableRule && dna.mostValuableRule.pnlDifference > 0) {
    const r = dna.mostValuableRule;
    insights.push({
      id:             `discipline-valuable-${r.label.replace(/\s+/g, "-").toLowerCase().slice(0, 40)}`,
      type:           "positive",
      priority:       r.pnlDifference > 100 ? "high" : "medium",
      title:          `Following "${r.label}" Adds ${fmtAmt(r.pnlDifference)} Per Trade`,
      insight:        `When you follow "${r.label}", avg P&L is ${signedAmt(r.avgPnLFollowed)} vs ${signedAmt(r.avgPnLBroken)} when broken.`,
      evidence:       `Followed: ${r.timesFollowed} trades · Broken: ${r.timesBroken} trades · WR followed: ${r.winRateFollowed}%`,
      recommendation: `This rule is generating measurable edge. Protect it — never skip it in the name of speed.`,
    });
  }

  // 4. Setup score threshold insight
  const highRange  = correlation.bySetupRange?.find(r => r.range === "80–100" && r.count >= MIN_INSIGHT_TRADES);
  const lowRange   = correlation.bySetupRange?.find(r => r.range === "0–39"  && r.count >= MIN_INSIGHT_TRADES);
  if (highRange && lowRange && highRange.winRate > lowRange.winRate + 20) {
    insights.push({
      id:             "discipline-score-threshold",
      type:           "positive",
      priority:       "high",
      title:          `High Setup Score Trades Win ${highRange.winRate}% vs ${lowRange.winRate}% at Low Scores`,
      insight:        `Trades with setup score 80–100 achieve a ${highRange.winRate}% win rate. Trades below 40 only hit ${lowRange.winRate}%.`,
      evidence:       `High (80–100): ${highRange.count} trades · Low (0–39): ${lowRange.count} trades`,
      recommendation: `Only take entries where your setup score exceeds 70. Your data shows setup quality directly predicts outcomes.`,
    });
  }

  // 5. Best discipline pattern — only an "edge" if it actually made money.
  // The top-ranked pattern is still a losing one when every pattern loses.
  if (patterns.best && patterns.best.count >= MIN_INSIGHT_TRADES && patterns.best.netPnL > 0) {
    const p = patterns.best;
    insights.push({
      id:             `discipline-pattern-best-${p.key}`,
      type:           "positive",
      priority:       "medium",
      title:          `Your Best Pattern: ${p.label}`,
      insight:        `${p.label} produces a ${p.winRate}% win rate across ${p.count} trades.`,
      evidence:       `${p.count} trades · Net P&L: ${signedAmt(p.netPnL)} · Confidence: ${p.confidence}`,
      recommendation: `This is your edge. Seek out trades that match this exact combination.`,
    });
  }

  // 6. Worst discipline pattern
  if (patterns.worst && patterns.worst.count >= MIN_INSIGHT_TRADES) {
    const p = patterns.worst;
    insights.push({
      id:             `discipline-pattern-worst-${p.key}`,
      type:           "negative",
      priority:       "medium",
      title:          `Your Worst Pattern: ${p.label}`,
      insight:        `${p.label} produces only a ${p.winRate}% win rate and is costing you ${fmtAmt(Math.abs(p.netPnL))}.`,
      evidence:       `${p.count} trades · Net P&L: -${fmtAmt(Math.abs(p.netPnL))} · Confidence: ${p.confidence}`,
      recommendation: `Avoid taking trades when this combination is present. Exit the session if you notice these conditions.`,
    });
  }

  // 7. Discipline trend
  if (overview.trend === "improving" && overview.allTimeScore !== null) {
    insights.push({
      id:             "discipline-trend-improving",
      type:           "positive",
      priority:       "low",
      title:          `Your Discipline Score Is Improving`,
      insight:        `Your discipline trend is moving upward — process adherence is becoming more consistent over time.`,
      evidence:       `All-time discipline: ${overview.allTimeScore}% · Recent (7d): ${overview.currentScore ?? "N/A"}%`,
      recommendation: `Keep the streak going. Consistency compounds — sustained discipline creates measurable P&L improvement.`,
    });
  } else if (overview.trend === "declining") {
    insights.push({
      id:             "discipline-trend-declining",
      type:           "negative",
      priority:       "medium",
      title:          `Discipline Score Is Declining`,
      insight:        `Your process adherence has been falling. This often precedes a string of avoidable losses.`,
      evidence:       `All-time: ${overview.allTimeScore ?? "N/A"}% · Recent (7d): ${overview.currentScore ?? "N/A"}%`,
      recommendation: `Review the last 10 trades and identify which rules you've been skipping. Reset before the next session.`,
    });
  }

  // 8. Compliance rate nudge
  if (compliance.compliancePct !== null && compliance.compliancePct < 60 && compliance.totalRulesEvaluated >= 10) {
    insights.push({
      id:             "discipline-low-compliance",
      type:           "negative",
      priority:       "high",
      title:          `Overall Compliance at ${compliance.compliancePct}% — Below Target`,
      insight:        `You followed only ${compliance.compliancePct}% of your setup rules across ${compliance.totalRulesEvaluated} tracked rule evaluations.`,
      evidence:       `Followed: ${compliance.totalRulesFollowed} · Broken: ${compliance.totalRulesBroken} · Total: ${compliance.totalRulesEvaluated}`,
      recommendation: `Work to get compliance above 75%. Start by focusing on the one rule you break most often: "${compliance.mostSkippedRule ?? "—"}".`,
    });
  }

  return insights;
}

// ── Main Export ────────────────────────────────────────────────────────────────

/**
 * @param {object[]} trades     Lean MongoDB documents
 * @param {object}   options
 * @param {string}   options.marketType    "Forex" | "Indian_Market" | "combined"
 * @param {string}   options.period        "daily" | "weekly" | "monthly" (default "monthly")
 * @param {number}   options.offsetHours   timezone offset hours (default 0)
 * @returns {object}
 */
function computeDisciplineAnalytics(inputTrades, { marketType = "Forex", period = "monthly", offsetHours = 0 } = {}) {
// Indian trades store `profit` GROSS with brokerage/sttTaxes alongside, while
// Forex stores it already net of commission/swap (see utils/tradeProfit.js).
// Normalising once here means every helper below can keep reading
// `trade.profit` and get the same (net) number in both markets.
// getNetPnL is a no-op for Forex, so Forex output is unchanged.
  const trades = withNetPnL(inputTrades, marketType);

  if (!Array.isArray(trades) || trades.length === 0) {
    return {
      insufficient: true,
      reason:       "no_trades",
      message:      "No trades found. Start logging trades to see discipline analytics.",
      marketType,
      generatedAt:  new Date().toISOString(),
    };
  }

  const hasDisciplineData = trades.some(
    t => (Array.isArray(t.setupRules) && t.setupRules.length > 0) || typeof t.setupScore === "number"
  );

  if (!hasDisciplineData) {
    return {
      insufficient: true,
      reason:       "no_setup_data",
      message:      "No setup rules or setup scores found. Add setup rules to your trades to unlock discipline analytics.",
      marketType,
      generatedAt:  new Date().toISOString(),
    };
  }

  const currency = marketType === "Indian_Market" ? "₹" : "$";

  // Run all modules
  const compliance                    = computeChecklistCompliance(trades);
  const { ruleAnalytics, topByCost, topByFrequency } = computeRuleAnalytics(trades);
  const setupData                     = computeSetupPerformance(trades);
  const timeline                      = computeDisciplineTimeline(trades, { period, offsetHours });
  const correlation                   = computePsychologyCorrelation(trades);
  const patterns                      = computeDisciplinePatterns(trades);
  const overview                      = computeOverview(trades, timeline.buckets);
  const dna                           = computeDNAIntegration(ruleAnalytics, setupData);

  const coachInsights = computeCoachInsights(
    { overview, compliance, ruleAnalytics, setupData, correlation, patterns, dna },
    currency
  );

  return {
    insufficient: false,
    overview,
    compliance,
    ruleAnalytics,
    ruleCostAnalytics: { topByCost, topByFrequency },
    setupPerformance:  setupData.setupPerformance,
    bestSetup:         setupData.bestSetup,
    worstSetup:        setupData.worstSetup,
    timeline,
    psychologyCorrelation: correlation,
    disciplinePatterns:    patterns,
    dnaIntegration:        dna,
    coachInsights,
    stats: {
      totalTrades:    trades.length,
      tradesWithRules: overview.totalTradesWithRules,
      tradesWithScore: overview.totalTradesWithScore,
      uniqueRules:     ruleAnalytics.length,
      uniqueSetups:    setupData.setupPerformance.length,
      currency,
    },
    marketType,
    period,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  computeDisciplineAnalytics,
  // Exported for testing
  computeChecklistCompliance,
  computeRuleAnalytics,
  computeSetupPerformance,
  computeDisciplineTimeline,
  computePsychologyCorrelation,
  computeDisciplinePatterns,
  computeOverview,
  computeCoachInsights,
  computeDNAIntegration,
  computeTrend,
  getTrackedRules,
};
