/**
 * Central configuration for every k6 scenario.
 * Everything is driven by environment variables — no secrets in source.
 *
 *   BASE_URL       API root                (default http://127.0.0.1:5001)
 *   TEST_DATA      path to seeded users    (default ../.testdata/users.json)
 *   TARGET_VUS     VU count for the "step" scenario
 *   DURATION       hold time for the "step" scenario
 *   TEST_EMAIL     account for the login-path scenario
 *   TEST_PASSWORD  password for the login-path scenario
 *   THINK_MIN/MAX  think-time bounds in seconds
 */

export const BASE_URL = (__ENV.BASE_URL || "http://127.0.0.1:5001").replace(/\/+$/, "");

export const TARGET_VUS = Number(__ENV.TARGET_VUS || 10);
export const DURATION = __ENV.DURATION || "1m";
export const RAMP = __ENV.RAMP || "20s";

/**
 * WORKLOAD MODEL — what one VU represents.
 *
 * With these defaults a journey takes roughly 12–20 s wall clock, so one VU
 * issues about 15–25 requests per minute. That models a CONTINUOUSLY ACTIVE
 * user — someone with the app open, moving between screens without pause.
 *
 * A real user is far burstier and mostly idle: they open the app, look at the
 * dashboard, and put the phone down. One VU therefore stands for several real
 * registered users. The report translates between the two using measured
 * requests-per-VU rather than assuming VU == user.
 */
export const THINK_MIN = Number(__ENV.THINK_MIN || 2);
export const THINK_MAX = Number(__ENV.THINK_MAX || 6);

export const TEST_EMAIL = __ENV.TEST_EMAIL || "";
export const TEST_PASSWORD = __ENV.TEST_PASSWORD || "";

// Seeded accounts + pre-minted access tokens produced by seed-test-data.js.
// Loaded once in init context and shared across all VUs.
const TEST_DATA_PATH = __ENV.TEST_DATA || "../.testdata/users.json";

export function loadUsers() {
  const raw = open(TEST_DATA_PATH);
  const parsed = JSON.parse(raw);
  if (!parsed.users || parsed.users.length === 0) {
    throw new Error(`No seeded users in ${TEST_DATA_PATH}. Run seed-test-data.js first.`);
  }
  return parsed.users;
}

/** Distinct account per VU so we exercise per-user cache keys and rate-limit buckets. */
export function userForVU(users, vuId) {
  return users[(vuId - 1) % users.length];
}

export function authHeaders(token) {
  return {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Client-Platform": "k6-loadtest",
    },
  };
}

/**
 * Endpoint classes. Latency budgets differ by an order of magnitude between a
 * cached profile read and a cold multi-aggregation analytics build, so a single
 * global threshold would be meaningless.
 */
export const ENDPOINT_CLASS = {
  AUTH_LIGHT: "auth_light", // /auth/me — JWT verify + Redis-cached user
  SIMPLE_READ: "simple_read", // /setups, /streaks, /notifications
  LIST_READ: "list_read", // /trades — paginated Mongo query
  DASHBOARD: "dashboard", // /dashboard/snapshot — fan-out aggregate
  ANALYTICS: "analytics", // /analytics/* — heavy aggregation
  WRITE: "write", // POST /trades
  LOGIN: "login", // bcrypt + token issue
};
