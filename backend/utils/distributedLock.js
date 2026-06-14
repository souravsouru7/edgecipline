const crypto = require("crypto");
const { client: redis, isRedisReady } = require("../config/redis");
const { logger } = require("./logger");

// ─── Lock metrics (in-memory, exposable via admin endpoint) ──────────────────
const metrics = {
  acquired: 0,
  skipped:  0,
  released: 0,
  lost:     0,   // lock expired before release (TTL ran out mid-execution)
  extended: 0,
  failedReleases: 0,
  errors:   0,
};

function snapshotLockMetrics() {
  return { ...metrics };
}

// ─── Safe release script ─────────────────────────────────────────────────────
// Compares the stored value against our token before deleting. Prevents one
// process from releasing a lock that has already expired and been re-acquired
// by another process (Redlock-style guard, single-node variant).
const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

// Safe extension — only extends TTL if our token still owns the key.
// Returns 1 if extended, 0 if the lock was lost (token mismatch or expired).
const EXTEND_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("EXPIRE", KEYS[1], ARGV[2])
else
  return 0
end
`;

// ─── ISO date helpers used by callers ────────────────────────────────────────
function isoDateKey(date = new Date(), timezone = "UTC") {
  // YYYY-MM-DD in the specified timezone.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year:  "numeric",
    month: "2-digit",
    day:   "2-digit",
  }).format(date);
  return parts; // en-CA already returns YYYY-MM-DD
}

function isoWeekKey(date = new Date()) {
  // YYYY-Www per ISO 8601. Always computed in UTC for stability across nodes.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

function quarterHourKey(date = new Date(), timezone = "UTC") {
  // YYYY-MM-DDTHH:MM where MM is rounded down to the nearest 15.
  // Computed in the given timezone so locks align with the cron tick the user sees.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year:   "numeric",
    month:  "2-digit",
    day:    "2-digit",
    hour:   "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const v = {};
  for (const p of parts) if (p.type !== "literal") v[p.type] = p.value;
  const minute = Math.floor(Number(v.minute) / 15) * 15;
  return `${v.year}-${v.month}-${v.day}T${v.hour}:${String(minute).padStart(2, "0")}`;
}

// ─── Core API ────────────────────────────────────────────────────────────────
async function acquireLock(key, ttlSeconds) {
  if (!isRedisReady()) {
    // Fail-open: if Redis is unreachable, do NOT block the cron — there's no
    // second instance to race with if Redis is down anyway. Log so we notice.
    logger.warn("CRON_LOCK_REDIS_UNAVAILABLE", { key });
    return { acquired: true, token: null, degraded: true };
  }

  const token = crypto.randomBytes(16).toString("hex");
  try {
    const result = await redis.set(key, token, "NX", "EX", ttlSeconds);
    if (result === "OK") {
      metrics.acquired += 1;
      logger.info("CRON_LOCK_ACQUIRED", { key, ttlSeconds });
      return { acquired: true, token, degraded: false };
    }
    metrics.skipped += 1;
    logger.info("CRON_LOCK_EXISTS", { key });
    return { acquired: false, token: null, degraded: false };
  } catch (error) {
    metrics.errors += 1;
    logger.error("CRON_LOCK_ACQUIRE_ERROR", { key, error: error?.message });
    // Same fail-open rationale as Redis-down case.
    return { acquired: true, token: null, degraded: true };
  }
}

async function releaseLock(key, token) {
  if (!token) return false; // degraded acquisition — nothing to release.
  if (!isRedisReady()) {
    logger.warn("CRON_LOCK_RELEASE_SKIPPED_NO_REDIS", { key });
    return false;
  }
  try {
    const result = await redis.eval(RELEASE_SCRIPT, 1, key, token);
    const released = result === 1;
    if (released) {
      metrics.released += 1;
      logger.info("CRON_LOCK_RELEASED", { key });
    } else {
      // Lock no longer owned by us — TTL expired during execution and the
      // job ran longer than the lock window. Another instance may have
      // acquired the lock by now.
      metrics.lost += 1;
      metrics.failedReleases += 1;
      logger.error("CRON_LOCK_LOST", { key, reason: "token_mismatch_or_expired" });
    }
    return released;
  } catch (error) {
    metrics.errors += 1;
    logger.error("CRON_LOCK_RELEASE_ERROR", { key, error: error?.message });
    return false;
  }
}

/**
 * Extend an active lock. Use this when a long-running cron is approaching
 * its TTL and the work hasn't finished. The Lua script guarantees we only
 * extend if our token still owns the key — if the TTL already expired,
 * extension fails (CRON_LOCK_LOST emitted) and the caller should bail.
 *
 *   const ok = await extendLock(key, token, 3600);
 *   if (!ok) { return; }   // lock was lost; another instance may be running
 */
async function extendLock(key, token, ttlSeconds) {
  if (!token) return false;
  if (!isRedisReady()) {
    logger.warn("CRON_LOCK_EXTEND_SKIPPED_NO_REDIS", { key });
    return false;
  }
  try {
    const result = await redis.eval(EXTEND_SCRIPT, 1, key, token, String(ttlSeconds));
    if (result === 1) {
      metrics.extended += 1;
      logger.info("CRON_LOCK_EXTENDED", { key, ttlSeconds });
      return true;
    }
    metrics.lost += 1;
    logger.error("CRON_LOCK_LOST", { key, reason: "extend_after_expiry" });
    return false;
  } catch (error) {
    metrics.errors += 1;
    logger.error("CRON_LOCK_EXTEND_ERROR", { key, error: error?.message });
    return false;
  }
}

/**
 * High-level helper used by cron entry points.
 *
 *   const result = await withCronLock(
 *     { name: "morning-mentor", lockSuffix: "2026-06-14", ttlSeconds: 7200 },
 *     async () => runMorningMentorJob()
 *   );
 *   // result.skipped === true  → another instance is holding the lock
 *   // result.acquired === true → fn ran (result.result holds fn's return value)
 *
 * Lock expiry guarantees the lock self-clears even if the process crashes
 * while holding it — pick ttlSeconds > max expected runtime, with headroom.
 */
async function withCronLock({ name, lockSuffix, ttlSeconds }, fn) {
  if (!name || !lockSuffix || !ttlSeconds) {
    throw new Error("withCronLock requires { name, lockSuffix, ttlSeconds }");
  }
  const key = `cron:${name}:${lockSuffix}`;
  const { acquired, token, degraded } = await acquireLock(key, ttlSeconds);

  if (!acquired) {
    return { acquired: false, skipped: true, key };
  }

  try {
    const result = await fn();
    return { acquired: true, skipped: false, degraded, key, result };
  } finally {
    await releaseLock(key, token);
  }
}

module.exports = {
  acquireLock,
  releaseLock,
  extendLock,
  withCronLock,
  snapshotLockMetrics,
  isoDateKey,
  isoWeekKey,
  quarterHourKey,
};
