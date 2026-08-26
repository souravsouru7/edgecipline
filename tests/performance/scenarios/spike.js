/**
 * SPIKE — sudden traffic surge, then back down.
 *
 * Shape: 10 VUs steady → jump to peak in 10 s → hold briefly → drop back to 10.
 * Measures whether the app survives a burst (push notification, market open)
 * and how quickly it recovers once the burst passes.
 *
 * Run:
 *   k6 run tests/performance/scenarios/spike.js
 *   SPIKE_PEAK=200 k6 run tests/performance/scenarios/spike.js
 */

import { loadUsers, userForVU } from "../lib/config.js";
import { buildThresholds } from "../lib/thresholds.js";
import { runWeightedJourney } from "../lib/flows.js";

const users = loadUsers();
const PEAK = Number(__ENV.SPIKE_PEAK || 150);
const BASE = Number(__ENV.SPIKE_BASE || 10);

export const options = {
  scenarios: {
    spike: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "20s", target: BASE }, // settle
        { duration: "30s", target: BASE }, // pre-spike reference
        { duration: "10s", target: PEAK }, // the spike
        { duration: "45s", target: PEAK }, // hold
        { duration: "10s", target: BASE }, // drop
        { duration: "60s", target: BASE }, // recovery window
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
