/**
 * BASELINE — 3 VUs, uncontended.
 *
 * Purpose: establish the best-case latency of every endpoint class and prove
 * the harness itself works (auth valid, payloads accepted, no 4xx from bad
 * test data). Every later result is compared against this.
 *
 * Run:
 *   k6 run tests/performance/scenarios/baseline.js
 */

import { loadUsers, userForVU } from "../lib/config.js";
import { buildThresholds } from "../lib/thresholds.js";
import { runWeightedJourney } from "../lib/flows.js";

const users = loadUsers();

export const options = {
  scenarios: {
    baseline: {
      executor: "constant-vus",
      vus: Number(__ENV.TARGET_VUS || 3),
      duration: __ENV.DURATION || "1m",
      gracefulStop: "20s",
    },
  },
  thresholds: buildThresholds({ errorPct: 0.01 }),
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
  discardResponseBodies: false,
};

export default function () {
  const user = userForVU(users, __VU);
  runWeightedJourney(user.token);
}
