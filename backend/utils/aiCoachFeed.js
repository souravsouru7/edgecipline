"use strict";

/**
 * AI Coach Feed Engine
 *
 * Generates personalized, data-driven coaching insights from existing analytics engines.
 * Every insight references real user data — no hallucination, no invented statistics.
 *
 * Data sources consumed:
 *   psychologyCost  — computePsychologyCost() output
 *   tradingDNA      — computeTradingDNA() output (optionally enriched)
 *   patterns        — computePatternDetection() output
 *   selfAwareness   — computeSelfAwarenessAnalytics() output
 *   totalTrades     — raw count from trade query
 *   totalVolume     — sum of |profit| across all trades (impact normalizer)
 *   marketType      — "Forex" | "Indian_Market"
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORY = {
  PSYCHOLOGY:     "Psychology",
  CONFIDENCE:     "Confidence",
  DISCIPLINE:     "Discipline",
  PATTERN:        "Pattern",
  TRADING_DNA:    "TradingDNA",
  SELF_AWARENESS: "SelfAwareness",
  IMPROVEMENT:    "Improvement",
};

const PRIORITY = { HIGH: "high", MEDIUM: "medium", LOW: "low" };

/**
 * Per-category framing for the "why it matters" / "expected outcome" panels.
 *
 * These used to come from the frontend, which had exactly two strings — one for
 * positive cards and one for negative — so a self-awareness card, a session card
 * and a rule card all read word-for-word identically below the fold. Cards may
 * still pass their own text to makeInsight(); these are the defaults.
 */
const WHY_IT_MATTERS = {
  [CATEGORY.PSYCHOLOGY]: {
    positive: "Your emotional state is one of the few inputs you set before entry, so a state that reliably produces good execution is worth building a routine around.",
    negative: "Emotional states compound — one unmanaged reaction tends to set up the next — so this repeats until something interrupts it deliberately.",
  },
  [CATEGORY.CONFIDENCE]: {
    positive: "Confidence is recorded before the outcome is known, so a band that performs well is a genuine forward-looking filter rather than hindsight.",
    negative: "Confidence is recorded before the outcome is known, which makes a weak band something you can screen for at entry instead of learning afterwards.",
  },
  [CATEGORY.DISCIPLINE]: {
    positive: "Process metrics move before P&L does, so holding this level of compliance is what keeps results repeatable when conditions change.",
    negative: "Rule compliance is the part of trading fully within your control, which makes a gap here the cheapest thing on this list to close.",
  },
  [CATEGORY.PATTERN]: {
    positive: "A pattern that holds across several trades is more reliable than any single result, so it is something you can lean on deliberately.",
    negative: "A pattern that holds across several trades will keep costing the same amount until something in the process changes.",
  },
  [CATEGORY.TRADING_DNA]: {
    positive: "Session, instrument and setup quality are all chosen before entry, so this is a filter you can apply rather than a result you wait for.",
    negative: "Session, instrument and setup quality are all chosen before entry, which makes this avoidable rather than unlucky.",
  },
  [CATEGORY.SELF_AWARENESS]: {
    positive: "Accurate self-review means your post-trade notes can be trusted as an input, so everything else built on them rests on solid ground.",
    negative: "When self-review is miscalibrated, every conclusion drawn from it inherits the error — including the other insights in this feed.",
  },
  [CATEGORY.IMPROVEMENT]: {
    positive: "Habits that are already consistent are the cheapest place to build from, because the behaviour is proven rather than aspirational.",
    negative: "This is the gap between the process you designed and the one you actually run.",
  },
};

const EXPECTED_OUTCOME = {
  [CATEGORY.PSYCHOLOGY]: {
    positive: "More trades taken from the state that already works for you, and fewer taken from the one that does not.",
    negative: "Fewer trades entered in a compromised state, which usually shows up first as smaller losing days rather than bigger wins.",
  },
  [CATEGORY.CONFIDENCE]: {
    positive: "Position size lines up with the confidence band that has actually earned it, instead of being uniform across every entry.",
    negative: "Fewer entries from the band that has not paid, which removes losses without needing a new strategy.",
  },
  [CATEGORY.DISCIPLINE]: {
    positive: "Your results stay attributable to the process rather than to luck, so future reviews compare like with like.",
    negative: "Higher compliance on the specific rule named above, which is measurable on your next ten trades.",
  },
  [CATEGORY.PATTERN]: {
    positive: "The conditions behind this pattern show up more often because you are now selecting for them.",
    negative: "The pattern appears less often, and its cost per occurrence drops as you catch it earlier.",
  },
  [CATEGORY.TRADING_DNA]: {
    positive: "More of your volume concentrated in the conditions your own record supports.",
    negative: "Less exposure to the conditions that have consistently worked against you.",
  },
  [CATEGORY.SELF_AWARENESS]: {
    positive: "You can act on your own trade ratings with confidence, which makes every later review faster.",
    negative: "Closer agreement between how you rate a trade and how it actually executed, so your reviews stop pointing at the wrong problem.",
  },
  [CATEGORY.IMPROVEMENT]: {
    positive: "A proven habit extended to the parts of your process that are still inconsistent.",
    negative: "One fewer recurring leak between the plan and the execution.",
  },
};

// Minimum P&L magnitude to generate an insight (avoids noise from tiny amounts)
const MIN_PNL_THRESHOLD = 50;
// Minimum trade count for an insight to be meaningful
const MIN_TRADES = 3;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeId(category, key) {
  return `${category.toLowerCase()}-${String(key || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)}`;
}

function formatAmount(value, currency) {
  const num = Number(value) || 0;
  const abs = Math.abs(num);
  const sym = currency || "$";
  if (abs >= 1000000) return `${sym}${(abs / 1000000).toFixed(1)}M`;
  if (abs >= 1000) return `${sym}${(abs / 1000).toFixed(1)}K`;
  if (abs === 0) return `${sym}0`;
  return `${sym}${abs.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function signedAmount(value, currency) {
  const num = Number(value) || 0;
  const prefix = num >= 0 ? "+" : "-";
  return `${prefix}${formatAmount(Math.abs(num), currency)}`;
}

function impactFromPnl(pnl, totalVolume) {
  const vol = Math.max(1, totalVolume);
  const ratio = Math.abs(pnl) / vol;
  return Math.min(100, Math.max(1, Math.round(ratio * 300)));
}

function priorityFromScore(score) {
  if (score >= 50) return PRIORITY.HIGH;
  if (score >= 20) return PRIORITY.MEDIUM;
  return PRIORITY.LOW;
}

/**
 * Signature for the set of trades a card describes, used to collapse cards that
 * are really the same finding. Null when any part is missing so a partial
 * signature can never collide with another card's.
 */
function cohortKey({ count, winRate, netPnL } = {}) {
  if (count == null || winRate == null || netPnL == null) return null;
  return `${count}|${Number(winRate).toFixed(1)}|${Number(netPnL).toFixed(2)}`;
}

function makeInsight({
  id, category, type, impactScore, title, insight, evidence, recommendation,
  whyItMatters, expectedOutcome, cohort,
}) {
  // "neutral" cards read as observations rather than warnings, so they take the
  // positive framing.
  const tone = type === "negative" ? "negative" : "positive";
  return {
    id,
    category,
    type,
    priority: priorityFromScore(impactScore),
    impactScore: Math.round(impactScore),
    title,
    insight,
    evidence,
    recommendation,
    whyItMatters: whyItMatters || WHY_IT_MATTERS[category]?.[tone] || null,
    expectedOutcome: expectedOutcome || EXPECTED_OUTCOME[category]?.[tone] || null,
    // Underscore-prefixed: internal to feed assembly, not part of the API shape.
    _cohort: cohortKey(cohort),
  };
}

// ── Generator: Psychology Cost ────────────────────────────────────────────────

function insightsFromPsychologyCost(psych, currency, totalVolume) {
  const results = [];
  if (!psych || psych.totalTrades === 0) return results;

  const { behavioralDNA, emotionalCosts, ruleViolations, mistakeCosts, healthyNetPnL, unhealthyNetPnL } = psych;
  if (!behavioralDNA) return results;

  // 1. Most expensive negative emotion
  const worstEmotionKey = behavioralDNA.mostExpensiveEmotion;
  if (worstEmotionKey && worstEmotionKey.cost < -MIN_PNL_THRESHOLD) {
    const entry = (emotionalCosts || []).find(e => e.tag === worstEmotionKey.name);
    const count = entry?.count || 0;
    if (count >= MIN_TRADES) {
      results.push(makeInsight({
        id: makeId(CATEGORY.PSYCHOLOGY, `emotion-neg-${worstEmotionKey.name}`),
        category: CATEGORY.PSYCHOLOGY,
        type: "negative",
        impactScore: impactFromPnl(worstEmotionKey.cost, totalVolume),
        title: `${worstEmotionKey.name} Is Your Biggest Emotional Leak`,
        insight: `Trades tagged "${worstEmotionKey.name}" have generated a net loss of ${formatAmount(worstEmotionKey.cost, currency)}.`,
        evidence: `${count} trades · Win rate: ${entry.winRate}% · Avg P&L: ${signedAmount(entry.avgPnL, currency)} per trade`,
        recommendation: `Before each entry ask: "Is this my plan or my ${worstEmotionKey.name.toLowerCase()}?" If emotion-driven, skip the trade.`,
      }));
    }
  }

  // 2. Most profitable positive emotion
  const bestEmotionKey = behavioralDNA.mostProfitableEmotion;
  if (bestEmotionKey && bestEmotionKey.profit > MIN_PNL_THRESHOLD) {
    const entry = (emotionalCosts || []).find(e => e.tag === bestEmotionKey.name);
    const count = entry?.count || 0;
    if (count >= MIN_TRADES) {
      results.push(makeInsight({
        id: makeId(CATEGORY.IMPROVEMENT, `emotion-pos-${bestEmotionKey.name}`),
        category: CATEGORY.IMPROVEMENT,
        type: "positive",
        impactScore: impactFromPnl(bestEmotionKey.profit, totalVolume),
        title: `${bestEmotionKey.name} Trading Is Your Edge`,
        insight: `When you trade with a "${bestEmotionKey.name}" mindset, you generate ${formatAmount(bestEmotionKey.profit, currency)} in net profit.`,
        evidence: `${count} trades · Win rate: ${entry.winRate}% · Avg P&L: ${signedAmount(entry.avgPnL, currency)} per trade`,
        recommendation: `Only take trades when you feel ${bestEmotionKey.name.toLowerCase()}. Your data shows this state produces your best results.`,
        cohort: { count, winRate: entry.winRate, netPnL: bestEmotionKey.profit },
      }));
    }
  }

  // 3. Most expensive rule violation
  const worstRule = behavioralDNA.weakestDisciplineTrait;
  if (worstRule && worstRule.cost < -MIN_PNL_THRESHOLD) {
    const entry = (ruleViolations || []).find(r => r.rule === worstRule.rule);
    const broken = entry?.timesBroken || 0;
    if (broken >= 2) {
      results.push(makeInsight({
        id: makeId(CATEGORY.DISCIPLINE, `rule-${worstRule.rule}`),
        category: CATEGORY.DISCIPLINE,
        type: "negative",
        impactScore: impactFromPnl(worstRule.cost, totalVolume),
        title: `Breaking "${worstRule.rule}" Is Destroying Your Edge`,
        // `cost` comes from trade.profit, which excludes brokerage/STT on Indian
        // trades and commission/swap on Forex — so it is gross, not net.
        insight: `Violating your "${worstRule.rule}" rule costs ${formatAmount(Math.abs(worstRule.cost), currency)} across ${broken} violations.`,
        evidence: `${broken} violations · Win rate: ${entry?.winRate ?? 0}% · P&L: ${signedAmount(worstRule.cost, currency)}`,
        recommendation: `Write "${worstRule.rule}" in your pre-trade checklist. Treat violations as automatic disqualifiers, not optional guidelines.`,
      }));
    }
  }

  // 4. Most expensive mistake
  const worstMistake = behavioralDNA.mostExpensiveMistake;
  if (worstMistake && worstMistake.cost < -MIN_PNL_THRESHOLD) {
    const entry = (mistakeCosts || []).find(m => m.tag === worstMistake.name);
    const count = entry?.count || 0;
    if (count >= MIN_TRADES) {
      results.push(makeInsight({
        id: makeId(CATEGORY.DISCIPLINE, `mistake-${worstMistake.name}`),
        category: CATEGORY.DISCIPLINE,
        type: "negative",
        impactScore: impactFromPnl(worstMistake.cost, totalVolume),
        title: `"${worstMistake.name}" Is Your Costliest Mistake`,
        insight: `Trades tagged with the "${worstMistake.name}" mistake have cost you ${formatAmount(Math.abs(worstMistake.cost), currency)} in losses.`,
        evidence: `${count} trades · Win rate: ${entry.winRate}% · Net P&L: ${signedAmount(worstMistake.cost, currency)}`,
        recommendation: `After each "${worstMistake.name}" mistake, log: (1) what triggered it, (2) what you should have done instead.`,
      }));
    }
  }

  // 5. Healthy vs unhealthy contrast (positive reinforcement)
  if (healthyNetPnL > MIN_PNL_THRESHOLD && unhealthyNetPnL < -MIN_PNL_THRESHOLD) {
    const contrast = Math.abs(healthyNetPnL - unhealthyNetPnL);
    results.push(makeInsight({
      id: makeId(CATEGORY.PSYCHOLOGY, "healthy-vs-unhealthy"),
      category: CATEGORY.PSYCHOLOGY,
      type: "positive",
      impactScore: impactFromPnl(contrast, totalVolume),
      title: "Emotional Discipline Directly Drives Your Profit",
      insight: `Calm/focused trades generated ${formatAmount(healthyNetPnL, currency)} while emotional trades lost ${formatAmount(Math.abs(unhealthyNetPnL), currency)}.`,
      evidence: `Healthy trades: ${signedAmount(healthyNetPnL, currency)} · Emotional trades: ${signedAmount(unhealthyNetPnL, currency)}`,
      recommendation: "Your own data proves discipline is profitable. The gap between these two numbers is your improvement opportunity.",
    }));
  }

  return results;
}

// ── Generator: Trading DNA ────────────────────────────────────────────────────

function insightsFromTradingDNA(dna, currency, totalVolume) {
  const results = [];
  if (!dna || dna.insufficient) return results;

  // 1. Best session (Forex only)
  const bestSession = dna.sessionDNA?.best;
  if (bestSession && bestSession.netPnL > MIN_PNL_THRESHOLD && bestSession.trades >= MIN_TRADES) {
    results.push(makeInsight({
      id: makeId(CATEGORY.TRADING_DNA, `session-best-${bestSession.name}`),
      category: CATEGORY.TRADING_DNA,
      type: "positive",
      impactScore: impactFromPnl(bestSession.netPnL, totalVolume),
      title: `${bestSession.name} Session Is Your Peak Performance Window`,
      insight: `The ${bestSession.name} session generates ${formatAmount(bestSession.netPnL, currency)} with a ${bestSession.winRate}% win rate.`,
      evidence: `${bestSession.trades} trades · Win rate: ${bestSession.winRate}% · Avg P&L: ${signedAmount(bestSession.avgPnL, currency)}`,
      // "Reduce activity outside this window" is a claim about the OTHER
      // sessions, so it may only be made when another session actually cleared
      // the sample floor and lost money. sessionDNA drops any session with
      // fewer than 5 trades, so without this guard the card told traders to cut
      // back on sessions the engine had never even seen.
      recommendation: (() => {
        const w = dna.sessionDNA?.worst;
        const comparable = w && w.name !== bestSession.name && w.netPnL < 0;
        return comparable
          ? `Prioritize the ${bestSession.name} session for your highest-conviction setups, and cut back on ${w.name} (${formatAmount(w.netPnL, currency)} across ${w.trades} trades).`
          : `Prioritize the ${bestSession.name} session for your highest-conviction setups. No other session has enough tracked trades yet to compare against, so treat this as one window to protect rather than a reason to avoid the others.`;
      })(),
    }));
  }

  // 2. Worst session (Forex only — only if different from best)
  const worstSession = dna.sessionDNA?.worst;
  if (worstSession && worstSession.netPnL < -MIN_PNL_THRESHOLD && worstSession.trades >= MIN_TRADES) {
    results.push(makeInsight({
      id: makeId(CATEGORY.TRADING_DNA, `session-worst-${worstSession.name}`),
      category: CATEGORY.TRADING_DNA,
      type: "negative",
      impactScore: impactFromPnl(worstSession.netPnL, totalVolume),
      title: `${worstSession.name} Session Is Draining Your Account`,
      insight: `The ${worstSession.name} session has cost you ${formatAmount(Math.abs(worstSession.netPnL), currency)} with only ${worstSession.winRate}% win rate.`,
      evidence: `${worstSession.trades} trades · Win rate: ${worstSession.winRate}% · Net P&L: ${signedAmount(worstSession.netPnL, currency)}`,
      recommendation: `Either reduce lot size by 50% during the ${worstSession.name} session or avoid it until you understand why it underperforms.`,
    }));
  }

  // 3. Best confidence level
  const bestConf = dna.confidenceDNA?.best;
  if (bestConf && bestConf.netPnL > MIN_PNL_THRESHOLD && bestConf.trades >= MIN_TRADES) {
    results.push(makeInsight({
      id: makeId(CATEGORY.CONFIDENCE, `conf-best-${bestConf.name}`),
      category: CATEGORY.CONFIDENCE,
      type: "positive",
      impactScore: impactFromPnl(bestConf.netPnL, totalVolume),
      title: `"${bestConf.name}" Confidence Is Your Sweet Spot`,
      insight: `Trades at "${bestConf.name}" confidence have a ${bestConf.winRate}% win rate generating ${formatAmount(bestConf.netPnL, currency)} net profit.`,
      evidence: `${bestConf.trades} trades · Win rate: ${bestConf.winRate}% · Avg P&L: ${signedAmount(bestConf.avgPnL, currency)}`,
      recommendation: `When your confidence is "${bestConf.name}", use your full planned position size. This is your highest-edge state.`,
    }));
  }

  // 4. Overconfidence warning
  const overconfEntry = (dna.confidenceDNA?.all || []).find(c => c.name === "Overconfident");
  if (overconfEntry && overconfEntry.netPnL < -MIN_PNL_THRESHOLD && overconfEntry.trades >= MIN_TRADES) {
    results.push(makeInsight({
      id: makeId(CATEGORY.CONFIDENCE, "overconfidence-warning"),
      category: CATEGORY.CONFIDENCE,
      type: "negative",
      impactScore: impactFromPnl(overconfEntry.netPnL, totalVolume),
      title: "Overconfidence Is Eroding Your Trading Edge",
      insight: `Trades at "Overconfident" confidence have only a ${overconfEntry.winRate}% win rate with ${formatAmount(Math.abs(overconfEntry.netPnL), currency)} in losses.`,
      evidence: `${overconfEntry.trades} overconfident trades · Win rate: ${overconfEntry.winRate}% · Net P&L: ${signedAmount(overconfEntry.netPnL, currency)}`,
      recommendation: `When confidence reaches 9-10/10, reduce position size by 50% and require one extra confirmation signal before entry.`,
    }));
  }

  // 5. Worst confidence level (if different from overconfident)
  const worstConf = dna.confidenceDNA?.worst;
  if (worstConf && worstConf.name !== "Overconfident" && worstConf.netPnL < -MIN_PNL_THRESHOLD && worstConf.trades >= MIN_TRADES) {
    results.push(makeInsight({
      id: makeId(CATEGORY.CONFIDENCE, `conf-worst-${worstConf.name}`),
      category: CATEGORY.CONFIDENCE,
      type: "negative",
      impactScore: impactFromPnl(worstConf.netPnL, totalVolume),
      title: `"${worstConf.name}" Confidence Trades Are Underperforming`,
      insight: `Trades at "${worstConf.name}" confidence have a ${worstConf.winRate}% win rate with ${formatAmount(Math.abs(worstConf.netPnL), currency)} in net losses.`,
      evidence: `${worstConf.trades} trades · Win rate: ${worstConf.winRate}% · Net P&L: ${signedAmount(worstConf.netPnL, currency)}`,
      recommendation: `At "${worstConf.name}" confidence, reduce position size or skip the trade. This state is a statistical edge-killer.`,
      cohort: { count: worstConf.trades, winRate: worstConf.winRate, netPnL: worstConf.netPnL },
    }));
  }

  // 6. Best mood
  const bestMood = dna.moodDNA?.best;
  if (bestMood && bestMood.netPnL > MIN_PNL_THRESHOLD && bestMood.trades >= MIN_TRADES) {
    results.push(makeInsight({
      id: makeId(CATEGORY.TRADING_DNA, `mood-best-${bestMood.mood}`),
      category: CATEGORY.TRADING_DNA,
      type: "positive",
      impactScore: impactFromPnl(bestMood.netPnL, totalVolume),
      title: `${bestMood.name} Is Your Optimal Trading State`,
      insight: `You generate ${formatAmount(bestMood.netPnL, currency)} with a ${bestMood.winRate}% win rate when your mood is "${bestMood.name}".`,
      evidence: `${bestMood.trades} trades · Win rate: ${bestMood.winRate}% · Avg P&L: ${signedAmount(bestMood.avgPnL, currency)}`,
      recommendation: `Rate your mood before every session. On days you're not at your optimal state, reduce size or sit out entirely.`,
    }));
  }

  // 7. Worst mood
  const worstMood = dna.moodDNA?.worst;
  if (worstMood && worstMood.netPnL < -MIN_PNL_THRESHOLD && worstMood.trades >= MIN_TRADES) {
    results.push(makeInsight({
      id: makeId(CATEGORY.TRADING_DNA, `mood-worst-${worstMood.mood}`),
      category: CATEGORY.TRADING_DNA,
      type: "negative",
      impactScore: impactFromPnl(worstMood.netPnL, totalVolume),
      title: `Trading at "${worstMood.name}" Mood Costs You Money`,
      insight: `When your mood is "${worstMood.name}", your win rate drops to ${worstMood.winRate}% with ${formatAmount(Math.abs(worstMood.netPnL), currency)} in losses.`,
      evidence: `${worstMood.trades} trades · Win rate: ${worstMood.winRate}% · Net P&L: ${signedAmount(worstMood.netPnL, currency)}`,
      recommendation: `If your mood is "${worstMood.name}" before market open, reduce position size by 50% or take the day off.`,
    }));
  }

  // 8. Best day of week
  const bestDay = dna.dayDNA?.best;
  if (bestDay && bestDay.netPnL > MIN_PNL_THRESHOLD && bestDay.trades >= MIN_TRADES) {
    results.push(makeInsight({
      id: makeId(CATEGORY.TRADING_DNA, `day-best-${bestDay.name}`),
      category: CATEGORY.TRADING_DNA,
      type: "positive",
      impactScore: impactFromPnl(bestDay.netPnL, totalVolume),
      title: `${bestDay.name} Is Your Best Trading Day`,
      insight: `${bestDay.name} generates your highest edge: ${formatAmount(bestDay.netPnL, currency)} net profit with a ${bestDay.winRate}% win rate.`,
      evidence: `${bestDay.trades} trades · Win rate: ${bestDay.winRate}% · Net P&L: ${signedAmount(bestDay.netPnL, currency)}`,
      recommendation: `On ${bestDay.name}s, be ready to take full-size positions on your best setups. Your edge is statistically strongest here.`,
    }));
  }

  // 9. Worst day of week
  const worstDay = dna.dayDNA?.worst;
  if (worstDay && worstDay.netPnL < -MIN_PNL_THRESHOLD && worstDay.trades >= MIN_TRADES) {
    results.push(makeInsight({
      id: makeId(CATEGORY.TRADING_DNA, `day-worst-${worstDay.name}`),
      category: CATEGORY.TRADING_DNA,
      type: "negative",
      impactScore: impactFromPnl(worstDay.netPnL, totalVolume),
      title: `${worstDay.name} Is Consistently Unprofitable`,
      insight: `${worstDay.name} generates only a ${worstDay.winRate}% win rate with ${formatAmount(Math.abs(worstDay.netPnL), currency)} in net losses.`,
      evidence: `${worstDay.trades} trades · Win rate: ${worstDay.winRate}% · Net P&L: ${signedAmount(worstDay.netPnL, currency)}`,
      recommendation: `On ${worstDay.name}s, go half-size or avoid trading until you investigate why performance consistently drops.`,
    }));
  }

  // 10. Losing behavioral pattern (emotion + confidence combo)
  const losingPattern = dna.behavioralDNA?.losingPattern;
  if (losingPattern && losingPattern.winRate < 40 && losingPattern.trades >= MIN_TRADES) {
    const pnlVal = Number(losingPattern.netPnL || losingPattern.netPnl || 0);
    results.push(makeInsight({
      id: makeId(CATEGORY.PATTERN, `behavioral-losing-${losingPattern.conditionLabel}`),
      category: CATEGORY.PATTERN,
      type: "negative",
      impactScore: Math.max(50, impactFromPnl(pnlVal, totalVolume)),
      title: "Your Worst Behavioral Combination Is Identified",
      insight: `Trading with "${losingPattern.conditionLabel}" produces only a ${losingPattern.winRate}% win rate — your highest-risk state.`,
      evidence: `${losingPattern.trades} trades · Win rate: ${losingPattern.winRate}% · Net P&L: ${signedAmount(pnlVal, currency)}`,
      recommendation: `When you detect "${losingPattern.conditionLabel}", step back. This combination statistically destroys your edge.`,
    }));
  }

  // 11. Winning behavioral pattern (positive)
  const winningPattern = dna.behavioralDNA?.winningPattern;
  if (winningPattern && winningPattern.winRate >= 55 && winningPattern.trades >= MIN_TRADES) {
    const pnlVal = Number(winningPattern.netPnL || winningPattern.netPnl || 0);
    if (pnlVal > MIN_PNL_THRESHOLD) {
      results.push(makeInsight({
        id: makeId(CATEGORY.IMPROVEMENT, `behavioral-winning-${winningPattern.conditionLabel}`),
        category: CATEGORY.IMPROVEMENT,
        type: "positive",
        impactScore: impactFromPnl(pnlVal, totalVolume),
        title: "Your Highest-Edge State Identified",
        insight: `Trading with "${winningPattern.conditionLabel}" gives you a ${winningPattern.winRate}% win rate — your strongest behavioral state.`,
        evidence: `${winningPattern.trades} trades · Win rate: ${winningPattern.winRate}% · Net P&L: ${signedAmount(pnlVal, currency)}`,
        recommendation: `Look for "${winningPattern.conditionLabel}" as your go signal. This is when you should be most active.`,
        cohort: { count: winningPattern.trades, winRate: winningPattern.winRate, netPnL: pnlVal },
      }));
    }
  }

  // 12. Best instrument/pair (positive reinforcement)
  const bestPair = dna.instrumentDNA?.best;
  if (bestPair && bestPair.netPnL > MIN_PNL_THRESHOLD && bestPair.trades >= MIN_TRADES) {
    results.push(makeInsight({
      id: makeId(CATEGORY.TRADING_DNA, `instrument-best-${bestPair.name}`),
      category: CATEGORY.TRADING_DNA,
      type: "positive",
      impactScore: impactFromPnl(bestPair.netPnL, totalVolume),
      title: `${bestPair.name} Is Your Most Profitable Instrument`,
      insight: `${bestPair.name} generates ${formatAmount(bestPair.netPnL, currency)} with a ${bestPair.winRate}% win rate — your clearest edge.`,
      evidence: `${bestPair.trades} trades · Win rate: ${bestPair.winRate}% · Avg P&L: ${signedAmount(bestPair.avgPnL, currency)}`,
      recommendation: `Allocate more of your daily trade budget to ${bestPair.name}. Your data shows your edge is strongest here.`,
    }));
  }

  return results;
}

// ── Generator: Pattern Detection ─────────────────────────────────────────────

function insightsFromPatterns(patterns, currency, totalVolume) {
  const results = [];
  if (!patterns || patterns.insufficient) return results;

  const rankings = patterns.rankings;

  // 1. Top negative pattern
  const topNeg = (rankings?.top5Negative || [])[0];
  if (topNeg && topNeg.netPnl < -MIN_PNL_THRESHOLD) {
    results.push(makeInsight({
      id: makeId(CATEGORY.PATTERN, `rank-neg-${topNeg.name}`),
      category: CATEGORY.PATTERN,
      type: "negative",
      impactScore: Math.max(40, impactFromPnl(topNeg.netPnl, totalVolume)),
      title: "Your Most Damaging Behavioral Pattern",
      insight: topNeg.description,
      evidence: `${topNeg.count} trades · Win rate: ${topNeg.winRate}% · Net P&L: ${signedAmount(topNeg.netPnl, currency)} · Confidence: ${topNeg.confidence}`,
      recommendation: patternRecommendation(topNeg.description, topNeg.module),
      cohort: { count: topNeg.count, winRate: topNeg.winRate, netPnL: topNeg.netPnl },
    }));
  }

  
  // 2. Top positive pattern
  const topPos = (rankings?.top5Positive || [])[0];
  if (topPos && topPos.netPnl > MIN_PNL_THRESHOLD) {
    results.push(makeInsight({
      id: makeId(CATEGORY.PATTERN, `rank-pos-${topPos.name}`),
      category: CATEGORY.IMPROVEMENT,
      type: "positive",
      impactScore: Math.max(30, impactFromPnl(topPos.netPnl, totalVolume)),
      title: "Your Most Profitable Behavioral Pattern",
      insight: topPos.description,
      evidence: `${topPos.count} trades · Win rate: ${topPos.winRate}% · Net P&L: ${signedAmount(topPos.netPnl, currency)} · Confidence: ${topPos.confidence}`,
      recommendation: "This pattern is working. Replicate these conditions as often as possible.",
      cohort: { count: topPos.count, winRate: topPos.winRate, netPnL: topPos.netPnl },
    }));
  }

  // 3. Loss streak impact
  const lsImpact = patterns.aiContext?.patterns?.lossStreakImpact;
  if (lsImpact && lsImpact.count >= MIN_TRADES && lsImpact.winRate < 45) {
    results.push(makeInsight({
      id: makeId(CATEGORY.PATTERN, "loss-streak-impact"),
      category: CATEGORY.PATTERN,
      type: "negative",
      impactScore: Math.max(60, impactFromPnl(lsImpact.netPnl, totalVolume)),
      title: "Win Rate Collapses After Consecutive Losses",
      insight: `After consecutive losses, your win rate drops to ${lsImpact.winRate}% — a clear emotional trading signal.`,
      evidence: `${lsImpact.count} trades after consecutive losses · Win rate: ${lsImpact.winRate}% · Net P&L: ${signedAmount(lsImpact.netPnl || 0, currency)}`,
      recommendation: "After 2 consecutive losses, take a mandatory break. Only return after reviewing both losses and resetting emotionally.",
    }));
  }

  // 4. Most dangerous combination
  const dangerCombo = patterns.combinations?.mostDangerous;
  if (dangerCombo && dangerCombo.netPnl < -MIN_PNL_THRESHOLD && dangerCombo.confidence) {
    results.push(makeInsight({
      id: makeId(CATEGORY.PATTERN, `combo-danger-${dangerCombo.label}`),
      category: CATEGORY.PATTERN,
      type: "negative",
      impactScore: impactFromPnl(dangerCombo.netPnl, totalVolume),
      title: `"${dangerCombo.label}" Is Your Most Dangerous Combination`,
      insight: `When "${dangerCombo.label}" occurs together, your win rate is only ${dangerCombo.winRate}% with ${formatAmount(Math.abs(dangerCombo.netPnl), currency)} in net losses.`,
      evidence: `${dangerCombo.count} occurrences · Win rate: ${dangerCombo.winRate}% · Net P&L: ${signedAmount(dangerCombo.netPnl, currency)} · Confidence: ${dangerCombo.confidence}`,
      recommendation: `Detecting "${dangerCombo.label}" is a hard stop signal. Step away from the screen when this combination arises.`,
    }));
  }

  // 5. Most profitable combination
  const profitCombo = patterns.combinations?.mostProfitable;
  if (profitCombo && profitCombo.netPnl > MIN_PNL_THRESHOLD && profitCombo.confidence) {
    results.push(makeInsight({
      id: makeId(CATEGORY.IMPROVEMENT, `combo-profit-${profitCombo.label}`),
      category: CATEGORY.IMPROVEMENT,
      type: "positive",
      impactScore: impactFromPnl(profitCombo.netPnl, totalVolume),
      title: `"${profitCombo.label}" Is Your Winning Formula`,
      insight: `When "${profitCombo.label}" conditions align, your win rate is ${profitCombo.winRate}% with ${formatAmount(profitCombo.netPnl, currency)} net profit.`,
      evidence: `${profitCombo.count} occurrences · Win rate: ${profitCombo.winRate}% · Net P&L: ${signedAmount(profitCombo.netPnl, currency)}`,
      recommendation: `Actively hunt for "${profitCombo.label}" setups. These are your highest-probability trades.`,
      cohort: { count: profitCombo.count, winRate: profitCombo.winRate, netPnL: profitCombo.netPnl },
    }));
  }

  // 6. Second-tier negative patterns (up to 2 more)
  const moreNeg = (rankings?.top5Negative || []).slice(1, 3);
  for (const pat of moreNeg) {
    if (pat.netPnl < -MIN_PNL_THRESHOLD) {
      results.push(makeInsight({
        id: makeId(CATEGORY.PATTERN, `rank-neg2-${pat.name}`),
        category: CATEGORY.PATTERN,
        type: "negative",
        impactScore: impactFromPnl(pat.netPnl, totalVolume),
        // Name the pattern in the title. Two of these can appear at once, and a
        // shared generic title made them look like the same card twice.
        title: `Behavioral Risk: ${pat.description}`,
        insight: pat.description,
        evidence: `${pat.count} trades · Win rate: ${pat.winRate}% · Net P&L: ${signedAmount(pat.netPnl, currency)}`,
        recommendation: patternRecommendation(pat.description, pat.module),
        cohort: { count: pat.count, winRate: pat.winRate, netPnL: pat.netPnl },
      }));
    }
  }

  return results;
}

// ── Generator: Self Awareness ─────────────────────────────────────────────────

function insightsFromSelfAwareness(sa) {
  const results = [];
  if (!sa || sa.trackedCount < 5) return results;

  const { score, overconfident, perCategory, bestJudgedCategory, worstJudgedCategory, patterns: saPatterns } = sa;

  // 1. Overall accuracy
  if (typeof score === "number") {
    const isGood = score >= 65;
    const catText = perCategory
      ? `Great: ${perCategory.Great?.accuracy ?? 0}% · Average: ${perCategory.Average?.accuracy ?? 0}% · Poor: ${perCategory.Poor?.accuracy ?? 0}%`
      : "";
    results.push(makeInsight({
      id: makeId(CATEGORY.SELF_AWARENESS, "overall-score"),
      category: isGood ? CATEGORY.IMPROVEMENT : CATEGORY.SELF_AWARENESS,
      type: isGood ? "positive" : "negative",
      impactScore: isGood ? 25 : 45,
      whyItMatters: isGood
        ? `Your own trade ratings agree with how the trades actually executed ${score}% of the time, so your post-trade notes can be trusted as an input — every other insight in this feed is built on them.`
        : `At ${score}% agreement, your post-trade ratings and your actual execution quality are describing different trades — so conclusions drawn from your own review can point at the wrong problem.`,
      expectedOutcome: isGood
        ? "You can act on your own read of a trade without waiting for the P&L to confirm it."
        : "Closer agreement between how you rate a trade and how it executed, which makes the rest of your review trustworthy.",
      title: isGood ? "Strong Self-Awareness Detected" : "Your Trade Evaluation Needs Calibration",
      insight: isGood
        ? `You correctly evaluate ${score}% of your own trades — a strong self-awareness score.`
        : `You correctly evaluate only ${score}% of your own trades — your self-assessment diverges from your execution quality.`,
      evidence: `${sa.trackedCount} evaluated trades · Accuracy by tier — ${catText}`,
      recommendation: isGood
        ? "Your self-awareness is an asset. Keep rating every trade honestly to maintain this calibration."
        : `After each trade, compare your rating to the system's quality assessment. Focus especially on ${worstJudgedCategory || "Average"} trades.`,
    }));
  }

  // 2. Outcome bias
  if (overconfident >= 3) {
    const pct = perCategory?.Great?.total
      ? Math.round((overconfident / perCategory.Great.total) * 100)
      : 0;
    results.push(makeInsight({
      id: makeId(CATEGORY.SELF_AWARENESS, "outcome-bias"),
      category: CATEGORY.SELF_AWARENESS,
      type: "negative",
      impactScore: 50,
      title: "Outcome Bias Detected in Your Trade Ratings",
      insight: `You rated ${overconfident} trades as "Great" based on outcome, not execution quality. ${pct > 0 ? `That's ${pct}% of your self-rated Great trades.` : ""}`,
      evidence: `${overconfident} outcome-biased ratings detected (profitable trades over-rated for execution quality)`,
      recommendation: "Rate your trade BEFORE you see the P&L. Judge the process, not the result. The market can reward bad trades temporarily.",
    }));
  }

  // 3. Best judged category (positive)
  if (bestJudgedCategory && perCategory?.[bestJudgedCategory]) {
    const cat = perCategory[bestJudgedCategory];
    if (cat.total >= 3 && cat.accuracy >= 70) {
      results.push(makeInsight({
        id: makeId(CATEGORY.IMPROVEMENT, `sa-best-${bestJudgedCategory}`),
        category: CATEGORY.IMPROVEMENT,
        type: "positive",
        impactScore: 20,
        title: `You Excel at Identifying "${bestJudgedCategory}" Trades`,
        insight: `You correctly rate "${bestJudgedCategory}" trades with ${cat.accuracy}% accuracy — a genuine self-awareness strength.`,
        evidence: `${cat.correct} correct out of ${cat.total} "${bestJudgedCategory}" trades rated`,
        recommendation: "Use this calibrated awareness as an anchor. When you sense a Great trade, trust that judgment.",
      }));
    }
  }

  // 4. Worst judged category (actionable)
  if (worstJudgedCategory && bestJudgedCategory !== worstJudgedCategory && perCategory?.[worstJudgedCategory]) {
    const cat = perCategory[worstJudgedCategory];
    if (cat.total >= 3 && cat.accuracy < 50) {
      results.push(makeInsight({
        id: makeId(CATEGORY.SELF_AWARENESS, `sa-worst-${worstJudgedCategory}`),
        category: CATEGORY.SELF_AWARENESS,
        type: "negative",
        impactScore: 35,
        title: `"${worstJudgedCategory}" Trades Are Hardest for You to Evaluate`,
        insight: `You correctly rate "${worstJudgedCategory}" trades with only ${cat.accuracy}% accuracy — your biggest self-awareness blind spot.`,
        evidence: `${cat.correct} correct out of ${cat.total} "${worstJudgedCategory}" trades rated`,
        recommendation: `When rating a trade as "${worstJudgedCategory}", cross-check: Does it actually meet your setup criteria? Your data shows you often misjudge this tier.`,
      }));
    }
  }

  // 5. First narrative pattern as an insight (if impactful)
  if (Array.isArray(saPatterns) && saPatterns.length > 0 && typeof saPatterns[0] === "string") {
    results.push(makeInsight({
      id: makeId(CATEGORY.SELF_AWARENESS, "narrative-pattern"),
      category: CATEGORY.SELF_AWARENESS,
      type: "neutral",
      impactScore: 15,
      title: "Self-Awareness Pattern Identified",
      insight: saPatterns[0],
      evidence: `Based on ${sa.trackedCount} evaluated trades`,
      recommendation: "Continue logging and rating every trade. Consistent evaluation reveals patterns that are invisible without data.",
    }));
  }

  return results;
}

// ── Generator: Discipline DNA ─────────────────────────────────────────────────

function insightsFromDiscipline(disciplineDNA, currency, totalVolume) {
  const results = [];
  if (!disciplineDNA) return results;

  const {
    strongestRule, weakestRule,
    bestSetupRange, worstSetupRange,
    avgSetupScore, avgDisciplineScore,
  } = disciplineDNA;

  // 1. Overall discipline score (low → warning, high → positive)
  if (typeof avgDisciplineScore === "number") {
    if (avgDisciplineScore < 50) {
      results.push(makeInsight({
        id: makeId(CATEGORY.DISCIPLINE, "avg-discipline-low"),
        category: CATEGORY.DISCIPLINE,
        type: "negative",
        impactScore: 60,
        title: "You're Following Less Than Half Your Setup Rules",
        insight: `Your average rule compliance is ${avgDisciplineScore}% — meaning you skip more rules than you follow on most trades.`,
        evidence: `Average discipline score: ${avgDisciplineScore}% across all tracked trades`,
        recommendation: "Pick 2–3 non-negotiable rules and enforce them on every trade. Discipline compounds — small improvements in rule-following produce large P&L gains.",
      }));
    } else if (avgDisciplineScore >= 80) {
      results.push(makeInsight({
        id: makeId(CATEGORY.IMPROVEMENT, "avg-discipline-high"),
        category: CATEGORY.IMPROVEMENT,
        type: "positive",
        impactScore: 30,
        title: "Strong Rule Compliance: Your Process Is Consistent",
        insight: `You follow ${avgDisciplineScore}% of your setup rules on average — a strong indicator of process discipline.`,
        evidence: `Average discipline score: ${avgDisciplineScore}% across all tracked trades`,
        recommendation: "Maintain this discipline. When setups feel unclear, lean on your rules — they already reflect your highest-edge conditions.",
        whyItMatters: `Rule-following is the part of trading fully in your control, and at ${avgDisciplineScore}% your results are attributable to a process rather than to luck — which is what makes them worth reviewing at all.`,
        expectedOutcome: `Compliance holding near ${avgDisciplineScore}% as volume grows, so each review compares like with like instead of measuring a moving process.`,
      }));
    }
  }

  // 2. Weakest rule — most broken
  if (weakestRule && weakestRule.brokenCount >= 3) {
    const breakRate = 100 - weakestRule.followRate;
    results.push(makeInsight({
      id: makeId(CATEGORY.DISCIPLINE, `weak-rule-${weakestRule.name}`),
      category: CATEGORY.DISCIPLINE,
      type: "negative",
      impactScore: Math.min(80, 20 + weakestRule.brokenCount * 4),
      title: `"${weakestRule.name}" Is Your Most Violated Rule`,
      insight: `You break the "${weakestRule.name}" rule ${weakestRule.brokenCount} times (${breakRate}% violation rate) — your worst compliance record.`,
      evidence: `${weakestRule.brokenCount} violations · ${weakestRule.followedCount} followed · Follow rate: ${weakestRule.followRate}% · Data confidence: ${weakestRule.confidence}`,
      recommendation: `Add "${weakestRule.name}" to the top of your pre-trade checklist. Treat it as a hard stop, not a guideline. Every violation has a cost.`,
    }));
  }

  // 3. Strongest rule — positive reinforcement
  if (strongestRule && strongestRule.followedCount >= 5 && strongestRule.followRate >= 80) {
    results.push(makeInsight({
      id: makeId(CATEGORY.IMPROVEMENT, `strong-rule-${strongestRule.name}`),
      category: CATEGORY.IMPROVEMENT,
      type: "positive",
      impactScore: 20,
      title: `"${strongestRule.name}" Is Your Most Consistent Rule`,
      insight: `You follow the "${strongestRule.name}" rule ${strongestRule.followRate}% of the time — your strongest process habit.`,
      evidence: `${strongestRule.followedCount} followed · ${strongestRule.brokenCount} broken · Follow rate: ${strongestRule.followRate}%`,
      recommendation: `Apply the same consistency you have with "${strongestRule.name}" to your weaker rules. Your data proves you can build strong habits.`,
    }));
  }

  // 4. Best setup score range (positive)
  if (bestSetupRange && bestSetupRange.netPnL > MIN_PNL_THRESHOLD && bestSetupRange.trades >= MIN_TRADES) {
    results.push(makeInsight({
      id: makeId(CATEGORY.TRADING_DNA, `setup-range-best-${bestSetupRange.name}`),
      category: CATEGORY.TRADING_DNA,
      type: "positive",
      impactScore: impactFromPnl(bestSetupRange.netPnL, totalVolume),
      title: `High-Quality Setups (${bestSetupRange.name}) Are Your Most Profitable`,
      insight: `Trades in the "${bestSetupRange.name}" setup score range generate ${formatAmount(bestSetupRange.netPnL, currency)} with a ${bestSetupRange.winRate}% win rate.`,
      evidence: `${bestSetupRange.trades} trades · Win rate: ${bestSetupRange.winRate}% · Avg P&L: ${signedAmount(bestSetupRange.avgPnL, currency)} · Confidence: ${bestSetupRange.confidence}`,
      // Same rule as the session card: only assert that lower ranges
      // underperform when a lower range actually cleared the sample floor and
      // lost money. The discipline chart already greys out ranges with fewer
      // than 3 trades as "not enough data" — this card must not contradict it.
      recommendation: (() => {
        const w = worstSetupRange;
        const comparable = w && w.name !== bestSetupRange.name && w.netPnL < 0 && w.trades >= MIN_TRADES;
        return comparable
          ? `Favour the ${bestSetupRange.name} range. ${w.name} is running at ${formatAmount(w.netPnL, currency)} across ${w.trades} trades.`
          : `Keep taking setups in the ${bestSetupRange.name} range. No lower score range has enough tracked trades yet to compare against.`;
      })(),
    }));
  }

  // 5. Worst setup score range (warning)
  if (worstSetupRange && worstSetupRange.netPnL < -MIN_PNL_THRESHOLD && worstSetupRange.trades >= MIN_TRADES) {
    results.push(makeInsight({
      id: makeId(CATEGORY.DISCIPLINE, `setup-range-worst-${worstSetupRange.name}`),
      category: CATEGORY.DISCIPLINE,
      type: "negative",
      impactScore: impactFromPnl(worstSetupRange.netPnL, totalVolume),
      title: `Low-Quality Setups (${worstSetupRange.name}) Are Draining Your Account`,
      insight: `Trades in the "${worstSetupRange.name}" setup score range cost you ${formatAmount(Math.abs(worstSetupRange.netPnL), currency)} with only a ${worstSetupRange.winRate}% win rate.`,
      evidence: `${worstSetupRange.trades} trades · Win rate: ${worstSetupRange.winRate}% · Net P&L: ${signedAmount(worstSetupRange.netPnL, currency)}`,
      recommendation: `Set a minimum setup score threshold before entering. Trades below your floor are statistically losers — skip them even if they feel right.`,
    }));
  }

  // 6. Average setup score context
  if (typeof avgSetupScore === "number" && avgSetupScore < 60) {
    results.push(makeInsight({
      id: makeId(CATEGORY.DISCIPLINE, "avg-setup-score-low"),
      category: CATEGORY.DISCIPLINE,
      type: "negative",
      impactScore: 40,
      title: "Your Average Setup Quality Is Below Standard",
      insight: `Your average setup score is ${avgSetupScore}/100 — indicating you frequently enter below your own quality threshold.`,
      evidence: `Average setup score: ${avgSetupScore}/100`,
      recommendation: "Before every entry, score the setup against your rules. If it scores below 60, wait for a better opportunity.",
    }));
  }

  return results;
}

// ── Pattern recommendation helper ────────────────────────────────────────────

function patternRecommendation(description, module) {
  const desc = (description || "").toLowerCase();
  if (desc.includes("fomo"))        return "FOMO has no statistical edge. Wait for your full setup before entering.";
  if (desc.includes("revenge"))     return "Revenge trading amplifies losses. After any loss, take 30 minutes before re-entering.";
  if (desc.includes("overconfident")) return "Reduce position size when confidence is 9-10. Overconfidence statistically predicts underperformance.";
  if (desc.includes("loss streak")) return "After consecutive losses, mandatory break and review before the next trade.";
  if (module === "dayOfWeek")       return "Consider reducing size on this day or investigating what makes it consistently underperform.";
  if (module === "session")         return "Either avoid this session or reduce lot size until you understand its underperformance.";
  if (module === "emotion")         return "This emotional state is costing you money. Use it as a stop signal, not an entry signal.";
  return "When this pattern occurs, reduce exposure and review before proceeding.";
}

// ── Deduplication ─────────────────────────────────────────────────────────────

function deduplicateById(insights) {
  const seen = new Set();
  return insights.filter(i => {
    if (seen.has(i.id)) return false;
    seen.add(i.id);
    return true;
  });
}

/**
 * Drop cards that describe the same underlying set of trades.
 *
 * Several engines can land on one cohort from different angles. A trader whose
 * "Disciplined" tag always coincides with Medium confidence produced four
 * separate cards — emotion, behavioural pattern, combination, and ranking — all
 * reporting the identical 6 trades / 66.7% / +$416. That is a quarter of the
 * feed repeating one finding, and it inflates the positive count so a single
 * edge looks four times better corroborated than it is.
 *
 * Only cards that opt in by passing `cohort` are considered; anything without
 * one is always kept, so this can never silently swallow a distinct insight.
 * Within a group the highest-impact card survives.
 */
function deduplicateByCohort(insights) {
  const bestByCohort = new Map();
  for (const i of insights) {
    if (!i._cohort) continue;
    const prev = bestByCohort.get(i._cohort);
    if (!prev || i.impactScore > prev.impactScore) bestByCohort.set(i._cohort, i);
  }
  return insights.filter(i => !i._cohort || bestByCohort.get(i._cohort) === i);
}

// ── Balance positive/negative 70/30 ──────────────────────────────────────────

function balanceFeed(insights) {
  const negatives = insights
    .filter(i => i.type === "negative")
    .sort((a, b) => b.impactScore - a.impactScore);
  const positives = insights
    .filter(i => i.type === "positive")
    .sort((a, b) => b.impactScore - a.impactScore);
  const neutrals = insights
    .filter(i => i.type === "neutral")
    .sort((a, b) => b.impactScore - a.impactScore);

  // Interleave: 2 coaching + 1 positive reinforcement
  const balanced = [];
  let ni = 0, pi = 0;
  while (ni < negatives.length || pi < positives.length) {
    if (ni < negatives.length) balanced.push(negatives[ni++]);
    if (ni < negatives.length) balanced.push(negatives[ni++]);
    if (pi < positives.length) balanced.push(positives[pi++]);
  }

  // Append neutrals at the end
  balanced.push(...neutrals);

  return balanced;
}

// ── Main Export ───────────────────────────────────────────────────────────────

/**
 * generateCoachFeed
 *
 * @param {object} options
 * @param {object|null} options.psychologyCost   computePsychologyCost() output
 * @param {object|null} options.tradingDNA       computeTradingDNA() output
 * @param {object|null} options.patterns         computePatternDetection() output
 * @param {object|null} options.selfAwareness    computeSelfAwarenessAnalytics() output
 * @param {number}      options.totalTrades      raw count
 * @param {number}      options.totalVolume      sum of |profit| for impact normalization
 * @param {string}      options.marketType       "Forex" | "Indian_Market"
 * @returns {object} Feed result
 */
function generateCoachFeed({ psychologyCost, tradingDNA, patterns, selfAwareness, totalTrades, totalVolume, marketType } = {}) {
  const currency = marketType === "Indian_Market" ? "₹" : "$";
  const vol = Math.max(1, totalVolume || 0);
  const count = totalTrades || 0;

  if (count === 0) {
    return {
      insufficient: true,
      reason: "no_trades",
      message: "No trades yet. Start journaling to receive personalized coaching.",
      insights: [],
      stats: { total: 0, negative: 0, positive: 0, neutral: 0 },
      generatedAt: new Date().toISOString(),
      marketType,
    };
  }

  if (count < 5) {
    return {
      insufficient: true,
      reason: "too_few_trades",
      message: `${count} trade${count === 1 ? "" : "s"} logged. Log at least 5 trades to unlock personalized coaching.`,
      insights: [],
      stats: { total: 0, negative: 0, positive: 0, neutral: 0 },
      generatedAt: new Date().toISOString(),
      marketType,
    };
  }

  // Collect insights from all engines
  let insights = [
    ...insightsFromPsychologyCost(psychologyCost, currency, vol),
    ...insightsFromTradingDNA(tradingDNA, currency, vol),
    ...insightsFromPatterns(patterns, currency, vol),
    ...insightsFromSelfAwareness(selfAwareness),
    ...insightsFromDiscipline(tradingDNA?.disciplineDNA, currency, vol),
  ];

  // Deduplicate — by id first, then by the trade cohort being described
  insights = deduplicateById(insights);
  insights = deduplicateByCohort(insights);

  // Filter out zero-impact
  insights = insights.filter(i => i.impactScore > 0);

  // Balance 70/30 negative/positive
  insights = balanceFeed(insights);

  // Drop the internal cohort marker so it never reaches API consumers
  insights = insights.map(({ _cohort, ...rest }) => rest);

  return {
    insufficient: false,
    generatedAt: new Date().toISOString(),
    marketType,
    totalTrades: count,
    insights,
    stats: {
      total: insights.length,
      negative: insights.filter(i => i.type === "negative").length,
      positive: insights.filter(i => i.type === "positive").length,
      neutral: insights.filter(i => i.type === "neutral").length,
    },
  };
}

module.exports = { generateCoachFeed, CATEGORY };
