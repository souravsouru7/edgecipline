/**
 * AUTH LOAD — login throughput, measured in isolation.
 *
 * Kept separate from the authenticated-user scenarios on purpose. Login runs a
 * bcrypt comparison (intentionally CPU-expensive) plus two user saves and a
 * refresh-token insert, so folding it into the normal mix would distort every
 * other number. Real traffic is overwhelmingly already-authenticated requests.
 *
 * Requires the seeded shared password:
 *   TEST_PASSWORD='...' k6 run tests/performance/scenarios/auth-load.js
 *
 * NOTE: with production rate limits this scenario is expected to return 429 —
 * authRateLimiter allows 5 attempts/min. Run the server in relaxed mode to
 * measure raw login capacity.
 */

import http from "k6/http";
import { check } from "k6";
import { BASE_URL, loadUsers, userForVU, TEST_PASSWORD, ENDPOINT_CLASS } from "../lib/config.js";
import { record } from "../lib/metrics.js";
import { buildThresholds } from "../lib/thresholds.js";

const users = loadUsers();

export const options = {
  scenarios: {
    auth: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "15s", target: Number(__ENV.TARGET_VUS || 10) },
        { duration: __ENV.DURATION || "45s", target: Number(__ENV.TARGET_VUS || 10) },
      ],
      gracefulRampDown: "15s",
    },
  },
  thresholds: buildThresholds({ errorPct: 0.02, slack: 2 }),
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
};

export default function () {
  if (!TEST_PASSWORD) {
    throw new Error("TEST_PASSWORD is required for the auth-load scenario.");
  }

  const user = userForVU(users, __VU);

  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: user.email, password: TEST_PASSWORD }),
    {
      headers: { "Content-Type": "application/json" },
      tags: { name: "POST /auth/login", endpoint_class: ENDPOINT_CLASS.LOGIN },
      timeout: "30s",
    }
  );

  record(res, ENDPOINT_CLASS.LOGIN);
  check(res, {
    "login succeeded or was rate limited": (r) => r.status === 200 || r.status === 429,
    "login returned a token": (r) => {
      if (r.status !== 200) return true; // not applicable
      try {
        return Boolean(r.json()?.data?.token);
      } catch (_) {
        return false;
      }
    },
  });
}
