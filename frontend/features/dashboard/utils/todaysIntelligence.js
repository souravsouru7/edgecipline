
/**
 * Today's Intelligence — derivation of the four dashboard insight tiles.
 *
 * The dashboard snapshot ships the whole Trading DNA / Psychology Cost /
 * Self-Awareness payload, but the card used to read only three narrow fields
 * (sessionDNA.best, instrumentDNA.best, emotionDNA.mostProfitable) and derived
 * three of its four tiles from one variable. The result was a card that never
 * changed: "Biggest Strength" sat on its fallback string forever and the
 * recommendation only ever restated the leak.
 *
 * This module reads every dimension the backend already computes, ranks the
 * candidates the same way the backend ranks patterns (|netPnL| weighted by
 * sample confidence, deterministic tie-break), and hands each tile a *different*
 * source so the four lines carry four distinct facts.
 */

// Same weighting the backend uses in rankAllPatterns() so the dashboard and the
// Intelligence hub agree on what "biggest" means.
const CONFIDENCE_WEIGHT = { Low: 1, Medium: 2, High: 3 };

function impactScore(candidate) {
  return Math.abs(num(candidate.netPnL)) * (CONFIDENCE_WEIGHT[candidate.confidence] || 1);
}

function num(value) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function makeMoney(currencySymbol) {
  return (value) => {
    const v = num(value);
    return `${v >= 0 ? "+" : "-"}${currencySymbol}${Math.abs(v).toFixed(2)}`;
  };
}

// Buckets (session/pair/day/mood/confidence/setup-range) expose `netPnL`;
// pattern and combination entries expose `netPnl`. Read both.
function bucketPnl(entry) {
  return num(entry?.netPnL ?? entry?.netPnl ?? entry?.cost ?? entry?.profit);
}

function sampleOf(entry) {
  return entry?.count ?? entry?.trades ?? entry?.total ?? null;
}

function labelOf(entry) {
  return entry?.name || entry?.label || entry?.description || entry?.rule || entry?.range || null;
}

/**
 * Picks the highest-impact candidate, skipping any whose source another tile
 * already claimed. `priority` lets a purpose-built backend ranking (e.g.
 * psychologyCost.topLeaks, which is already sorted by cost) outrank a generic
 * bucket that merely happens to carry a bigger absolute number.
 */
function pickCandidate(candidates, used) {
  const eligible = candidates.filter((c) => c && c.text && !used.has(c.source));
  if (eligible.length === 0) return null;

  const [best] = [...eligible].sort(
    (a, b) =>
      (b.priority || 0) - (a.priority || 0) ||
      impactScore(b) - impactScore(a) ||
      a.text.localeCompare(b.text)
  );
  used.add(best.source);
  return best;
}

// ── Strength candidates ──────────────────────────────────────────────────────

/**
 * Every positive-P&L edge the snapshot knows about. A bucket only reaches this
 * list if the backend gave it a confidence level (>= 5 trades), so nothing here
 * is noise from a single lucky trade.
 */
function strengthCandidates(tradingDNA, money) {
  const dna = tradingDNA || {};
  const enrichment = dna.patternEnrichment || {};
  const out = [];

  const push = (source, entry, buildText) => {
    if (!entry) return;
    const netPnL = bucketPnl(entry);
    if (netPnL <= 0) return; // never sell a losing bucket as a strength
    const text = buildText(entry, netPnL);
    if (!text) return;
    // `label` is kept alongside the composed text so the recommendation tile can
    // name the strength instead of pointing at it positionally.
    out.push({ source, text, netPnL, confidence: entry.confidence, label: labelOf(entry) });
  };

  const withRate = (entry, netPnL) => {
    const rate = entry.winRate != null ? ` at ${Math.round(num(entry.winRate))}% win rate` : "";
    const sample = sampleOf(entry);
    const over = sample ? ` over ${sample} trades` : "";
    return `${money(netPnL)}${rate}${over}.`;
  };

  for (const pattern of enrichment.topPositivePatterns || []) {
    push("pattern", pattern, (entry, netPnL) => {
      const label = labelOf(entry);
      return label ? `${label} — ${withRate(entry, netPnL)}` : null;
    });
  }

  push("combination", dna.behavioralDNA?.mostProfitableCombination, (entry, netPnL) => {
    const label = labelOf(entry);
    return label ? `${label} — ${withRate(entry, netPnL)}` : null;
  });

  push("session", dna.sessionDNA?.best, (entry, netPnL) =>
    `${labelOf(entry)} session — ${withRate(entry, netPnL)}`);

  push("instrument", dna.instrumentDNA?.best, (entry, netPnL) =>
    `${labelOf(entry)} — ${withRate(entry, netPnL)}`);

  push("style", dna.styleDNA?.best, (entry, netPnL) =>
    `${labelOf(entry)} trades — ${withRate(entry, netPnL)}`);

  push("day", dna.dayDNA?.best, (entry, netPnL) =>
    `${labelOf(entry)}s — ${withRate(entry, netPnL)}`);

  push("setupScore", dna.disciplineDNA?.bestSetupRange, (entry, netPnL) =>
    `Setup score ${labelOf(entry)} — ${withRate(entry, netPnL)}`);

  push("confidence", dna.confidenceDNA?.best, (entry, netPnL) =>
    `${labelOf(entry)} confidence entries — ${withRate(entry, netPnL)}`);

  push("mood", dna.moodDNA?.best, (entry, netPnL) =>
    `Trading at mood ${labelOf(entry)} — ${withRate(entry, netPnL)}`);

  push("emotion", dna.emotionDNA?.mostProfitable, (entry, netPnL) =>
    `${labelOf(entry)} entries — ${withRate(entry, netPnL)}`);

  return out;
}

/**
 * Discipline fallback: when P&L is negative everywhere there is still a real,
 * non-generic strength to report — the rule the trader actually keeps.
 */
function disciplineStrength(tradingDNA) {
  const rule = tradingDNA?.disciplineDNA?.strongestRule;
  if (!rule?.name || num(rule.followRate) < 70 || num(rule.total) < 5) return null;
  return `You follow "${rule.name}" on ${Math.round(num(rule.followRate))}% of ${rule.total} trades — that consistency is your base to build on.`;
}

// ── Leak candidates ──────────────────────────────────────────────────────────

function leakCandidates(tradingDNA, psychologyCost, money) {
  const dna = tradingDNA || {};
  const cost = psychologyCost || {};
  const out = [];

  const push = (source, entry, buildText, priority = 0) => {
    if (!entry) return;
    const netPnL = bucketPnl(entry);
    if (netPnL >= 0) return;
    const text = buildText(entry, netPnL);
    if (text) out.push({ source, text, netPnL, confidence: entry.confidence, priority });
  };

  // topLeaks is the backend's dedicated leak engine and arrives already ranked
  // by cost, so it outranks the generic buckets below rather than competing on
  // raw netPnL (leak entries carry no confidence level to weight by).
  const topLeak = (cost.topLeaks || [])[0];
  push("leak", topLeak, (entry, netPnL) => {
    const label = labelOf(entry) || entry.type;
    if (!label) return null;
    const sample = sampleOf(entry);
    const share = entry.impactPct ? ` — ${entry.impactPct}% of total losses` : "";
    return `${label} (${money(netPnL)}${sample ? ` across ${sample} trades` : ""})${share}.`;
  }, 1);

  // NOTE: these are the real field names. The card previously fell back to
  // psychologyCost.costliestMistake / .costliestEmotion, which the API has
  // never returned — a fallback that could never fire.
  push("expensiveEmotion", cost.behavioralDNA?.mostExpensiveEmotion, (entry, netPnL) =>
    `${labelOf(entry)} entries are costing you ${money(netPnL)}.`);

  push("expensiveMistake", cost.behavioralDNA?.mostExpensiveMistake, (entry, netPnL) =>
    `${labelOf(entry)} is your costliest repeated mistake (${money(netPnL)}).`);

  push("mistake", dna.mistakeDNA?.mostExpensive, (entry, netPnL) =>
    `${labelOf(entry)} (${money(netPnL)}${sampleOf(entry) ? ` across ${sampleOf(entry)} trades` : ""}).`);

  push("worstPattern", dna.patternEnrichment?.worstPattern, (entry, netPnL) =>
    `${labelOf(entry)} — ${money(netPnL)}${entry.winRate != null ? ` at only ${Math.round(num(entry.winRate))}% win rate` : ""}.`);

  push("worstSession", dna.sessionDNA?.worst, (entry, netPnL) =>
    `${labelOf(entry)} session is draining ${money(netPnL)}.`);

  return out;
}

// ── Focus candidates ─────────────────────────────────────────────────────────

/** What to work on next — scored so the highest-cost gap wins. */
function focusCandidates(tradingDNA, selfAwareness, money) {
  const dna = tradingDNA || {};
  const out = [];

  const weakRule = dna.disciplineDNA?.weakestRule;
  if (weakRule?.name && num(weakRule.followRate) < 80 && num(weakRule.total) >= 5) {
    out.push({
      source: "weakestRule",
      text: `"${weakRule.name}" is followed on only ${Math.round(num(weakRule.followRate))}% of ${weakRule.total} trades. Close that gap first.`,
      netPnL: num(weakRule.brokenCount) * 10, // ranked by how often it is broken
      confidence: weakRule.confidence,
    });
  }

  const worstRange = dna.disciplineDNA?.worstSetupRange;
  if (worstRange && bucketPnl(worstRange) < 0) {
    out.push({
      source: "worstSetupRange",
      text: `Setups scoring ${labelOf(worstRange)} lose ${money(bucketPnl(worstRange))}. Skip entries below that bar.`,
      netPnL: bucketPnl(worstRange),
      confidence: worstRange.confidence,
    });
  }

  const worstConfidence = dna.confidenceDNA?.worst;
  if (worstConfidence && bucketPnl(worstConfidence) < 0) {
    out.push({
      source: "worstConfidence",
      text: `${labelOf(worstConfidence)}-confidence entries are net ${money(bucketPnl(worstConfidence))}. Size them down or skip them.`,
      netPnL: bucketPnl(worstConfidence),
      confidence: worstConfidence.confidence,
    });
  }

  const worstMood = dna.moodDNA?.worst;
  if (worstMood && bucketPnl(worstMood) < 0) {
    out.push({
      source: "worstMood",
      text: `Trading at mood ${labelOf(worstMood)} costs ${money(bucketPnl(worstMood))}. Make that a no-trade state.`,
      netPnL: bucketPnl(worstMood),
      confidence: worstMood.confidence,
    });
  }

  const score = selfAwareness?.score;
  if (score != null && num(selfAwareness?.trackedCount) >= 5) {
    out.push({
      source: "selfAwareness",
      text: num(score) >= 70
        ? `${score}% review calibration across ${selfAwareness.trackedCount} reviews. Protect review quality before increasing risk.`
        : `${score}% review calibration across ${selfAwareness.trackedCount} reviews. Tighten post-trade honesty before adding size.`,
      netPnL: (100 - num(score)) * 5, // a worse score ranks higher
      confidence: num(selfAwareness.trackedCount) >= 30 ? "High" : num(selfAwareness.trackedCount) >= 10 ? "Medium" : "Low",
    });
  }

  return out;
}

// ── Recommendation candidates ────────────────────────────────────────────────

/** One concrete thing to do before the next trade. */
function recommendationCandidates(tradingDNA, psychologyCost, strength, money) {
  const dna = tradingDNA || {};
  const enrichment = dna.patternEnrichment || {};
  const out = [];

  const risk = dna.behavioralDNA?.overconfidenceRisk;
  if (risk?.insight) {
    out.push({ source: "overconfidence", text: `${risk.insight} Cut size after a win streak instead of pressing.`, netPnL: 250, confidence: "High" });
  }

  if (enrichment.lossStreakWarning) {
    out.push({ source: "lossStreak", text: `${enrichment.lossStreakWarning} Set a hard stop-for-the-day rule after consecutive losses.`, netPnL: 220, confidence: "High" });
  }

  const optimalSetup = enrichment.optimalSetupScoreRange;
  if (optimalSetup) {
    const threshold = optimalSetup.range || optimalSetup.threshold || labelOf(optimalSetup);
    if (threshold) {
      out.push({ source: "setupThreshold", text: `Your edge concentrates at setup score ${threshold}. Make that your minimum entry bar.`, netPnL: 200, confidence: optimalSetup.confidence || "Medium" });
    }
  }

  const optimalConfidence = enrichment.optimalConfidenceRange;
  if (optimalConfidence) {
    const range = optimalConfidence.range || labelOf(optimalConfidence);
    if (range) {
      out.push({ source: "confidenceBand", text: `Take entries in your ${range} confidence band and pass on the rest.`, netPnL: 180, confidence: optimalConfidence.confidence || "Medium" });
    }
  }

  const dangerous = dna.behavioralDNA?.mostDangerousCombination;
  if (dangerous && bucketPnl(dangerous) < 0) {
    out.push({ source: "dangerousCombo", text: `Add a hard guardrail for "${labelOf(dangerous)}" — it is your worst combination at ${money(bucketPnl(dangerous))}.`, netPnL: bucketPnl(dangerous), confidence: dangerous.confidence });
  }

  // Shares the "weakestRule" source with the focus tile on purpose — the same
  // rule must not be reported twice on one card under two headings.
  const weakRule = dna.disciplineDNA?.weakestRule;
  if (weakRule?.name && num(weakRule.brokenCount) > 0) {
    out.push({ source: "weakestRule", text: `Before the next entry, re-read "${weakRule.name}" — you have broken it ${weakRule.brokenCount} times.`, netPnL: num(weakRule.brokenCount) * 15, confidence: weakRule.confidence });
  }

  const secondLeak = (psychologyCost?.topLeaks || [])[1];
  if (secondLeak) {
    out.push({ source: "secondLeak", text: `Add one pre-trade guardrail for ${labelOf(secondLeak) || secondLeak.type} (${money(bucketPnl(secondLeak))}).`, netPnL: bucketPnl(secondLeak), confidence: secondLeak.confidence });
  }

  if (strength) {
    // Name the strength. "The condition above" resolved to whatever tile
    // happened to render directly above this one — which is the Focus tile, so
    // the card was telling the trader to repeat the very thing Focus had just
    // told them to skip.
    const named = strength.label ? `"${strength.label}"` : "your strongest condition";
    out.push({
      source: "protectStrength",
      text: `Repeat ${named} and skip entries that do not match it.`,
      netPnL: 120,
      confidence: "Medium",
    });
  }

  return out;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * @param {object}  args
 * @param {object}  args.tradingDNA       snapshot.tradingDNA
 * @param {object}  args.psychologyCost   snapshot.psychologyCost
 * @param {object}  args.selfAwareness    snapshot.selfAwareness
 * @param {number}  args.totalTrades      logged trade count (for honest empty copy)
 * @param {string}  args.currencySymbol
 * @returns {{ strength: string, leak: string, focus: string, recommendation: string, coachInsight: string, sampleLabel: string }}
 */
export function buildTodaysIntelligence({
  tradingDNA,
  psychologyCost,
  selfAwareness,
  totalTrades = 0,
  currencySymbol = "$",
} = {}) {
  const money = makeMoney(currencySymbol);
  const used = new Set();

  const sample = num(tradingDNA?.totalTrades) || num(totalTrades);
  const sampleLabel = sample > 0
    ? `From ${sample} logged trade${sample === 1 ? "" : "s"}`
    : "Waiting on your first logged trade";

  // Strength first — the recommendation may reference it.
  const strengthPick = pickCandidate(strengthCandidates(tradingDNA, money), used);
  const strength =
    strengthPick?.text ||
    disciplineStrength(tradingDNA) ||
    (sample < 5
      ? `Log ${Math.max(1, 5 - sample)} more trade${5 - sample === 1 ? "" : "s"} to unlock your strongest repeatable condition.`
      : "No condition is net profitable yet. Tag session, setup score, and emotion on every trade so a real edge can surface.");

  const leakPick = pickCandidate(leakCandidates(tradingDNA, psychologyCost, money), used);
  const leak =
    leakPick?.text ||
    (sample < 5
      ? "Leak detection needs at least 5 tagged trades."
      : "No dominant behavioral leak detected yet — keep tagging emotions, mistakes, and broken rules.");

  const focusPick = pickCandidate(focusCandidates(tradingDNA, selfAwareness, money), used);
  const focus =
    focusPick?.text ||
    (selfAwareness?.score != null
      ? `${selfAwareness.score}% review calibration. Keep reviewing every trade honestly.`
      : "Add post-trade quality reviews to unlock a calibrated focus.");

  const recommendationPick = pickCandidate(
    recommendationCandidates(tradingDNA, psychologyCost, strengthPick, money),
    used
  );
  const recommendation =
    recommendationPick?.text ||
    tradingDNA?.dnaSummary?.tradingIdentity ||
    "Run the pre-trade checklist and log the trade fully — a clean sample is what unlocks the rest.";

  // The coach snapshot sits beside this card; give it the highest-impact fact
  // none of the four tiles already used so it is not a fifth restatement.
  const coachPick = pickCandidate(
    [
      ...leakCandidates(tradingDNA, psychologyCost, money),
      ...focusCandidates(tradingDNA, selfAwareness, money),
      ...recommendationCandidates(tradingDNA, psychologyCost, strengthPick, money),
    ],
    used
  );
  const coachInsight =
    coachPick?.text ||
    (sample >= 5
      ? "Your logged data is consistent right now — no single behavior is dominating your P&L."
      : "Edgecipline will show a stronger coaching cue once more psychology and setup data is logged.");

  return { strength, leak, focus, recommendation, coachInsight, sampleLabel };
}

export default buildTodaysIntelligence;
