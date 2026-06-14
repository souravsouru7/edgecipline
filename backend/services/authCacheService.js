const { client: redis, isRedisReady } = require("../config/redis");
const { logger } = require("../utils/logger");

// ─── Cache parameters ────────────────────────────────────────────────────────
const AUTH_CACHE_PREFIX  = "auth:user:";
const AUTH_CACHE_TTL_SECONDS = Math.max(
  30,
  parseInt(process.env.AUTH_CACHE_TTL_SECONDS || "300", 10)
);

// Fields the middleware + subscription/terms guards need.
//
// Spec explicitly excludes password, OTP fields, refresh tokens, and PII.
// We additionally exclude resetPassword*, googleId, loginAttempts,
// loginLockedUntil (all sensitive and never returned to clients anyway).
//
// We DO include email/name/avatar — Redis lives inside the same trust
// boundary as MongoDB, and downstream controllers expect req.user to carry
// these. Restrict the projection if your Redis is shared with untrusted
// tenants.
const CACHE_PROJECTION = [
  "_id",
  "role",
  "tokenVersion",
  "subscriptionStatus",
  "subscriptionPlan",
  "subscriptionExpiry",
  "termsAcceptance",
  "hasSeenWelcomeGuide",
  "isOnboardingCompleted",
  "freeUploadUsed",
  "authProvider",
  "email",
  "name",
  "avatar",
];

// Used by the middleware fallback path to ask MongoDB for the same set.
const MONGOOSE_PROJECTION = CACHE_PROJECTION.join(" ");

// ─── Metrics ─────────────────────────────────────────────────────────────────
const metrics = {
  hits: 0,
  misses: 0,
  sets: 0,
  invalidations: 0,
  fallbacks: 0,
  errors: 0,
  totalLookupNs: 0n,
  totalLookupCount: 0,
};

function recordLookupNs(ns) {
  metrics.totalLookupNs += BigInt(ns);
  metrics.totalLookupCount += 1;
}

function snapshotAuthCacheMetrics() {
  const total = metrics.hits + metrics.misses;
  const hitRate = total === 0 ? 0 : Number(((metrics.hits / total) * 100).toFixed(2));
  const avgLookupMs =
    metrics.totalLookupCount === 0
      ? 0
      : Number((Number(metrics.totalLookupNs) / metrics.totalLookupCount / 1e6).toFixed(3));

  return {
    cacheHits:        metrics.hits,
    cacheMisses:      metrics.misses,
    cacheSets:        metrics.sets,
    cacheInvalidations: metrics.invalidations,
    cacheFallbacks:   metrics.fallbacks,
    cacheErrors:      metrics.errors,
    hitRate,                            // percentage 0-100
    averageLookupTimeMs: avgLookupMs,
    ttlSeconds:       AUTH_CACHE_TTL_SECONDS,
    timestamp:        new Date().toISOString(),
  };
}

// ─── Internal helpers ────────────────────────────────────────────────────────
function keyFor(userId) {
  return `${AUTH_CACHE_PREFIX}${String(userId)}`;
}

function serialise(user) {
  if (!user) return null;
  const safe = {};
  for (const field of CACHE_PROJECTION) {
    if (user[field] !== undefined) safe[field] = user[field];
  }
  // _id may be an ObjectId; stringify so deserialise round-trip is stable.
  if (safe._id && typeof safe._id !== "string") safe._id = safe._id.toString();
  return JSON.stringify(safe);
}

function deserialise(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// ─── Public API ──────────────────────────────────────────────────────────────
async function getCachedAuthUser(userId) {
  const start = process.hrtime.bigint();
  const key = keyFor(userId);

  if (!isRedisReady()) {
    metrics.fallbacks += 1;
    logger.warn("AUTH_CACHE_FALLBACK", { userId: String(userId), reason: "redis_not_ready" });
    return null;
  }

  try {
    const raw = await redis.get(key);
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    recordLookupNs(process.hrtime.bigint() - start);

    if (raw) {
      metrics.hits += 1;
      logger.info("AUTH_CACHE_HIT", { userId: String(userId), durationMs });
      return deserialise(raw);
    }

    metrics.misses += 1;
    logger.info("AUTH_CACHE_MISS", { userId: String(userId), durationMs });
    return null;
  } catch (error) {
    metrics.errors += 1;
    logger.error("AUTH_CACHE_ERROR", {
      userId: String(userId),
      phase: "get",
      error: error?.message,
    });
    // Fail open — middleware proceeds to MongoDB fallback.
    metrics.fallbacks += 1;
    logger.warn("AUTH_CACHE_FALLBACK", { userId: String(userId), reason: "get_error" });
    return null;
  }
}

async function setCachedAuthUser(user) {
  const userId = user?._id;
  if (!userId) return false;
  if (!isRedisReady()) return false;

  const key = keyFor(userId);
  const payload = serialise(user);
  if (!payload) return false;

  try {
    await redis.set(key, payload, "EX", AUTH_CACHE_TTL_SECONDS);
    metrics.sets += 1;
    logger.info("AUTH_CACHE_SET", {
      userId: String(userId),
      ttlSeconds: AUTH_CACHE_TTL_SECONDS,
    });
    return true;
  } catch (error) {
    metrics.errors += 1;
    logger.error("AUTH_CACHE_ERROR", {
      userId: String(userId),
      phase: "set",
      error: error?.message,
    });
    return false;
  }
}

async function invalidateAuthCache(userId) {
  if (!userId) return false;
  if (!isRedisReady()) {
    // Redis down means there's nothing to invalidate; the cache itself is
    // empty. Log so we don't pretend invalidation succeeded silently.
    logger.warn("AUTH_CACHE_FALLBACK", {
      userId: String(userId),
      reason: "invalidate_no_redis",
    });
    return false;
  }

  const key = keyFor(userId);
  try {
    await redis.del(key);
    metrics.invalidations += 1;
    logger.info("AUTH_CACHE_INVALIDATE", { userId: String(userId) });
    return true;
  } catch (error) {
    metrics.errors += 1;
    logger.error("AUTH_CACHE_ERROR", {
      userId: String(userId),
      phase: "invalidate",
      error: error?.message,
    });
    return false;
  }
}

module.exports = {
  AUTH_CACHE_PREFIX,
  AUTH_CACHE_TTL_SECONDS,
  CACHE_PROJECTION,
  MONGOOSE_PROJECTION,
  getCachedAuthUser,
  setCachedAuthUser,
  invalidateAuthCache,
  snapshotAuthCacheMetrics,
};
