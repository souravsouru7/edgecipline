/**
 * Trade Evaluation Engine
 * Computes systemTradeQuality independently of P&L using execution signals.
 *
 * Five factors (each scored to its weight ceiling):
 *   setupScore    → 40 pts   (0-100 adherence percentage)
 *   entryBasis    → 20 pts   (Plan=20, Custom=14, Emotion=6, Impulsive=0)
 *   emotional     → 20 pts   (mood 1-5 base + tag adjustments)
 *   wouldRetake   → 10 pts   (Yes=10, No=0)
 *   confidence    → 10 pts   (Medium=10, High=8, Low=4, Overconfident=2)
 *
 * Minimum 2 factors required. Score normalised to 0-100, then tiered:
 *   ≥70 → "Great", ≥45 → "Average", <45 → "Poor"
 */

const ENTRY_BASIS_SCORES = { Plan: 20, Custom: 14, Emotion: 6, Impulsive: 0 };
const CONFIDENCE_SCORES  = { Medium: 10, High: 8, Low: 4, Overconfident: 2 };

const NEGATIVE_TAGS = new Set(["FOMO", "Revenge", "Fear", "Greed", "Frustrated", "Bored"]);
const POSITIVE_TAGS = new Set(["Calm", "Focused", "Patient", "Disciplined"]);

/**
 * @param {object} trade  – lean MongoDB document
 * @returns {{ tier: string|null, score: number|null, breakdown: object, factorsUsed: number }}
 */
function calculateActualTradeQuality(trade) {
  let totalPts    = 0;
  let maxPts      = 0;
  let factorsUsed = 0;
  const breakdown = {};

  // ── Factor 1: Setup Score ──────────────────────────────────────────────────
  if (typeof trade.setupScore === "number" && trade.setupScore >= 0) {
    const pts = trade.setupScore * 0.4; // 0-40
    totalPts   += pts;
    maxPts     += 40;
    factorsUsed++;
    breakdown.setupScore = { raw: trade.setupScore, pts: Math.round(pts), max: 40 };
  }

  // ── Factor 2: Entry Basis ─────────────────────────────────────────────────
  if (trade.entryBasis && ENTRY_BASIS_SCORES[trade.entryBasis] !== undefined) {
    const pts = ENTRY_BASIS_SCORES[trade.entryBasis];
    totalPts   += pts;
    maxPts     += 20;
    factorsUsed++;
    breakdown.entryBasis = { raw: trade.entryBasis, pts, max: 20 };
  }

  // ── Factor 3: Emotional State (mood + emotionalTags) ─────────────────────
  const hasMood = typeof trade.mood === "number";
  const hasTags = Array.isArray(trade.emotionalTags) && trade.emotionalTags.length > 0;
  if (hasMood || hasTags) {
    let emotionPts = hasMood ? (trade.mood / 5) * 14 : 7; // 0-14 or neutral 7
    if (hasTags) {
      for (const tag of trade.emotionalTags) {
        if (NEGATIVE_TAGS.has(tag)) emotionPts -= 4;
        if (POSITIVE_TAGS.has(tag)) emotionPts += 2;
      }
    }
    emotionPts = Math.max(0, Math.min(20, emotionPts));
    totalPts   += emotionPts;
    maxPts     += 20;
    factorsUsed++;
    breakdown.emotional = { mood: trade.mood ?? null, tags: trade.emotionalTags ?? [], pts: Math.round(emotionPts), max: 20 };
  }

  // ── Factor 4: Would Retake ────────────────────────────────────────────────
  if (trade.wouldRetake === "Yes" || trade.wouldRetake === "No") {
    const pts = trade.wouldRetake === "Yes" ? 10 : 0;
    totalPts   += pts;
    maxPts     += 10;
    factorsUsed++;
    breakdown.wouldRetake = { raw: trade.wouldRetake, pts, max: 10 };
  }

  // ── Factor 5: Confidence ──────────────────────────────────────────────────
  if (trade.confidence && CONFIDENCE_SCORES[trade.confidence] !== undefined) {
    const pts = CONFIDENCE_SCORES[trade.confidence];
    totalPts   += pts;
    maxPts     += 10;
    factorsUsed++;
    breakdown.confidence = { raw: trade.confidence, pts, max: 10 };
  }

  // ── Require ≥2 factors ────────────────────────────────────────────────────
  if (factorsUsed < 2 || maxPts === 0) {
    return { tier: null, score: null, breakdown, factorsUsed };
  }

  const score = Math.round((totalPts / maxPts) * 100);
  const tier  = score >= 70 ? "Great" : score >= 45 ? "Average" : "Poor";

  return { tier, score, breakdown, factorsUsed };
}

/**
 * Compute self-awareness analytics for an array of trades.
 * Trades without userRating OR computable systemTier are excluded.
 *
 * @param {object[]} trades
 * @returns {object}  Full self-awareness analytics payload.
 */
function computeSelfAwarenessAnalytics(trades) {
  const TIERS = ["Great", "Average", "Poor"];

  // Evaluate every trade
  const evaluated = [];
  for (const t of trades) {
    if (!t.tradeQuality || !TIERS.includes(t.tradeQuality)) continue;
    const { tier: systemTier, score: systemScore, breakdown } = calculateActualTradeQuality(t);
    if (!systemTier) continue; // insufficient data
    evaluated.push({
      selfRating:  t.tradeQuality,
      systemTier,
      systemScore,
      breakdown,
      pnl: t.profit || 0,
      isAccurate: t.tradeQuality === systemTier,
    });
  }

  if (evaluated.length === 0) {
    return { score: null, trackedCount: 0, totalTrades: trades.length, matchCount: 0, breakdown: [] };
  }

  // ── Overall score ─────────────────────────────────────────────────────────
  const matchCount = evaluated.filter(e => e.isAccurate).length;
  const score      = Math.round((matchCount / evaluated.length) * 100);

  // ── Per-category accuracy ─────────────────────────────────────────────────
  const perCategory = {};
  for (const tier of TIERS) {
    const byTier = evaluated.filter(e => e.selfRating === tier);
    const correct = byTier.filter(e => e.isAccurate).length;
    perCategory[tier] = {
      total:    byTier.length,
      correct,
      accuracy: byTier.length ? Math.round((correct / byTier.length) * 100) : 0,
    };
  }

  // ── 3×3 confusion matrix  [userRating][systemTier] ───────────────────────
  const matrix = {};
  for (const u of TIERS) {
    matrix[u] = {};
    for (const s of TIERS) matrix[u][s] = 0;
  }
  for (const e of evaluated) {
    matrix[e.selfRating][e.systemTier]++;
  }

  // ── Overconfident / underconfident counts ────────────────────────────────
  const overconfident  = evaluated.filter(e => e.selfRating === "Great" && e.systemTier !== "Great").length;
  const underconfident = evaluated.filter(e => e.selfRating === "Poor"  && e.systemTier !== "Poor").length;

  // ── Best / worst judged category ─────────────────────────────────────────
  const rankedTiers = TIERS
    .filter(t => perCategory[t].total >= 2)
    .sort((a, b) => perCategory[b].accuracy - perCategory[a].accuracy);
  const bestJudgedCategory  = rankedTiers[0]  ?? null;
  const worstJudgedCategory = rankedTiers[rankedTiers.length - 1] ?? null;

  // ── Narrative patterns ────────────────────────────────────────────────────
  const patterns = [];

  // Overconfidence pattern
  if (overconfident >= 2) {
    const overPct = Math.round((overconfident / (perCategory.Great.total || 1)) * 100);
    patterns.push(`You rate ${overPct}% of your Great trades above your actual execution — a sign of post-trade optimism bias.`);
  }

  // Underconfidence pattern
  if (underconfident >= 2) {
    const underPct = Math.round((underconfident / (perCategory.Poor.total || 1)) * 100);
    patterns.push(`You underestimate ${underPct}% of your Poor-rated trades — your execution was better than you believed.`);
  }

  // Category-specific accuracy observations
  if (perCategory.Poor.accuracy >= 80 && perCategory.Poor.total >= 2) {
    patterns.push("You correctly identify Poor trades with high accuracy — strong self-critical awareness when rules are broken.");
  }
  if (perCategory.Average.accuracy < 55 && perCategory.Average.total >= 3) {
    patterns.push("Average trades are your hardest to judge — the grey zone between discipline and compromise causes evaluation errors.");
  }
  if (perCategory.Great.accuracy >= 80 && perCategory.Great.total >= 2) {
    patterns.push("You accurately identify Great trades — you know what good execution feels like for you.");
  }

  // Win bias: Great self-rated but system says poor
  const winBiased = evaluated.filter(e => e.selfRating === "Great" && e.systemTier === "Poor" && e.pnl > 0).length;
  if (winBiased >= 2) {
    patterns.push(`You rated ${winBiased} winning trades as Great even though execution was poor — winning P&L is inflating your self-assessment.`);
  }

  if (patterns.length === 0 && evaluated.length >= 5) {
    if (score >= 70) patterns.push("Your self-awareness is well-calibrated. You accurately evaluate your trade quality across all categories.");
    else patterns.push("Continue rating your trades consistently — more data will reveal clearer self-awareness patterns.");
  }

  return {
    score,
    trackedCount:        evaluated.length,
    totalTrades:         trades.length,
    matchCount,
    overconfident,
    underconfident,
    perCategory,
    matrix,
    patterns,
    bestJudgedCategory,
    worstJudgedCategory,
    breakdown:           evaluated.slice(-20).map(({ breakdown: _bd, ...rest }) => rest),
  };
}

module.exports = { calculateActualTradeQuality, computeSelfAwarenessAnalytics };
