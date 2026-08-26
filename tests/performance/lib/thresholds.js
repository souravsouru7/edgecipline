/**
 * Performance thresholds, documented and justified.
 *
 * Budgets are per endpoint CLASS, not global. They describe what the endpoint
 * does, so they stay meaningful as load changes:
 *
 *   auth_light   /auth/me                 JWT verify + Redis-cached user lookup.
 *                                         No aggregation. Should stay very fast.
 *   simple_read  /setups /streaks         One indexed Mongo query on a small
 *                /notifications           per-user collection.
 *   list_read    /trades?page=&limit=     Indexed paginated query + count.
 *   dashboard    /dashboard/snapshot      Fan-out: streaks + reflections +
 *                                         onboarding counts + analytics snapshot.
 *                                         Redis-cached for 90 s.
 *   analytics    /analytics/*             Multi-stage aggregation over the whole
 *                                         trade history. Cached 45–120 s.
 *   write        POST /trades             Validation + insert + cache-version bump.
 *   login        POST /auth/login         bcrypt compare (deliberately slow) +
 *                                         refresh-token issue + 2 user saves.
 *
 * p95 is the primary gate; p99 is set roughly 2–2.5x p95 to catch tail blowups
 * without failing on a single GC pause.
 *
 * Error budget: <1% non-429 failures. 429s are tracked separately because under
 * production rate limits they are correct behaviour, not a fault.
 */

export const LATENCY_BUDGET = {
  auth_light: { p95: 150, p99: 400 },
  simple_read: { p95: 300, p99: 700 },
  list_read: { p95: 500, p99: 1200 },
  dashboard: { p95: 800, p99: 2000 },
  analytics: { p95: 1000, p99: 2500 },
  write: { p95: 600, p99: 1500 },
  login: { p95: 1500, p99: 3000 },
};

/**
 * @param {object} opts
 * @param {number} opts.errorPct        max non-429 error rate (default 1%)
 * @param {number} opts.slack           multiplier on latency budgets; stress and
 *                                      spike runs deliberately exceed the budget,
 *                                      so their thresholds are informational.
 * @param {boolean} opts.abortOnFail    stop the run when a threshold breaks
 */
export function buildThresholds({ errorPct = 0.01, slack = 1, abortOnFail = false } = {}) {
  const t = {
    business_errors: [
      { threshold: `rate<${errorPct}`, abortOnFail },
    ],
    checks: [{ threshold: "rate>0.95", abortOnFail: false }],
    // Any 5xx at all is a defect worth surfacing; kept generous so a single
    // blip does not abort a long run.
    http_req_failed: [{ threshold: "rate<0.05", abortOnFail: false }],
  };

  for (const [cls, budget] of Object.entries(LATENCY_BUDGET)) {
    t[`lat_${cls}`] = [
      { threshold: `p(95)<${Math.round(budget.p95 * slack)}`, abortOnFail: false },
      { threshold: `p(99)<${Math.round(budget.p99 * slack)}`, abortOnFail: false },
    ];
  }

  return t;
}
