/**
 * Shared rule-ranking helpers for the discipline pages (Forex + Indian market).
 *
 * The backend DNA module (disciplineAnalytics.computeDNAIntegration) only ranks
 * rules that clear its confidence floor of 5 observations. With a small journal
 * that can leave two rules qualifying, so its "weakest" comes back as a rule you
 * follow 83% of the time while rules sitting at 0% are filtered out entirely.
 *
 * These helpers rank across the full rule list and expose the sample size, so
 * every card can name the same rule and disclose how solid the number is.
 */

// How many times a rule has actually been logged, either way.
export const ruleSample = (r) => (r ? (r.timesFollowed || 0) + (r.timesBroken || 0) : 0);

// Below this, a follow rate is a flag to watch rather than a conclusion.
export const LOW_RULE_SAMPLE = 5;

// Ties break toward the larger sample, then alphabetically, so ordering is stable.
const byCompliance = (dir) => (a, b) =>
  ((a.compliancePct ?? 0) - (b.compliancePct ?? 0)) * dir ||
  ruleSample(b) - ruleSample(a) ||
  String(a.label || "").localeCompare(String(b.label || ""));

const ranked = (rules, dir) =>
  [...(rules || [])].filter((r) => r.compliancePct != null).sort(byCompliance(dir))[0] || null;

export const pickWeakestRule = (rules) => ranked(rules, 1);
export const pickStrongestRule = (rules) => ranked(rules, -1);
