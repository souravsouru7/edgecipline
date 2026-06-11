/**
 * Pattern Detection Engine
 *
 * Evidence-based behavioral pattern discovery from trade history.
 * Every insight is backed by actual trade data — zero hallucination.
 *
 * Module 1  — Consecutive Loss Streak Patterns
 * Module 2  — Consecutive Win Streak Patterns
 * Module 3  — Confidence Range Patterns  (Low→1-3, Medium→4-6, High→7-8, Overconfident→9-10)
 * Module 4  — Mood Level Patterns        (1-5)
 * Module 5  — Emotional Tag Patterns     (FOMO, Calm, Revenge, …)
 * Module 6  — Trade Quality Patterns     (Great / Average / Poor self-rating vs system tier)
 * Module 7  — Session Patterns           (Forex: London/NY/Asia | Indian: Opening/Midday/Closing)
 * Module 8  — Day-of-Week Patterns
 * Module 9  — Setup Score Range Patterns (0-40 / 41-60 / 61-80 / 81-100)
 * Module 10 — Rule Violation Cost Patterns
 * Module 11 — Combination Patterns       (multi-factor discovery)
 * Module 12 — Pattern Confidence Engine  (<5=hidden, 5-9=Low, 10-29=Medium, 30+=High)
 * Module 13 — Pattern Ranking System     (significance × impact × frequency)
 * Module 14 — Dashboard Summary          (top positive / negative pattern cards)
 * Module 15 — AI Coach Feed Context      (structured output for Gemini prompt)
 * Module 16 — Trading DNA Enrichment     (best/worst pattern for behavioralDNA)
 */

"use strict";

// ── Constants ─────────────────────────────────────────────────────────────────

const NEGATIVE_EMOTION_TAGS = new Set(["FOMO", "Revenge", "Fear", "Greed", "Frustrated", "Bored"]);
const POSITIVE_EMOTION_TAGS = new Set(["Calm", "Focused", "Patient", "Disciplined"]);

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Confidence string → display range label (schema: "Low"|"Medium"|"High"|"Overconfident")
const CONFIDENCE_RANGE_MAP = {
  Low: "1-3",
  Medium: "4-6",
  High: "7-8",
  Overconfident: "9-10",
};

const SETUP_SCORE_BUCKETS = [
  { label: "0-40",   min: 0,  max: 41  },
  { label: "41-60",  min: 41, max: 61  },
  { label: "61-80",  min: 61, max: 81  },
  { label: "81-100", min: 81, max: 101 },
];

// ── Module 12: Pattern Confidence Engine ──────────────────────────────────────

function getConfidenceLevel(count) {
  if (!count || count < 5) return null;
  if (count < 10) return "Low";
  if (count < 30) return "Medium";
  return "High";
}

// ── Math helpers ──────────────────────────────────────────────────────────────

const fix2 = (n) => Math.round((n || 0) * 100) / 100;
const fix1 = (n) => Math.round((n || 0) * 10) / 10;

function buildStats(trades) {
  if (!trades || trades.length === 0) return null;
  const wins = trades.filter((t) => (t.profit || 0) > 0);
  const losses = trades.filter((t) => (t.profit || 0) < 0);
  const netPnl = trades.reduce((s, t) => s + (t.profit || 0), 0);
  const winRate = (wins.length / trades.length) * 100;
  const confidence = getConfidenceLevel(trades.length);
  if (!confidence) return null; // < 5 trades — do not display
  return {
    count: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: fix1(winRate),
    avgPnl: fix2(netPnl / trades.length),
    netPnl: fix2(netPnl),
    confidence,
  };
}

// Sort trades chronologically (ascending) — used by streak modules
function sortChronological(trades) {
  return [...trades].sort((a, b) => {
    const da = new Date(a.tradeDate || a.createdAt);
    const db = new Date(b.tradeDate || b.createdAt);
    return da - db;
  });
}

// ── Module 1: Consecutive Loss Streak Patterns ────────────────────────────────

function detectLossStreakPatterns(sorted) {
  const buckets = { 1: [], 2: [], 3: [], "4+": [] };
  let streak = 0;

  for (const trade of sorted) {
    // Assign to bucket BEFORE updating the streak
    if (streak >= 1) {
      const key = streak >= 4 ? "4+" : String(streak);
      buckets[key].push(trade);
    }
    // Update streak for the next trade
    if ((trade.profit || 0) < 0) streak++;
    else streak = 0;
  }

  const result = {};
  const statsByKey = {};
  for (const [key, trades] of Object.entries(buckets)) {
    const stats = buildStats(trades);
    if (!stats) continue;
    statsByKey[key] = stats;
    result[key] = stats;
  }

  // Find most impactful loss-streak level (lowest netPnl among visible)
  const visible = Object.entries(statsByKey).sort((a, b) => a[1].netPnl - b[1].netPnl);
  const worstKey = visible[0]?.[0] || null;

  let insight = null;
  if (worstKey) {
    const s = statsByKey[worstKey];
    const label = worstKey === "4+" ? "4+ consecutive losses" : `${worstKey} consecutive loss${worstKey === "1" ? "" : "es"}`;
    insight = `After ${label}: win rate ${s.winRate}%, net P&L ${s.netPnl >= 0 ? "+" : ""}${s.netPnl} (${s.count} trades, ${s.confidence} confidence).`;
  }

  return { after1Loss: result["1"] || null, after2Losses: result["2"] || null, after3Losses: result["3"] || null, after4PlusLosses: result["4+"] || null, worstStreakKey: worstKey, insight };
}

// ── Module 2: Consecutive Win Streak Patterns ─────────────────────────────────

function detectWinStreakPatterns(sorted) {
  const buckets = { 1: [], 2: [], 3: [], "4+": [] };
  let streak = 0;

  for (const trade of sorted) {
    if (streak >= 1) {
      const key = streak >= 4 ? "4+" : String(streak);
      buckets[key].push(trade);
    }
    if ((trade.profit || 0) > 0) streak++;
    else streak = 0;
  }

  const result = {};
  const statsByKey = {};
  for (const [key, trades] of Object.entries(buckets)) {
    const stats = buildStats(trades);
    if (!stats) continue;
    statsByKey[key] = stats;
    result[key] = stats;
  }

  // Detect overconfidence: win rate drops after streaks
  const baseWinRate = sorted.length
    ? (sorted.filter((t) => (t.profit || 0) > 0).length / sorted.length) * 100
    : 0;

  let overconfidenceDetected = false;
  let overconfidenceKey = null;
  for (const [key, stats] of Object.entries(statsByKey)) {
    if (stats.winRate < baseWinRate - 10) {
      overconfidenceDetected = true;
      overconfidenceKey = key;
      break;
    }
  }

  let insight = null;
  if (overconfidenceDetected && overconfidenceKey) {
    const s = statsByKey[overconfidenceKey];
    const label = overconfidenceKey === "4+" ? "4+ consecutive wins" : `${overconfidenceKey} consecutive win${overconfidenceKey === "1" ? "" : "s"}`;
    insight = `After ${label}: win rate drops to ${s.winRate}% (base: ${fix1(baseWinRate)}%) — possible overconfidence pattern.`;
  }

  return { after1Win: result["1"] || null, after2Wins: result["2"] || null, after3Wins: result["3"] || null, after4PlusWins: result["4+"] || null, overconfidenceDetected, overconfidenceKey, insight };
}

// ── Module 3: Confidence Range Patterns ───────────────────────────────────────

function detectConfidencePatterns(trades) {
  const buckets = { "1-3": [], "4-6": [], "7-8": [], "9-10": [] };

  for (const t of trades) {
    const conf = t.confidence;
    if (!conf || !CONFIDENCE_RANGE_MAP[conf]) continue;
    buckets[CONFIDENCE_RANGE_MAP[conf]].push(t);
  }

  const byRange = [];
  for (const [range, bucket] of Object.entries(buckets)) {
    const stats = buildStats(bucket);
    if (!stats) continue;
    byRange.push({ range, ...stats });
  }

  if (byRange.length === 0) return { byRange: [], bestRange: null, worstRange: null, insight: null };

  const sorted = [...byRange].sort((a, b) =>
    b.netPnl !== a.netPnl ? b.netPnl - a.netPnl : a.range.localeCompare(b.range)
  );
  const best = sorted[0];
  const worst = sorted[sorted.length - 1].range !== best.range ? sorted[sorted.length - 1] : null;

  let insight = null;
  if (best) {
    insight = `Confidence range ${best.range} is your sweet spot: ${best.winRate}% win rate, net P&L ${best.netPnl >= 0 ? "+" : ""}${best.netPnl}.`;
    if (worst && worst.netPnl < 0) {
      insight += ` Confidence ${worst.range} is your worst zone: ${worst.winRate}% win rate, net P&L ${worst.netPnl}.`;
    }
  }

  return { byRange, bestRange: best?.range || null, worstRange: worst?.range || null, insight };
}

// ── Module 4: Mood Patterns ───────────────────────────────────────────────────

const MOOD_LABELS = { 1: "Very Stressed", 2: "Anxious", 3: "Neutral", 4: "Good", 5: "Peak" };

function detectMoodPatterns(trades) {
  const buckets = {};

  for (const t of trades) {
    const mood = t.mood;
    if (typeof mood !== "number" || mood < 1 || mood > 5) continue;
    const key = String(Math.round(mood));
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(t);
  }

  const byMood = [];
  for (const [key, bucket] of Object.entries(buckets)) {
    const stats = buildStats(bucket);
    if (!stats) continue;
    byMood.push({ mood: parseInt(key, 10), label: MOOD_LABELS[key] || `Mood ${key}`, ...stats });
  }

  byMood.sort((a, b) => a.mood - b.mood);

  if (byMood.length === 0) return { byMood: [], bestMood: null, worstMood: null, insight: null };

  const sorted = [...byMood].sort((a, b) =>
    b.netPnl !== a.netPnl ? b.netPnl - a.netPnl : a.mood - b.mood
  );
  const best = sorted[0];
  const worst = sorted.length > 1 && sorted[sorted.length - 1].mood !== best.mood ? sorted[sorted.length - 1] : null;

  let insight = null;
  if (best) {
    insight = `You perform best at mood level ${best.mood} (${best.label}): ${best.winRate}% win rate, net P&L ${best.netPnl >= 0 ? "+" : ""}${best.netPnl}.`;
    if (worst) insight += ` Avoid trading at mood ${worst.mood} (${worst.label}): only ${worst.winRate}% win rate.`;
  }

  return { byMood, bestMood: best || null, worstMood: worst || null, insight };
}

// ── Module 5: Emotional Tag Patterns ─────────────────────────────────────────

function detectEmotionPatterns(trades) {
  const buckets = {};

  for (const t of trades) {
    if (!Array.isArray(t.emotionalTags) || t.emotionalTags.length === 0) continue;
    for (const tag of t.emotionalTags) {
      if (!tag) continue;
      if (!buckets[tag]) buckets[tag] = [];
      buckets[tag].push(t);
    }
  }

  const byTag = [];
  for (const [tag, bucket] of Object.entries(buckets)) {
    const stats = buildStats(bucket);
    if (!stats) continue;
    const type = NEGATIVE_EMOTION_TAGS.has(tag)
      ? "negative"
      : POSITIVE_EMOTION_TAGS.has(tag)
      ? "positive"
      : "neutral";
    byTag.push({ tag, type, ...stats });
  }

  const negatives = byTag.filter((t) => t.type === "negative").sort((a, b) => a.netPnl - b.netPnl);
  const positives = byTag.filter((t) => t.type === "positive").sort((a, b) => b.netPnl - a.netPnl);

  const mostDangerous = negatives.find((t) => t.netPnl < 0) || null;
  const mostProfitable = positives.find((t) => t.netPnl > 0) || null;

  let insight = null;
  if (mostDangerous) {
    insight = `${mostDangerous.tag} is your most dangerous emotional state: only ${mostDangerous.winRate}% win rate, net P&L ${mostDangerous.netPnl}.`;
  }
  if (mostProfitable) {
    const suffix = `${mostProfitable.tag} is your most profitable state: ${mostProfitable.winRate}% win rate, net P&L +${mostProfitable.netPnl}.`;
    insight = insight ? `${insight} ${suffix}` : suffix;
  }

  return { byTag, mostDangerous, mostProfitable, insight };
}

// ── Module 6: Trade Quality Patterns ─────────────────────────────────────────

function detectTradeQualityPatterns(trades) {
  const selfRated = { Great: [], Average: [], Poor: [] };
  let overratingCount = 0;
  let underratingCount = 0;

  for (const t of trades) {
    const tq = t.tradeQuality;
    if (tq && selfRated[tq]) selfRated[tq].push(t);

    // Compare self-rating vs system tier (tradeEvaluation result stored inline or computable)
    const systemTier = t._systemTier || null;
    if (tq && systemTier && tq !== systemTier) {
      const selfRank = ["Poor", "Average", "Great"].indexOf(tq);
      const sysRank = ["Poor", "Average", "Great"].indexOf(systemTier);
      if (selfRank > sysRank) overratingCount++;
      else underratingCount++;
    }
  }

  const bySelfRating = {};
  for (const [tier, bucket] of Object.entries(selfRated)) {
    const stats = buildStats(bucket);
    if (!stats) continue;
    bySelfRating[tier] = stats;
  }

  let insight = null;
  const great = bySelfRating.Great;
  const poor = bySelfRating.Poor;
  if (great && poor) {
    if (great.netPnl > 0 && poor.netPnl < 0) {
      insight = `Great-rated trades generate net P&L +${great.netPnl} (${great.winRate}% WR). Poor-rated trades cost ${poor.netPnl} (${poor.winRate}% WR). Self-rating is well-calibrated.`;
    } else if (great.netPnl < poor.netPnl) {
      insight = `Warning: Great-rated trades underperform Poor-rated trades — possible outcome bias in self-rating.`;
    }
  }

  if (overratingCount > 3) {
    insight = (insight ? insight + " " : "") + `You overrate ${overratingCount} trades — system scores them lower than your self-assessment.`;
  }

  return { bySelfRating, overratingCount, underratingCount, insight };
}

// ── Module 7: Session Patterns ────────────────────────────────────────────────

function detectSessionPatterns(trades) {
  const buckets = {};

  for (const t of trades) {
    const session = t.session;
    if (!session) continue;
    if (!buckets[session]) buckets[session] = [];
    buckets[session].push(t);
  }

  const bySessions = [];
  for (const [session, bucket] of Object.entries(buckets)) {
    const stats = buildStats(bucket);
    if (!stats) continue;
    bySessions.push({ session, ...stats });
  }

  if (bySessions.length === 0) return { bySessions: [], bestSession: null, worstSession: null, insight: null };

  const sorted = [...bySessions].sort((a, b) =>
    b.netPnl !== a.netPnl ? b.netPnl - a.netPnl : a.session.localeCompare(b.session)
  );
  const best = sorted[0];
  const worst = sorted.length > 1 && sorted[sorted.length - 1].session !== best.session ? sorted[sorted.length - 1] : null;

  let insight = null;
  if (best) {
    insight = `${best.session} is your strongest session: ${best.winRate}% win rate, net P&L ${best.netPnl >= 0 ? "+" : ""}${best.netPnl}.`;
    if (worst && worst.netPnl < 0) {
      insight += ` ${worst.session} is your weakest session: only ${worst.winRate}% win rate.`;
    }
  }

  return { bySessions, bestSession: best || null, worstSession: worst || null, insight };
}

// ── Module 8: Day-of-Week Patterns ────────────────────────────────────────────

function detectDayOfWeekPatterns(trades) {
  const buckets = {};

  for (const t of trades) {
    const d = new Date(t.tradeDate || t.createdAt);
    if (Number.isNaN(d.getTime())) continue;
    const day = DAY_NAMES[d.getDay()];
    if (!buckets[day]) buckets[day] = [];
    buckets[day].push(t);
  }

  const byDay = [];
  for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]) {
    if (!buckets[day]) continue;
    const stats = buildStats(buckets[day]);
    if (!stats) continue;
    byDay.push({ day, ...stats });
  }

  if (byDay.length === 0) return { byDay: [], bestDay: null, worstDay: null, insight: null };

  const sorted = [...byDay].sort((a, b) =>
    b.netPnl !== a.netPnl ? b.netPnl - a.netPnl : a.day.localeCompare(b.day)
  );
  const best = sorted[0];
  const worst = sorted.length > 1 && sorted[sorted.length - 1].day !== best.day ? sorted[sorted.length - 1] : null;

  let insight = null;
  if (best) {
    insight = `${best.day} is your best trading day: ${best.winRate}% win rate, net P&L ${best.netPnl >= 0 ? "+" : ""}${best.netPnl}.`;
    if (worst && worst.netPnl < 0) {
      insight += ` Avoid trading on ${worst.day}: only ${worst.winRate}% win rate, net P&L ${worst.netPnl}.`;
    }
  }

  return { byDay, bestDay: best || null, worstDay: worst || null, insight };
}

// ── Module 9: Setup Score Range Patterns ─────────────────────────────────────

function detectSetupScorePatterns(trades) {
  const buckets = {};
  for (const b of SETUP_SCORE_BUCKETS) buckets[b.label] = [];

  for (const t of trades) {
    const score = t.setupScore;
    if (typeof score !== "number") continue;
    for (const b of SETUP_SCORE_BUCKETS) {
      if (score >= b.min && score < b.max) {
        buckets[b.label].push(t);
        break;
      }
    }
  }

  const byRange = [];
  for (const b of SETUP_SCORE_BUCKETS) {
    const stats = buildStats(buckets[b.label]);
    if (!stats) continue;
    byRange.push({ range: b.label, ...stats });
  }

  if (byRange.length === 0) return { byRange: [], optimalThreshold: null, worstRange: null, insight: null };

  const sorted = [...byRange].sort((a, b) =>
    b.netPnl !== a.netPnl ? b.netPnl - a.netPnl : a.range.localeCompare(b.range)
  );
  const best = sorted[0];
  const worst = sorted.length > 1 && sorted[sorted.length - 1].range !== best.range ? sorted[sorted.length - 1] : null;

  let insight = null;
  if (best) {
    insight = `Setup score ${best.range} is your optimal range: ${best.winRate}% win rate, net P&L ${best.netPnl >= 0 ? "+" : ""}${best.netPnl}.`;
  }
  if (worst && worst.netPnl < 0) {
    insight = (insight ? insight + " " : "") + `Setup score ${worst.range} consistently hurts performance: net P&L ${worst.netPnl}.`;
  }

  return { byRange, optimalThreshold: best?.range || null, worstRange: worst?.range || null, insight };
}

// ── Module 10: Rule Violation Cost Patterns ───────────────────────────────────

function detectRuleViolationPatterns(trades) {
  // For each rule (by label), collect P&L from trades where that rule was BROKEN
  const violationBuckets = {};
  const violationTrades = {};

  for (const t of trades) {
    if (!Array.isArray(t.setupRules) || t.setupRules.length === 0) continue;
    for (const rule of t.setupRules) {
      if (!rule?.label || rule.followed !== false) continue;
      const label = String(rule.label).trim();
      if (!label) continue;
      if (!violationBuckets[label]) {
        violationBuckets[label] = 0;
        violationTrades[label] = [];
      }
      violationBuckets[label]++;
      violationTrades[label].push(t);
    }
  }

  const byRule = [];
  for (const [rule, bucket] of Object.entries(violationTrades)) {
    if (bucket.length < 5) continue;
    const totalCost = fix2(bucket.reduce((s, t) => s + (t.profit || 0), 0));
    const avgCost = fix2(totalCost / bucket.length);
    const confidence = getConfidenceLevel(bucket.length);
    if (!confidence) continue;
    byRule.push({ rule, brokenCount: bucket.length, totalCost, avgCost, confidence });
  }

  byRule.sort((a, b) =>
    a.totalCost !== b.totalCost ? a.totalCost - b.totalCost : a.rule.localeCompare(b.rule)
  );

  const mostExpensive = byRule.find((r) => r.totalCost < 0) || null;

  let insight = null;
  if (mostExpensive) {
    insight = `Breaking "${mostExpensive.rule}" ${mostExpensive.brokenCount} times has cost you ${mostExpensive.totalCost} (avg ${mostExpensive.avgCost} per violation).`;
  }

  return { byRule, mostExpensiveRule: mostExpensive || null, insight };
}

// ── Module 11: Combination Pattern Detection ──────────────────────────────────

const COMBO_DEFINITIONS = [
  {
    type: "emotion_confidence",
    label: (k) => k.replace("|||", " + Confidence "),
    extract: (t) => {
      const conf = CONFIDENCE_RANGE_MAP[t.confidence];
      if (!conf || !Array.isArray(t.emotionalTags) || t.emotionalTags.length === 0) return [];
      return t.emotionalTags.filter(Boolean).map((tag) => `${tag}|||${conf}`);
    },
  },
  {
    type: "setupScore_session",
    label: (k) => {
      const [range, session] = k.split("|||");
      return `Setup ${range} + ${session}`;
    },
    extract: (t) => {
      const session = t.session;
      if (!session || typeof t.setupScore !== "number") return [];
      for (const b of SETUP_SCORE_BUCKETS) {
        if (t.setupScore >= b.min && t.setupScore < b.max) {
          return [`${b.label}|||${session}`];
        }
      }
      return [];
    },
  },
  {
    type: "mood_emotion",
    label: (k) => {
      const [mood, tag] = k.split("|||");
      return `Mood ${mood} + ${tag}`;
    },
    extract: (t) => {
      if (typeof t.mood !== "number" || t.mood < 1 || t.mood > 5) return [];
      if (!Array.isArray(t.emotionalTags) || t.emotionalTags.length === 0) return [];
      return t.emotionalTags.filter(Boolean).map((tag) => `${Math.round(t.mood)}|||${tag}`);
    },
  },
  {
    type: "entryBasis_confidence",
    label: (k) => {
      const [basis, conf] = k.split("|||");
      return `${basis} Entry + Confidence ${conf}`;
    },
    extract: (t) => {
      const conf = CONFIDENCE_RANGE_MAP[t.confidence];
      if (!conf || !t.entryBasis) return [];
      return [`${t.entryBasis}|||${conf}`];
    },
  },
  {
    type: "emotion_streak",
    label: (k) => {
      const [tag, streak] = k.split("|||");
      return streak === "LossStreak" ? `${tag} + Loss Streak` : `${tag} (No Streak)`;
    },
    extractWithStreakInfo: true,
    extract: (t, prevLossStreak) => {
      if (!Array.isArray(t.emotionalTags) || t.emotionalTags.length === 0) return [];
      const streakState = prevLossStreak >= 2 ? "LossStreak" : "NoStreak";
      return t.emotionalTags.filter(Boolean).map((tag) => `${tag}|||${streakState}`);
    },
  },
];

function detectCombinationPatterns(sorted) {
  // Build streak info for each trade (loss streak count before that trade)
  const prevLossStreaks = new Array(sorted.length).fill(0);
  let runningStreak = 0;
  for (let i = 0; i < sorted.length; i++) {
    prevLossStreaks[i] = runningStreak;
    if ((sorted[i].profit || 0) < 0) runningStreak++;
    else runningStreak = 0;
  }

  // Accumulate combo buckets
  const comboBuckets = {};

  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i];
    const prevStreak = prevLossStreaks[i];

    for (const def of COMBO_DEFINITIONS) {
      let keys;
      if (def.extractWithStreakInfo) {
        keys = def.extract(t, prevStreak);
      } else {
        keys = def.extract(t);
      }

      for (const rawKey of keys) {
        const fullKey = `${def.type}|||${rawKey}`;
        if (!comboBuckets[fullKey]) comboBuckets[fullKey] = { def, rawKey, trades: [] };
        comboBuckets[fullKey].trades.push(t);
      }
    }
  }

  // Build combo list
  const allCombinations = [];
  for (const [, { def, rawKey, trades }] of Object.entries(comboBuckets)) {
    const stats = buildStats(trades);
    if (!stats) continue;
    allCombinations.push({
      type: def.type,
      key: rawKey,
      label: def.label(rawKey),
      ...stats,
    });
  }

  if (allCombinations.length === 0) {
    return { allCombinations: [], topPositive: [], topNegative: [], mostProfitable: null, mostDangerous: null, insight: null };
  }

  // Sort by netPnl for top picks
  const byNetPnl = [...allCombinations].sort((a, b) =>
    b.netPnl !== a.netPnl ? b.netPnl - a.netPnl : a.label.localeCompare(b.label)
  );

  const topPositive = byNetPnl.filter((c) => c.netPnl > 0).slice(0, 5);
  const topNegative = byNetPnl.filter((c) => c.netPnl < 0).reverse().slice(0, 5);

  const mostProfitable = topPositive[0] || null;
  const mostDangerous = topNegative[0] || null;

  let insight = null;
  if (mostProfitable) {
    insight = `Most profitable combination: ${mostProfitable.label} — ${mostProfitable.winRate}% win rate, net P&L +${mostProfitable.netPnl}.`;
  }
  if (mostDangerous) {
    insight = (insight ? insight + " " : "") + `Most dangerous combination: ${mostDangerous.label} — only ${mostDangerous.winRate}% win rate, net P&L ${mostDangerous.netPnl}.`;
  }

  return { allCombinations, topPositive, topNegative, mostProfitable, mostDangerous, insight };
}

// ── Module 13: Pattern Ranking System ────────────────────────────────────────

function rankAllPatterns(modules) {
  // Collect all named patterns from every module as flat entries
  const candidates = [];

  const addCandidate = (name, description, netPnl, winRate, count, confidence, module) => {
    if (!confidence) return; // hidden
    candidates.push({ name, description, netPnl, winRate, count, confidence, module });
  };

  // Streak patterns
  const streakLabels = { "1": "After 1 loss", "2": "After 2 losses", "3": "After 3 losses", "4+": "After 4+ losses" };
  for (const [key, stats] of Object.entries({
    "1": modules.lossStreaks?.after1Loss,
    "2": modules.lossStreaks?.after2Losses,
    "3": modules.lossStreaks?.after3Losses,
    "4+": modules.lossStreaks?.after4PlusLosses,
  })) {
    if (stats) addCandidate(streakLabels[key], `Loss streak: ${streakLabels[key]}`, stats.netPnl, stats.winRate, stats.count, stats.confidence, "lossStreak");
  }

  // Confidence
  for (const r of (modules.confidence?.byRange || [])) {
    addCandidate(`Confidence ${r.range}`, `Confidence range ${r.range}`, r.netPnl, r.winRate, r.count, r.confidence, "confidence");
  }

  // Mood
  for (const m of (modules.mood?.byMood || [])) {
    addCandidate(`Mood ${m.mood} (${m.label})`, `Mood level ${m.mood}`, m.netPnl, m.winRate, m.count, m.confidence, "mood");
  }

  // Emotions
  for (const e of (modules.emotions?.byTag || [])) {
    addCandidate(e.tag, `Emotional tag: ${e.tag}`, e.netPnl, e.winRate, e.count, e.confidence, "emotion");
  }

  // Sessions
  for (const s of (modules.sessions?.bySessions || [])) {
    addCandidate(s.session, `Session: ${s.session}`, s.netPnl, s.winRate, s.count, s.confidence, "session");
  }

  // Day of week
  for (const d of (modules.dayOfWeek?.byDay || [])) {
    addCandidate(d.day, `Day: ${d.day}`, d.netPnl, d.winRate, d.count, d.confidence, "dayOfWeek");
  }

  // Setup score
  for (const r of (modules.setupScore?.byRange || [])) {
    addCandidate(`Setup ${r.range}`, `Setup score range ${r.range}`, r.netPnl, r.winRate, r.count, r.confidence, "setupScore");
  }

  // Combinations
  for (const c of (modules.combinations?.allCombinations || [])) {
    addCandidate(c.label, c.label, c.netPnl, c.winRate, c.count, c.confidence, "combination");
  }

  // Rank by impact (|netPnl| weighted by confidence multiplier) — deterministic
  const confWeight = { Low: 1, Medium: 2, High: 3 };
  const score = (c) => Math.abs(c.netPnl) * (confWeight[c.confidence] || 1);

  candidates.sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));

  const top5Positive = candidates.filter((c) => c.netPnl > 0).slice(0, 5);
  const top5Negative = candidates.filter((c) => c.netPnl < 0).slice(0, 5);

  return { top5Positive, top5Negative };
}

// ── Module 14: Dashboard Summary ─────────────────────────────────────────────

function buildDashboardSummary(modules, rankings) {
  const topPositivePattern = rankings.top5Positive[0] || null;
  const topNegativePattern = rankings.top5Negative[0] || null;

  return {
    topPositivePattern: topPositivePattern
      ? {
          description: topPositivePattern.description,
          netPnl: topPositivePattern.netPnl,
          winRate: topPositivePattern.winRate,
          count: topPositivePattern.count,
          confidence: topPositivePattern.confidence,
          module: topPositivePattern.module,
        }
      : null,
    topNegativePattern: topNegativePattern
      ? {
          description: topNegativePattern.description,
          netPnl: topNegativePattern.netPnl,
          winRate: topNegativePattern.winRate,
          count: topNegativePattern.count,
          confidence: topNegativePattern.confidence,
          module: topNegativePattern.module,
        }
      : null,
    mostDangerousEmotion: modules.emotions?.mostDangerous || null,
    mostProfitableEmotion: modules.emotions?.mostProfitable || null,
    bestSession: modules.sessions?.bestSession || null,
    worstSession: modules.sessions?.worstSession || null,
    bestDay: modules.dayOfWeek?.bestDay || null,
    worstDay: modules.dayOfWeek?.worstDay || null,
    mostDangerousCombination: modules.combinations?.mostDangerous || null,
    mostProfitableCombination: modules.combinations?.mostProfitable || null,
  };
}

// ── Module 15: AI Coach Feed Context ─────────────────────────────────────────

function buildAICoachContext(modules, rankings) {
  const formatPattern = (p) =>
    p ? { description: p.description || p.name || p.label, netPnl: p.netPnl, winRate: p.winRate, count: p.count, confidence: p.confidence } : null;

  return {
    patterns: {
      positive: rankings.top5Positive.map(formatPattern),
      negative: rankings.top5Negative.map(formatPattern),
      confidence: modules.confidence?.byRange?.map((r) => ({
        range: r.range, winRate: r.winRate, netPnl: r.netPnl, count: r.count, confidence: r.confidence,
      })) || [],
      session: modules.sessions?.bySessions?.map((s) => ({
        session: s.session, winRate: s.winRate, netPnl: s.netPnl, count: s.count, confidence: s.confidence,
      })) || [],
      emotion: modules.emotions?.byTag?.map((e) => ({
        tag: e.tag, type: e.type, winRate: e.winRate, netPnl: e.netPnl, count: e.count, confidence: e.confidence,
      })) || [],
      lossStreakImpact: (() => {
        const ls = modules.lossStreaks;
        if (!ls) return null;
        const worst = [ls.after2Losses, ls.after3Losses, ls.after4PlusLosses].find((s) => s && s.confidence);
        return worst ? { label: "After consecutive losses", winRate: worst.winRate, netPnl: worst.netPnl, count: worst.count } : null;
      })(),
      topCombination: modules.combinations?.mostDangerous
        ? { label: modules.combinations.mostDangerous.label, winRate: modules.combinations.mostDangerous.winRate, netPnl: modules.combinations.mostDangerous.netPnl }
        : null,
    },
  };
}

// ── Module 16: Trading DNA Enrichment ────────────────────────────────────────

function buildDNAEnrichment(modules) {
  return {
    bestPattern: modules.combinations?.mostProfitable
      ? {
          label: modules.combinations.mostProfitable.label,
          netPnl: modules.combinations.mostProfitable.netPnl,
          winRate: modules.combinations.mostProfitable.winRate,
          confidence: modules.combinations.mostProfitable.confidence,
        }
      : null,
    worstPattern: modules.combinations?.mostDangerous
      ? {
          label: modules.combinations.mostDangerous.label,
          netPnl: modules.combinations.mostDangerous.netPnl,
          winRate: modules.combinations.mostDangerous.winRate,
          confidence: modules.combinations.mostDangerous.confidence,
        }
      : null,
    lossStreakWarning: modules.lossStreaks?.insight || null,
    winStreakWarning: modules.winStreaks?.overconfidenceDetected ? modules.winStreaks.insight : null,
  };
}

// ── Main Export ───────────────────────────────────────────────────────────────

/**
 * computePatternDetection
 *
 * @param {object[]} trades     Lean MongoDB documents (Forex or Indian).
 * @param {string}   marketType "Forex" | "Indian_Market"
 * @returns {object} Full pattern detection payload.
 */
function computePatternDetection(trades, marketType = "Forex") {
  if (!Array.isArray(trades) || trades.length === 0) {
    return {
      marketType,
      totalTrades: 0,
      insufficient: true,
      message: "No trades available. Start logging trades to discover your patterns.",
      lossStreaks: null, winStreaks: null, confidence: null, mood: null, emotions: null,
      tradeQuality: null, sessions: null, dayOfWeek: null, setupScore: null,
      ruleViolations: null, combinations: null, rankings: { top5Positive: [], top5Negative: [] },
      summary: null, aiContext: null, dnaEnrichment: null,
    };
  }

  if (trades.length < 5) {
    return {
      marketType,
      totalTrades: trades.length,
      insufficient: true,
      message: "Not enough data. Log at least 5 trades to start discovering patterns.",
      lossStreaks: null, winStreaks: null, confidence: null, mood: null, emotions: null,
      tradeQuality: null, sessions: null, dayOfWeek: null, setupScore: null,
      ruleViolations: null, combinations: null, rankings: { top5Positive: [], top5Negative: [] },
      summary: null, aiContext: null, dnaEnrichment: null,
    };
  }

  // Sort once and reuse
  const sorted = sortChronological(trades);

  const lossStreaks = detectLossStreakPatterns(sorted);
  const winStreaks  = detectWinStreakPatterns(sorted);
  const confidence  = detectConfidencePatterns(sorted);
  const mood        = detectMoodPatterns(sorted);
  const emotions    = detectEmotionPatterns(sorted);
  const tradeQuality = detectTradeQualityPatterns(sorted);
  const sessions    = detectSessionPatterns(sorted);
  const dayOfWeek   = detectDayOfWeekPatterns(sorted);
  const setupScore  = detectSetupScorePatterns(sorted);
  const ruleViolations = detectRuleViolationPatterns(sorted);
  const combinations = detectCombinationPatterns(sorted);

  const modules = { lossStreaks, winStreaks, confidence, mood, emotions, tradeQuality, sessions, dayOfWeek, setupScore, ruleViolations, combinations };

  const rankings    = rankAllPatterns(modules);
  const summary     = buildDashboardSummary(modules, rankings);
  const aiContext   = buildAICoachContext(modules, rankings);
  const dnaEnrichment = buildDNAEnrichment(modules);

  return {
    marketType,
    totalTrades: trades.length,
    insufficient: false,
    analyzedAt: new Date().toISOString(),
    lossStreaks,
    winStreaks,
    confidence,
    mood,
    emotions,
    tradeQuality,
    sessions,
    dayOfWeek,
    setupScore,
    ruleViolations,
    combinations,
    rankings,
    summary,
    aiContext,
    dnaEnrichment,
  };
}

module.exports = { computePatternDetection, getConfidenceLevel };
