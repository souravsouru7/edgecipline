/**
 * STRESS — ramp past the sustainable range until the system breaks.
 *
 * Thresholds here are informational (slack=3, never aborting) because the whole
 * point is to exceed the budget and observe HOW it fails: rising latency first,
 * or straight to errors and timeouts.
 *
 * Run:
 *   k6 run tests/performance/scenarios/stress.js
 *   STRESS_PEAK=300 k6 run tests/performance/scenarios/stress.js
 */

import { loadUsers, userForVU } from "../lib/config.js";
import { buildThresholds } from "../lib/thresholds.js";
import { runWeightedJourney } from "../lib/flows.js";

const users = loadUsers();
const PEAK = Number(__ENV.STRESS_PEAK || 300);
const STEP = __ENV.STRESS_STEP || "45s";

export const options = {
  scenarios: {
    stress: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: Math.round(PEAK * 0.17) },
        { duration: STEP, target: Math.round(PEAK * 0.17) },
        { duration: "30s", target: Math.round(PEAK * 0.33) },
        { duration: STEP, target: Math.round(PEAK * 0.33) },
        { duration: "30s", target: Math.round(PEAK * 0.5) },
        { duration: STEP, target: Math.round(PEAK * 0.5) },
        { duration: "30s", target: Math.round(PEAK * 0.75) },
        { duration: STEP, target: Math.round(PEAK * 0.75) },
        { duration: "30s", target: PEAK },
        { duration: STEP, target: PEAK },
        // Recovery observation: drop back to a known-good level and see whether
        // latency and error rate return to baseline.
        { duration: "20s", target: Math.round(PEAK * 0.17) },
        { duration: "45s", target: Math.round(PEAK * 0.17) },
      ],
      gracefulRampDown: "20s",
      gracefulStop: "30s",
    },
  },
  thresholds: buildThresholds({ errorPct: 1, slack: 3, abortOnFail: false }),
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
  discardResponseBodies: false,
};

export default function () {
  const user = userForVU(users, __VU);
  runWeightedJourney(user.token);
}
