/**
 * LOAD STEP — hold a fixed VU count and measure.
 *
 * This is the workhorse used to walk the capacity curve. One run per level,
 * so each level gets a clean, independently comparable summary rather than
 * one blended average across a ramp.
 *
 * Run:
 *   TARGET_VUS=25 DURATION=1m k6 run tests/performance/scenarios/load-step.js
 *
 * A short ramp-up avoids a thundering herd at t=0, which would otherwise
 * produce a latency spike unrelated to steady-state capacity.
 */

import { loadUsers, userForVU, TARGET_VUS, DURATION, RAMP } from "../lib/config.js";
import { buildThresholds } from "../lib/thresholds.js";
import { runWeightedJourney } from "../lib/flows.js";

const users = loadUsers();

export const options = {
  scenarios: {
    step: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: RAMP, target: TARGET_VUS },
        { duration: DURATION, target: TARGET_VUS },
      ],
      gracefulRampDown: "15s",
      gracefulStop: "30s",
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
