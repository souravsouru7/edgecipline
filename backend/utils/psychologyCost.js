/**
 * Psychology Cost Calculator
 *
 * Answers: "How much money is my psychology costing me?"
 *
 * Five computation modules:
 *   1. Emotional Cost   — per emotionalTag: P&L attributed in full to each tag on the trade
 *   2. Mistake Cost     — per mistakeTag: count + net P&L
 *   3. Rule Violation   — per broken setupRule label: count + net P&L when broken
 *   4. Cost Score       — 0-100 composite behavioural health score
 *   5. Leak Detection   — top 3 money drains across all categories
 *
 * P&L Attribution Strategy for multi-tag trades:
 *   A trade tagged ["FOMO","Fear"] has its full P&L attributed to BOTH FOMO and Fear
 *   independently. This gives traders the most actionable signal ("FOMO cost me $X total")
 *   rather than a confusing fractional allocation. This is documented in API responses.
 */

const NEGATIVE_TAGS = ["FOMO", "Revenge", "Fear", "Greed", "Frustrated", "Bored"];
const POSITIVE_TAGS = ["Calm", "Focused", "Patient", "Disciplined"];

const NEG_SET = new Set(NEGATIVE_TAGS);
const POS_SET = new Set(POSITIVE_TAGS);

// ── helpers ───────────────────────────────────────────────────────────────────

const pct  = (n, d) => (d ? Number(((n / d) * 100).toFixed(1)) : 0);
const fix2 = (n)    => Number(n.toFixed(2));

function bucketStats(bucket) {
  const wins   = bucket.filter(p => p > 0).length;
  const losses = bucket.filter(p => p < 0).length;
  const net    = bucket.reduce((s, p) => s + p, 0);
  const grossW = bucket.filter(p => p > 0).reduce((s, p) => s + p, 0);
  const grossL = bucket.filter(p => p < 0).reduce((s, p) => s + Math.abs(p), 0);
  const count  = bucket.length;
  return {
    count,
    wins,
    losses,
    winRate:       pct(wins, count),
    netPnL:        fix2(net),
    avgPnL:        count ? fix2(net / count) : 0,
    totalProfit:   fix2(grossW),
    totalLoss:     fix2(-grossL),
    profitFactor:  grossL > 0 ? fix2(grossW / grossL) : grossW > 0 ? 999 : 0,
  };
}

// ── Module 1: Emotional Cost ──────────────────────────────────────────────────

function computeEmotionalCosts(trades) {
  const map = {};

  for (const t of trades) {
    if (!Array.isArray(t.emotionalTags) || t.emotionalTags.length === 0) continue;
    const pnl = t.profit || 0;
    for (const tag of t.emotionalTags) {
      if (!tag) continue;
      if (!map[tag]) map[tag] = [];
      map[tag].push(pnl);
    }
  }

  return Object.entries(map)
    .map(([tag, pnls]) => ({
      tag,
      isNegativeBehavior: NEG_SET.has(tag),
      ...bucketStats(pnls),
    }))
    .sort((a, b) => a.netPnL - b.netPnL); // most damaging first
}

// ── Module 2: Mistake Cost ────────────────────────────────────────────────────

function computeMistakeCosts(trades) {
  const map = {};      // normalizedKey -> pnls[]
  const labels = {};   // normalizedKey -> display label (first-seen casing)

  for (const t of trades) {
    if (!t.mistakeTag) continue;
    const trimmed = String(t.mistakeTag).trim();
    if (!trimmed) continue;
    // Case-fold so "FOMO" and "fomo" are counted as the same mistake instead
    // of undercounting each variant separately.
    const key = trimmed.toLowerCase();
    const pnl = t.profit || 0;
    if (!map[key]) {
      map[key] = [];
      labels[key] = trimmed;
    }
    map[key].push(pnl);
  }

  return Object.entries(map)
    .map(([key, pnls]) => ({ tag: labels[key], ...bucketStats(pnls) }))
    .sort((a, b) => a.netPnL - b.netPnL);
}

// ── Module 3: Rule Violation Cost ─────────────────────────────────────────────

function computeRuleViolationCosts(trades) {
  const map = {};

  for (const t of trades) {
    if (!Array.isArray(t.setupRules) || t.setupRules.length === 0) continue;
    const pnl = t.profit || 0;
    for (const rule of t.setupRules) {
      if (!rule.label || rule.followed !== false) continue; // skip followed or unlabelled
      const label = String(rule.label).trim();
      if (!label) continue;
      if (!map[label]) map[label] = [];
      map[label].push(pnl);
    }
  }

  return Object.entries(map)
    .map(([rule, pnls]) => ({ rule, timesBroken: pnls.length, ...bucketStats(pnls) }))
    .sort((a, b) => a.netPnL - b.netPnL);
}

// ── Module 4: Psychology Cost Score (0-100) ───────────────────────────────────

function computePsychologyCostScore(trades) {
  const unhealthyTrades = trades.filter(t => t.emotionalTags?.some(tag => NEG_SET.has(tag)));
  const healthyTrades   = trades.filter(t =>
    t.emotionalTags?.some(tag => POS_SET.has(tag)) &&
    !t.emotionalTags?.some(tag => NEG_SET.has(tag))
  );

  const unhealthyNetPnL = unhealthyTrades.reduce((s, t) => s + (t.profit || 0), 0);
  const healthyNetPnL   = healthyTrades.reduce((s, t) => s + (t.profit || 0), 0);
  const totalVolume     = trades.reduce((s, t) => s + Math.abs(t.profit || 0), 0) || 1;

  // Cost drag: how much unhealthy behavior is destroying value (only losses matter here)
  const costDrag    = Math.max(0, -unhealthyNetPnL) / totalVolume; // 0-1
  // Health lift: how much positive behavior adds value (only gains matter)
  const healthLift  = Math.max(0, healthyNetPnL) / totalVolume;   // 0-1

  const score = Math.min(100, Math.max(0, Math.round(50 + healthLift * 30 - costDrag * 30)));

  return {
    score,
    unhealthyNetPnL:    fix2(unhealthyNetPnL),
    healthyNetPnL:      fix2(healthyNetPnL),
    unhealthyTradeCount: unhealthyTrades.length,
    healthyTradeCount:   healthyTrades.length,
  };
}

// ── Module 5: Leak Detection ──────────────────────────────────────────────────

function detectLeaks(emotionalCosts, mistakeCosts, ruleViolations, totalLosses) {
  const denominator = Math.abs(totalLosses) || 1;

  const candidates = [
    ...emotionalCosts
      .filter(e => e.netPnL < 0 && e.isNegativeBehavior)
      .map(e => ({ type: "emotion", name: e.tag, cost: e.netPnL, count: e.count })),
    ...mistakeCosts
      .filter(m => m.netPnL < 0)
      .map(m => ({ type: "mistake", name: m.tag, cost: m.netPnL, count: m.count })),
    ...ruleViolations
      .filter(r => r.netPnL < 0)
      .map(r => ({ type: "ruleViolation", name: r.rule, cost: r.netPnL, count: r.timesBroken })),
  ].sort((a, b) => a.cost - b.cost); // most negative first

  return candidates.slice(0, 3).map(leak => ({
    ...leak,
    impactPct: Number((Math.abs(leak.cost) / denominator * 100).toFixed(1)),
  }));
}

// ── Module 6: Behavioral DNA ──────────────────────────────────────────────────

function computeBehavioralDNA(emotionalCosts, mistakeCosts, ruleViolations) {
  const negEmotions = emotionalCosts.filter(e => e.isNegativeBehavior && e.netPnL < 0);
  const posEmotions = emotionalCosts.filter(e => !e.isNegativeBehavior && e.netPnL > 0)
    .sort((a, b) => b.netPnL - a.netPnL);

  const mostExpensiveEmotion  = negEmotions[0]  ? { name: negEmotions[0].tag,  cost: negEmotions[0].netPnL }  : null;
  const mostProfitableEmotion = posEmotions[0]  ? { name: posEmotions[0].tag,  profit: posEmotions[0].netPnL } : null;
  const mostExpensiveMistake  = mistakeCosts[0] ? { name: mistakeCosts[0].tag, cost: mistakeCosts[0].netPnL }  : null;

  const strongestRule = [...ruleViolations].sort((a, b) => b.netPnL - a.netPnL)[0];
  const weakestRule   = ruleViolations[0]; // already sorted most negative first

  return {
    mostExpensiveEmotion,
    mostProfitableEmotion,
    mostExpensiveMistake,
    mostProfitableBehavior:  posEmotions[0]  ? { name: posEmotions[0].tag,  profit: posEmotions[0].netPnL }    : null,
    strongestDisciplineTrait: strongestRule  ? { rule: strongestRule.rule,   netPnL: strongestRule.netPnL }    : null,
    weakestDisciplineTrait:   weakestRule    ? { rule: weakestRule.rule,     cost: weakestRule.netPnL }        : null,
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * @param {object[]} trades  Lean MongoDB documents with fields:
 *   profit, emotionalTags[], mistakeTag, setupRules[{label,followed}]
 * @returns {object}
 */
function computePsychologyCost(trades) {
  if (!Array.isArray(trades) || trades.length === 0) {
    return {
      emotionalCosts:          [],
      mistakeCosts:            [],
      ruleViolations:          [],
      psychologyCostScore:     50,
      topLeaks:                [],
      behavioralDNA:           { mostExpensiveEmotion: null, mostProfitableEmotion: null, mostExpensiveMistake: null, mostProfitableBehavior: null, strongestDisciplineTrait: null, weakestDisciplineTrait: null },
      totalEmotionCost:        0,
      totalMistakeCost:        0,
      totalRuleViolationCost:  0,
      totalPsychologyCost:     0,
      unhealthyNetPnL:         0,
      healthyNetPnL:           0,
      trackedTrades:           0,
      totalTrades:             0,
    };
  }

  const emotionalCosts  = computeEmotionalCosts(trades);
  const mistakeCosts    = computeMistakeCosts(trades);
  const ruleViolations  = computeRuleViolationCosts(trades);
  const scoreResult     = computePsychologyCostScore(trades);

  const totalLosses = trades.reduce((s, t) => s + Math.min(0, t.profit || 0), 0);
  const topLeaks    = detectLeaks(emotionalCosts, mistakeCosts, ruleViolations, totalLosses);
  const dna         = computeBehavioralDNA(emotionalCosts, mistakeCosts, ruleViolations);

  const totalEmotionCost = fix2(
    emotionalCosts.filter(e => e.isNegativeBehavior).reduce((s, e) => s + Math.min(0, e.netPnL), 0)
  );
  const totalMistakeCost = fix2(
    mistakeCosts.reduce((s, m) => s + Math.min(0, m.netPnL), 0)
  );
  const totalRuleViolationCost = fix2(
    ruleViolations.reduce((s, r) => s + Math.min(0, r.netPnL), 0)
  );

  // Combined psychology cost: the sum of unique losses from unhealthy behavior
  // (not triple-counted — we report each dimension independently, combined = worst single leak group)
  const totalPsychologyCost = fix2(
    Math.min(totalEmotionCost, totalMistakeCost, totalRuleViolationCost, 0) +
    Math.max(totalEmotionCost, totalMistakeCost, totalRuleViolationCost, 0)
  );

  const trackedTrades = trades.filter(t =>
    (Array.isArray(t.emotionalTags) && t.emotionalTags.length > 0) || t.mistakeTag ||
    (Array.isArray(t.setupRules) && t.setupRules.some(r => r.followed === false))
  ).length;

  return {
    emotionalCosts,
    mistakeCosts,
    ruleViolations,
    psychologyCostScore:   scoreResult.score,
    topLeaks,
    behavioralDNA:         dna,
    totalEmotionCost,
    totalMistakeCost,
    totalRuleViolationCost,
    totalPsychologyCost,
    unhealthyNetPnL:       scoreResult.unhealthyNetPnL,
    healthyNetPnL:         scoreResult.healthyNetPnL,
    unhealthyTradeCount:   scoreResult.unhealthyTradeCount,
    healthyTradeCount:     scoreResult.healthyTradeCount,
    trackedTrades,
    totalTrades: trades.length,
  };
}

module.exports = { computePsychologyCost, NEGATIVE_TAGS, POSITIVE_TAGS };
