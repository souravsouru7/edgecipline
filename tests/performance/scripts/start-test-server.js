/**
 * Boots backend/server.js against ISOLATED infrastructure so load tests never
 * touch development data:
 *
 *   - MongoDB : stratedge_loadtest      (separate database, same local server)
 *   - Redis   : db index 3              (separate keyspace — cache + rate limits)
 *   - Port    : 5001                    (dev server can keep running on 5000)
 *
 * Background workers and cron jobs are disabled so the measurement reflects API
 * capacity rather than whatever a scheduled job happened to be doing. This also
 * mirrors production topology, where the OCR worker runs as its own process.
 *
 * The global rate limiter can be relaxed for capacity runs via
 * LOADTEST_RELAX_RATE_LIMIT=true. Leave it unset to measure the app exactly as
 * production users experience it.
 *
 * Usage:
 *   node tests/performance/scripts/start-test-server.js
 *   LOADTEST_RELAX_RATE_LIMIT=true node tests/performance/scripts/start-test-server.js
 */

const path = require("path");
const { spawn } = require("child_process");

const BACKEND_DIR = path.join(__dirname, "../../../backend");

const PORT = process.env.LOADTEST_PORT || "5001";
const MONGO_URI =
  process.env.LOADTEST_MONGO_URI || "mongodb://127.0.0.1:27017/stratedge_loadtest";
const REDIS_URL = process.env.LOADTEST_REDIS_URL || "redis://127.0.0.1:6379/3";
const RELAX = String(process.env.LOADTEST_RELAX_RATE_LIMIT || "").toLowerCase() === "true";

if (!/loadtest/i.test(MONGO_URI)) {
  console.error(
    `Refusing to start: LOADTEST_MONGO_URI database name must contain "loadtest".\n  Got: ${MONGO_URI}`
  );
  process.exit(1);
}

const env = {
  ...process.env,

  PORT,
  MONGO_URI,
  REDIS_URL,
  NODE_ENV: "development",

  // Quieter logs — morgan/winston at info level on every request is itself a
  // measurable cost and would otherwise be attributed to the API.
  LOG_LEVEL: process.env.LOADTEST_LOG_LEVEL || "warn",

  // Model production topology: workers are separate processes there.
  ENABLE_EMBEDDED_OCR_WORKER: "false",
  DISABLE_EMBEDDED_SMART_NOTIFICATION_WORKER: "true",

  // Scheduled jobs fire on wall-clock time and would randomly contaminate a
  // 60-second measurement window.
  ENABLE_DATA_CLEANUP_CRON: "false",
  ENABLE_WEEKLY_REPORTS_CRON: "false",
  ENABLE_SESSION_REMINDERS_CRON: "false",
  ENABLE_MORNING_MENTOR_CRON: "false",
  ENABLE_SUBSCRIPTION_EXPIRY_CRON: "false",
  ENABLE_SUBSCRIPTION_RESCUE_CRON: "false",
  ENABLE_STREAK_PROTECTOR_CRON: "false",
  ENABLE_REFLECTION_REMINDER_CRON: "false",

  // No Sentry traffic during load tests — it would add outbound HTTP per error.
  SENTRY_DSN: "",
};

if (RELAX) {
  // Capacity mode. The production default (100 requests / 15 min / user) caps a
  // single user at 0.11 req/s, which measures the rate limiter rather than the
  // server. Raising it lets us find where the *application* saturates.
  env.RATE_LIMIT_MAX_REQUESTS = process.env.LOADTEST_GLOBAL_MAX || "1000000";
  env.RATE_LIMIT_WINDOW_MS = "60000";
  env.PROFILE_RATE_LIMIT_MAX_REQUESTS = "1000000";
  env.STATUS_RATE_LIMIT_MAX_REQUESTS = "1000000";
  env.AUTH_RATE_LIMIT_MAX_REQUESTS = process.env.LOADTEST_AUTH_MAX || "1000000";
}

console.log("─".repeat(64));
console.log("  StratEdge API — load-test instance");
console.log("─".repeat(64));
console.log(`  Port          : ${PORT}`);
console.log(`  MongoDB       : ${MONGO_URI}`);
console.log(`  Redis         : ${REDIS_URL}`);
console.log(`  Rate limiting : ${RELAX ? "RELAXED (capacity mode)" : "PRODUCTION DEFAULTS"}`);
console.log(`  Workers/crons : disabled`);
console.log("─".repeat(64));

const child = spawn(process.execPath, ["server.js"], {
  cwd: BACKEND_DIR,
  env,
  stdio: "inherit",
});

child.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
