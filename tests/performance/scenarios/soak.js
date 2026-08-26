/**
 * SOAK — sustained load over a longer window.
 *
 * Looks for problems that only appear with time: memory growth, connection-pool
 * exhaustion, Redis connection leaks, gradually climbing latency.
 *
 * Default is deliberately short (10 min) because this environment is a laptop
 * running the load generator, the API, MongoDB and Redis together. Lengthen it
 * on dedicated infrastructure.
 *
 * Run:
 *   SOAK_VUS=25 SOAK_DURATION=10m k6 run tests/performance/scenarios/soak.js
 */

import { loadUsers, userForVU } from "../lib/config.js";
import { buildThresholds } from "../lib/thresholds.js";
import { runWeightedJourney } from "../lib/flows.js";

const users = loadUsers();

export const options = {
  scenarios: {
    soak: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: Number(__ENV.SOAK_VUS || 25) },
        { duration: __ENV.SOAK_DURATION || "10m", target: Number(__ENV.SOAK_VUS || 25) },
        { duration: "30s", target: 0 },
      ],
      gracefulRampDown: "20s",
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
