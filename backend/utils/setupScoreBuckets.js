"use strict";

/**
 * Canonical setup-score bucket boundaries.
 *
 * These edges previously lived in three modules with two different definitions:
 * patternDetection split at 0/41/61/81 while tradingDNA and disciplineAnalytics
 * split at 0/40/60/80. A trade scoring exactly 80 therefore landed in the top
 * bucket on the Trading DNA and Discipline screens but in the tier below on the
 * Pattern screen, so the same range reported different totals depending on which
 * page you opened — verified against live data as an 11-trade / +$134.98 bucket
 * on one screen and a 12-trade / +$55.78 bucket on another, the difference being
 * a single trade that scored exactly 80 and lost $79.20.
 *
 * Labels stay per-module because the screens word them differently; only the
 * boundaries are shared. `max` is exclusive.
 */
const SETUP_SCORE_BOUNDS = [
  { key: "poor",    min: 0,  max: 40  },
  { key: "low",     min: 40, max: 60  },
  { key: "average", min: 60, max: 80  },
  { key: "strong",  min: 80, max: 101 },
];

/**
 * Build a bucket list carrying module-specific labels on the shared boundaries.
 * @param {{poor: string, low: string, average: string, strong: string}} labels
 */
function withLabels(labels) {
  return SETUP_SCORE_BOUNDS.map((bound) => ({ ...bound, label: labels[bound.key] }));
}

/** Find the bucket for a score, or null when the score is not a usable number. */
function bucketFor(buckets, score) {
  if (typeof score !== "number" || !Number.isFinite(score)) return null;
  return buckets.find((b) => score >= b.min && score < b.max) || null;
}

module.exports = { SETUP_SCORE_BOUNDS, withLabels, bucketFor };
