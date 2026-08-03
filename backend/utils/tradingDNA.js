/**
 * Trading DNA Engine
 *
 * Discovers behavioral and performance patterns from actual trade history.
 * Every insight is evidence-backed and tagged with a confidence level.
 *
 * Module 1  — Forex DNA:        session, pair, day
 * Module 2  — Indian Market DNA: instrument type, trading style, day
 * Module 3  — Psychology DNA:   mood, confidence, emotion, mistake
 * Module 4  — Discipline DNA:   rules, setup score ranges
 * Module 5  — Self-Awareness DNA: score, profile, bias detection
 * Module 6  — Behavioral DNA:   winning/losing patterns
 * Module 7  — DNA Summary:      trading identity narrative
 * Module 10 — Confidence Levels: <5=null, 5-9=Low, 10-29=Medium, 30+=High
 */

// ── Constants ──────────────────────────────────────────────────────────────────

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const MOOD_LABELS = {
  1: "Stressed (1)", 2: "Anxious (2)", 3: "Neutral (3)", 4: "Good (4)", 5: "Peak (5)",
};

const CONFIDENCE_ORDER = ["Low", "Medium", "High", "Overconfident"];

// ── Module 10: Confidence Level ────────────────────────────────────────────────

/**
 * Returns data confidence level for an insight based on sample count.
 * null  → < 5 trades  (do not display)
 * "Low" → 5-9 trades
 * "Medium" → 10-29 trades
 * "High" → 30+ trades
 */
function getConfidence(count) {
  if (!count || count < 5) return null;
  if (count < 10) return "Low";
  if (count < 30) return "Medium";
  return "High";
}

// ── Math helpers ───────────────────────────────────────────────────────────────

const { calculateBucketStats, percent, round } = require("./metricEngine");
const { withLabels } = require("./setupScoreBuckets");

const pct = percent;
const fix2 = round;

function bucketStats(pnls) {
  const stats = calculateBucketStats(pnls);
  return { ...stats, trades: stats.count };
}

// Build a flat insight list from a { key → pnl[] } map.
// Excludes groups with < 5 trades (confidence = null).
function buildInsightList(map, nameFn = (k) => k) {
  return Object.entries(map)
    .map(([key, pnls]) => ({
      name: nameFn(key),
      ...bucketStats(pnls),
      confidence: getConfidence(pnls.length),
    }))
    .filter((e) => e.confidence !== null);
}

// Deterministic best / worst selection: primary sort netPnL desc, tie-break alphabetical.
function pickBestWorst(list) {
  if (list.length === 0) return { best: null, worst: null, all: list };

  const sorted = [...list].sort((a, b) =>
    b.netPnL !== a.netPnL ? b.netPnL - a.netPnL : (a.name || "").localeCompare(b.name || "")
  );

  const best = sorted[0];
  const worst = sorted[sorted.length - 1];

  return {
    best,
    worst: worst.name !== best.name ? worst : null,
    all: list,
  };
}

// pickBestWorst returns a pure arg-max, which is still a losing bucket when
// every bucket loses money. Any claim that frames a condition as a strength
// must go through this first. Mirrors the guard already used by
// computeEmotionDNA / computeMistakeDNA.
const profitableOnly = (entry) => (entry && entry.netPnL > 0 ? entry : null);

// ── Module 1: Forex DNA ────────────────────────────────────────────────────────

function computeForexSessionDNA(trades) {
  const map = {};
  for (const t of trades) {
    const session = t.session || null;
    if (!session) continue;
    if (!map[session]) map[session] = [];
    map[session].push(t.profit || 0);
  }
  return pickBestWorst(buildInsightList(map));
}

function computePairDNA(trades) {
  const map = {};
  for (const t of trades) {
    const pair = t.pair || null;
    if (!pair) continue;
    if (!map[pair]) map[pair] = [];
    map[pair].push(t.profit || 0);
  }
  return pickBestWorst(buildInsightList(map));
}

// ── Module 2: Indian Market DNA ────────────────────────────────────────────────

function deriveIndianInstrumentType(trade) {
  const seg = (trade.segment || "").toUpperCase();
  const opt = (trade.optionType || "").toUpperCase();
  if (seg === "EQUITY") return "Equity";
  if (seg === "F&O") {
    if (opt === "CE") return "Options Buying";
    if (opt === "PE") return "Options Selling";
    return "Futures";
  }
  return null;
}

function computeIndianInstrumentDNA(trades) {
  const map = {};
  for (const t of trades) {
    const inst = deriveIndianInstrumentType(t);
    if (!inst) continue;
    if (!map[inst]) map[inst] = [];
    map[inst].push(t.profit || 0);
  }
  return pickBestWorst(buildInsightList(map));
}

function computeStyleDNA(trades) {
  const map = {};
  for (const t of trades) {
    const style = t.tradeType || null; // INTRADAY / DELIVERY / SWING
    if (!style) continue;
    if (!map[style]) map[style] = [];
    map[style].push(t.profit || 0);
  }
  return pickBestWorst(buildInsightList(map));
}

// ── Day DNA (both markets) ─────────────────────────────────────────────────────

function computeDayDNA(trades) {
  const map = {};
  for (const t of trades) {
    const d = new Date(t.tradeDate || t.createdAt);
    if (Number.isNaN(d.getTime())) continue;
    const day = DAY_NAMES[d.getDay()];
    if (!map[day]) map[day] = [];
    map[day].push(t.profit || 0);
  }
  return pickBestWorst(buildInsightList(map));
}

// ── Module 3: Psychology DNA ───────────────────────────────────────────────────

function computeMoodDNA(trades) {
  const map = {};
  for (const t of trades) {
    const mood = t.mood;
    if (typeof mood !== "number" || mood < 1 || mood > 5) continue;
    const key = String(mood);
    if (!map[key]) map[key] = [];
    map[key].push(t.profit || 0);
  }

  const eligible = Object.entries(map).filter(([, pnls]) => getConfidence(pnls.length) !== null);
  if (eligible.length === 0) return { best: null, worst: null, all: [] };

  const list = eligible
    .map(([key, pnls]) => ({
      mood: parseInt(key),
      name: MOOD_LABELS[key] || `Mood ${key}`,
      ...bucketStats(pnls),
      confidence: getConfidence(pnls.length),
    }))
    .sort((a, b) => a.mood - b.mood);

  const sorted = [...list].sort((a, b) =>
    b.netPnL !== a.netPnL ? b.netPnL - a.netPnL : a.mood - b.mood
  );

  return {
    best: sorted[0],
    worst: sorted.length > 1 && sorted[sorted.length - 1].mood !== sorted[0].mood
      ? sorted[sorted.length - 1]
      : null,
    all: list,
  };
}

function computeConfidenceDNA(trades) {
  const map = {};
  for (const t of trades) {
    const conf = t.confidence;
    if (!conf || !CONFIDENCE_ORDER.includes(conf)) continue;
    if (!map[conf]) map[conf] = [];
    map[conf].push(t.profit || 0);
  }

  const list = CONFIDENCE_ORDER.filter((c) => map[c] && getConfidence(map[c].length) !== null).map(
    (c) => ({
      name: c,
      ...bucketStats(map[c]),
      confidence: getConfidence(map[c].length),
    })
  );

  if (list.length === 0) return { best: null, worst: null, all: [] };

  const sorted = [...list].sort((a, b) =>
    b.netPnL !== a.netPnL
      ? b.netPnL - a.netPnL
      : CONFIDENCE_ORDER.indexOf(a.name) - CONFIDENCE_ORDER.indexOf(b.name)
  );

  return {
    best: sorted[0],
    worst: sorted.length > 1 && sorted[sorted.length - 1].name !== sorted[0].name
      ? sorted[sorted.length - 1]
      : null,
    all: list,
  };
}

function computeEmotionDNA(trades) {
  const map = {};
  for (const t of trades) {
    if (!Array.isArray(t.emotionalTags) || t.emotionalTags.length === 0) continue;
    for (const tag of t.emotionalTags) {
      if (!tag) continue;
      if (!map[tag]) map[tag] = [];
      map[tag].push(t.profit || 0);
    }
  }

  const list = buildInsightList(map).sort((a, b) =>
    b.netPnL !== a.netPnL ? b.netPnL - a.netPnL : a.name.localeCompare(b.name)
  );

  const mostProfitable =
    [...list].sort((a, b) => b.netPnL - a.netPnL || a.name.localeCompare(b.name))[0] || null;
  const mostExpensive =
    [...list].sort((a, b) => a.netPnL - b.netPnL || a.name.localeCompare(b.name))[0] || null;

  return {
    mostProfitable: mostProfitable?.netPnL > 0 ? mostProfitable : null,
    mostExpensive: mostExpensive?.netPnL < 0 ? mostExpensive : null,
    all: list,
  };
}

function computeMistakeDNA(trades) {
  const map = {};
  for (const t of trades) {
    const tag = t.mistakeTag;
    if (!tag) continue;
    if (!map[tag]) map[tag] = [];
    map[tag].push(t.profit || 0);
  }

  const list = buildInsightList(map).sort((a, b) =>
    a.netPnL !== b.netPnL ? a.netPnL - b.netPnL : a.name.localeCompare(b.name)
  );

  const mostExpensive =
    [...list].sort((a, b) => a.netPnL - b.netPnL || a.name.localeCompare(b.name))[0] || null;

  return {
    mostExpensive: mostExpensive?.netPnL < 0 ? mostExpensive : null,
    all: list,
  };
}

// ── Module 4: Discipline DNA ───────────────────────────────────────────────────

// Shared boundaries, DNA-specific wording (see utils/setupScoreBuckets.js)
const SETUP_SCORE_RANGES = withLabels({
  poor:    "0–39 (Poor)",
  low:     "40–59 (Below Avg)",
  average: "60–79 (Average)",
  strong:  "80–100 (Strong)",
});

function computeSetupScoreDNA(trades) {
  const buckets = {};
  for (const r of SETUP_SCORE_RANGES) buckets[r.label] = [];

  let sum = 0, count = 0;
  for (const t of trades) {
    const score = t.setupScore;
    if (typeof score !== "number") continue;
    sum += score;
    count++;
    for (const r of SETUP_SCORE_RANGES) {
      if (score >= r.min && score < r.max) {
        buckets[r.label].push(t.profit || 0);
        break;
      }
    }
  }

  const avgSetupScore = count > 0 ? Number((sum / count).toFixed(1)) : null;

  const list = SETUP_SCORE_RANGES.filter((r) => buckets[r.label].length > 0)
    .map((r) => ({
      name: r.label,
      ...bucketStats(buckets[r.label]),
      confidence: getConfidence(buckets[r.label].length),
    }))
    .filter((e) => e.confidence !== null);

  const sorted = [...list].sort((a, b) =>
    b.netPnL !== a.netPnL ? b.netPnL - a.netPnL : a.name.localeCompare(b.name)
  );

  return {
    bestRange: sorted[0] || null,
    worstRange: sorted.length > 1 ? sorted[sorted.length - 1] : null,
    avgSetupScore,
    all: list,
  };
}

function computeRuleDNA(trades) {
  const followed = {};
  const broken = {};

  for (const t of trades) {
    if (!Array.isArray(t.setupRules) || t.setupRules.length === 0) continue;
    for (const rule of t.setupRules) {
      if (!rule?.label) continue;
      const label = String(rule.label).trim();
      if (!label) continue;
      if (rule.followed === true) {
        followed[label] = (followed[label] || 0) + 1;
      } else if (rule.followed === false) {
        broken[label] = (broken[label] || 0) + 1;
      }
    }
  }

  const allRuleLabels = new Set([...Object.keys(followed), ...Object.keys(broken)]);
  const ruleStats = [];

  for (const label of allRuleLabels) {
    const f = followed[label] || 0;
    const b = broken[label] || 0;
    const total = f + b;
    if (total < 5) continue;
    ruleStats.push({
      name: label,
      followedCount: f,
      brokenCount: b,
      total,
      followRate: pct(f, total),
      confidence: getConfidence(total),
    });
  }

  const sorted = [...ruleStats].sort((a, b) =>
    b.followRate !== a.followRate ? b.followRate - a.followRate : a.name.localeCompare(b.name)
  );

  // Average discipline score: fraction of rules followed per trade
  let disciplineSum = 0, disciplineCount = 0;
  for (const t of trades) {
    if (!Array.isArray(t.setupRules) || t.setupRules.length === 0) continue;
    const valid = t.setupRules.filter(
      (r) => r?.label && (r.followed === true || r.followed === false)
    );
    if (valid.length === 0) continue;
    disciplineSum += valid.filter((r) => r.followed === true).length / valid.length;
    disciplineCount++;
  }
  const avgDisciplineScore =
    disciplineCount > 0 ? Number(((disciplineSum / disciplineCount) * 100).toFixed(1)) : null;

  return {
    strongestRule: sorted[0] || null,
    weakestRule: ruleStats.length > 0 ? sorted[sorted.length - 1] : null,
    avgDisciplineScore,
    all: ruleStats,
  };
}

// ── Module 5: Self-Awareness DNA ───────────────────────────────────────────────

function computeSelfAwarenessDNA(selfAwarenessResult) {
  const {
    score,
    trackedCount,
    bestJudgedCategory,
    worstJudgedCategory,
    overconfident = 0,
    underconfident = 0,
    perCategory,
    breakdown = [],
  } = selfAwarenessResult || {};

  if (!trackedCount || trackedCount < 5) return null;

  const dataConfidence = getConfidence(trackedCount);

  let profile = null;
  if (score !== null && score !== undefined) {
    if (score >= 80) profile = "Highly Self-Aware";
    else if (score >= 60) profile = "Well Calibrated";
    else if (score >= 40) profile = "Developing Awareness";
    else profile = "Needs Calibration";
  }

  const biases = [];

  if (overconfident >= 3 && perCategory?.Great?.total >= 5) {
    const overPct = Math.round((overconfident / perCategory.Great.total) * 100);
    biases.push({
      type: "Overconfidence Bias",
      description: `You rate ${overPct}% of your Great-rated trades above what execution data supports.`,
      confidence: getConfidence(perCategory.Great.total),
    });
  }

  if (underconfident >= 3 && perCategory?.Poor?.total >= 5) {
    const underPct = Math.round((underconfident / perCategory.Poor.total) * 100);
    biases.push({
      type: "Underconfidence Bias",
      description: `You underestimate ${underPct}% of Poor-rated trades — execution was better than you believed.`,
      confidence: getConfidence(perCategory.Poor.total),
    });
  }

  // Outcome bias: rated Great but system says Poor AND trade was a winner
  const outcomeBiasTrades = breakdown.filter(
    (e) => e.selfRating === "Great" && e.systemTier === "Poor" && e.pnl > 0
  ).length;
  if (outcomeBiasTrades >= 2) {
    biases.push({
      type: "Outcome Bias",
      description: `${outcomeBiasTrades} winning trades rated Great despite poor execution — P&L outcome is inflating your self-assessment.`,
      confidence: getConfidence(outcomeBiasTrades),
    });
  }

  return {
    score: score ?? null,
    profile,
    bestJudgedCategory: bestJudgedCategory ?? null,
    worstJudgedCategory: worstJudgedCategory ?? null,
    biases: biases.filter((b) => b.confidence !== null),
    confidence: dataConfidence,
    trackedCount,
  };
}

// ── Module 6: Behavioral DNA ───────────────────────────────────────────────────

function computeBehavioralPatternDNA(trades) {
  if (trades.length < 5) {
    return {
      winningPattern: null,
      losingPattern: null,
      mostProfitableCombination: null,
      mostDangerousCombination: null,
    };
  }

  // 2-factor combination: primaryEmotion × confidence
  const combos = {};
  for (const t of trades) {
    const emotion = (t.emotionalTags?.[0]) || "None";
    const conf = t.confidence || "Unknown";
    const key = `${emotion}|||${conf}`;
    if (!combos[key]) combos[key] = [];
    combos[key].push(t.profit || 0);
  }

  const comboList = Object.entries(combos)
    .filter(([, pnls]) => getConfidence(pnls.length) !== null)
    .map(([key, pnls]) => {
      const [emotion, conf] = key.split("|||");
      const stats = bucketStats(pnls);
      return {
        conditions: { emotion, confidence: conf },
        conditionLabel: conf === "Unknown"
          ? emotion
          : `${emotion} + ${conf} Confidence`,
        ...stats,
        confidence: getConfidence(pnls.length),
      };
    });

  if (comboList.length === 0) {
    return {
      winningPattern: null,
      losingPattern: null,
      mostProfitableCombination: null,
      mostDangerousCombination: null,
    };
  }

  // Winning pattern: highest win rate (primary), most trades (secondary), alphabetical (tertiary)
  const byWinRate = [...comboList].sort(
    (a, b) =>
      b.winRate !== a.winRate
        ? b.winRate - a.winRate
        : b.trades !== a.trades
        ? b.trades - a.trades
        : a.conditionLabel.localeCompare(b.conditionLabel)
  );

  const winningPattern = byWinRate[0] || null;

  // Losing pattern: lowest win rate, must be different from winning
  const losingPattern =
    byWinRate.filter((c) => c.conditionLabel !== winningPattern?.conditionLabel).at(-1) || null;

  // Most profitable: highest netPnL
  const byPnL = [...comboList].sort(
    (a, b) =>
      b.netPnL !== a.netPnL ? b.netPnL - a.netPnL : a.conditionLabel.localeCompare(b.conditionLabel)
  );
  const mostProfitableCombination = byPnL[0] || null;

  // Most dangerous: lowest netPnL (only if negative)
  const dangerousCandidate = byPnL[byPnL.length - 1];
  const mostDangerousCombination =
    dangerousCandidate?.netPnL < 0 &&
    dangerousCandidate.conditionLabel !== mostProfitableCombination?.conditionLabel
      ? dangerousCandidate
      : null;

  return { winningPattern, losingPattern, mostProfitableCombination, mostDangerousCombination };
}

// ── Module 7: DNA Summary ──────────────────────────────────────────────────────

function buildDNASummary(dna, totalTrades, marketType) {
  const confidence = getConfidence(totalTrades);
  if (!confidence) return null;

  const isIndian = marketType === "Indian_Market";
  const strengths = [];
  const weaknesses = [];

  // Identity — only claim an edge on conditions that actually made money
  const bestSession    = profitableOnly(dna.sessionDNA?.best);
  const bestStyle      = profitableOnly(dna.styleDNA?.best);
  const bestInstrument = profitableOnly(dna.instrumentDNA?.best);

  const identityParts = [];
  if (!isIndian && bestSession) {
    identityParts.push(`${bestSession.name} session trader`);
  } else if (bestStyle) {
    identityParts.push(`${bestStyle.name.toLowerCase()} trader`);
  }
  if (!isIndian && bestInstrument) {
    identityParts.push(`with edge on ${bestInstrument.name}`);
  } else if (isIndian && bestInstrument) {
    identityParts.push(`specialising in ${bestInstrument.name}`);
  }

  const identity =
    identityParts.length > 0
      ? `You are a ${identityParts.join(" ")}. `
      : "You are a systematic trader with a developing edge. ";

  // What makes them profitable
  const bestMood       = profitableOnly(dna.moodDNA?.best);
  const bestConfidence = profitableOnly(dna.confidenceDNA?.best);
  const bestDay        = profitableOnly(dna.dayDNA?.best);
  if (bestMood) strengths.push(bestMood.name);
  if (dna.emotionDNA?.mostProfitable) strengths.push(dna.emotionDNA.mostProfitable.name);
  if (bestConfidence) strengths.push(`${bestConfidence.name.toLowerCase()} confidence`);
  if (bestDay) strengths.push(`${bestDay.name}`);

  // What makes them lose
  if (dna.emotionDNA?.mostExpensive) weaknesses.push(`trading with ${dna.emotionDNA.mostExpensive.name}`);
  if (dna.mistakeDNA?.mostExpensive) weaknesses.push(dna.mistakeDNA.mostExpensive.name);
  if (dna.behavioralDNA?.losingPattern) {
    const { emotion, confidence: conf } = dna.behavioralDNA.losingPattern.conditions;
    if (emotion && emotion !== "None") weaknesses.push(`${emotion} + ${conf} entries`);
  }
  if (dna.dayDNA?.worst) weaknesses.push(`${dna.dayDNA.worst.name} trading`);

  // Distinguish "nothing measured yet" (no bucket cleared the sample floor)
  // from "measured, and none of it is profitable" — they need different copy.
  const anyMeasured = [
    dna.sessionDNA?.best, dna.styleDNA?.best, dna.instrumentDNA?.best,
    dna.moodDNA?.best, dna.confidenceDNA?.best, dna.dayDNA?.best,
  ].some(Boolean);

  const profitLine =
    strengths.length > 0
      ? `You perform best when trading in a ${strengths.slice(0, 2).join(" or ")} state.`
      : anyMeasured
      ? "No tracked condition is net profitable yet, so there is no repeatable edge to lean on."
      : "";

  const lossLine =
    weaknesses.length > 0
      ? `Most losses occur when ${weaknesses.slice(0, 2).join(" or ")}.`
      : "";

  const tradingIdentity = [identity + profitLine, lossLine].filter(Boolean).join(" ");

  return {
    tradingIdentity,
    keyStrengths: strengths.slice(0, 3),
    keyWeaknesses: weaknesses.slice(0, 3),
    dataConfidence: confidence,
    totalTrades,
  };
}

// ── Main Export ────────────────────────────────────────────────────────────────

/**
 * computeTradingDNA
 *
 * @param {object[]} trades             Lean MongoDB documents.
 * @param {string}   marketType         "Forex" | "Indian_Market"
 * @param {object|null} selfAwarenessResult  Output of computeSelfAwarenessAnalytics()
 * @returns {object} Full Trading DNA payload.
 */
function computeTradingDNA(trades, marketType = "Forex", selfAwarenessResult = null) {
  const isIndian = marketType === "Indian_Market";
  const totalTrades = Array.isArray(trades) ? trades.length : 0;

  const EMPTY = {
    totalTrades,
    marketType,
    insufficient: true,
    sessionDNA: null,
    instrumentDNA: null,
    styleDNA: null,
    dayDNA: null,
    moodDNA: null,
    confidenceDNA: null,
    emotionDNA: null,
    mistakeDNA: null,
    disciplineDNA: null,
    selfAwarenessDNA: null,
    behavioralDNA: null,
    dnaSummary: null,
  };

  if (!Array.isArray(trades) || trades.length < 5) return EMPTY;

  // Market-specific
  const sessionDNA = isIndian ? null : computeForexSessionDNA(trades);
  const instrumentDNA = isIndian ? computeIndianInstrumentDNA(trades) : computePairDNA(trades);
  const styleDNA = isIndian ? computeStyleDNA(trades) : null;

  // Universal
  const dayDNA = computeDayDNA(trades);
  const moodDNA = computeMoodDNA(trades);
  const confidenceDNA = computeConfidenceDNA(trades);
  const emotionDNA = computeEmotionDNA(trades);
  const mistakeDNA = computeMistakeDNA(trades);

  // Discipline
  const setupScoreDNA = computeSetupScoreDNA(trades);
  const ruleDNA = computeRuleDNA(trades);
  const disciplineDNA = {
    strongestRule: ruleDNA.strongestRule,
    weakestRule: ruleDNA.weakestRule,
    bestSetupRange: setupScoreDNA.bestRange,
    worstSetupRange: setupScoreDNA.worstRange,
    avgSetupScore: setupScoreDNA.avgSetupScore,
    avgDisciplineScore: ruleDNA.avgDisciplineScore,
    allRules: ruleDNA.all,
    allSetupRanges: setupScoreDNA.all,
  };

  // Self-awareness
  const selfAwarenessDNA = computeSelfAwarenessDNA(selfAwarenessResult);

  // Behavioral patterns
  const behavioralDNA = computeBehavioralPatternDNA(trades);

  const dna = {
    sessionDNA,
    instrumentDNA,
    styleDNA,
    dayDNA,
    moodDNA,
    confidenceDNA,
    emotionDNA,
    mistakeDNA,
    disciplineDNA,
    selfAwarenessDNA,
    behavioralDNA,
  };

  const dnaSummary = buildDNASummary(dna, totalTrades, marketType);

  return {
    totalTrades,
    marketType,
    insufficient: false,
    ...dna,
    dnaSummary,
  };
}

// ── Pattern Detection Enrichment ───────────────────────────────────────────────

/**
 * Enriches a Trading DNA result with pattern detection findings.
 * Called after computeTradingDNA when a patternDetection result is available.
 *
 * @param {object} dnaResult      Output of computeTradingDNA()
 * @param {object} patternResult  Output of computePatternDetection()
 * @returns {object} Merged result with patternEnrichment field added
 */
function enrichTradingDNAWithPatterns(dnaResult, patternResult) {
  if (!dnaResult || !patternResult || patternResult.insufficient) return dnaResult;

  const pd = patternResult;

  // Replace behavioralDNA combinations with richer pattern data if available
  const enrichedBehavioralDNA = {
    ...(dnaResult.behavioralDNA || {}),
    mostProfitableCombination: pd.combinations?.mostProfitable || dnaResult.behavioralDNA?.mostProfitableCombination || null,
    mostDangerousCombination: pd.combinations?.mostDangerous || dnaResult.behavioralDNA?.mostDangerousCombination || null,
    topPositiveCombinations: pd.combinations?.topPositive?.slice(0, 3) || [],
    topNegativeCombinations: pd.combinations?.topNegative?.slice(0, 3) || [],
    lossStreakEffect: pd.lossStreaks?.after2Losses || pd.lossStreaks?.after3Losses || null,
    overconfidenceRisk: pd.winStreaks?.overconfidenceDetected ? {
      afterStreak: pd.winStreaks.overconfidenceKey,
      insight: pd.winStreaks.insight,
    } : null,
  };

  // Build enriched DNA summary incorporating pattern findings
  const patternEnrichment = {
    bestPattern: pd.dnaEnrichment?.bestPattern || null,
    worstPattern: pd.dnaEnrichment?.worstPattern || null,
    lossStreakWarning: pd.dnaEnrichment?.lossStreakWarning || null,
    winStreakWarning: pd.dnaEnrichment?.winStreakWarning || null,
    optimalConfidenceRange: pd.confidence?.bestRange || null,
    optimalSetupScoreRange: pd.setupScore?.optimalThreshold || null,
    mostDangerousEmotion: pd.emotions?.mostDangerous || null,
    mostProfitableEmotion: pd.emotions?.mostProfitable || null,
    topNegativePatterns: pd.rankings?.top5Negative?.slice(0, 3) || [],
    topPositivePatterns: pd.rankings?.top5Positive?.slice(0, 3) || [],
  };

  return {
    ...dnaResult,
    behavioralDNA: enrichedBehavioralDNA,
    patternEnrichment,
  };
}

module.exports = { computeTradingDNA, enrichTradingDNAWithPatterns, getConfidence };
