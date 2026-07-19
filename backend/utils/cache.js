const {
  client,
  isRedisReady,
  isRedisWriteAvailable = isRedisReady,
  markRedisWriteFailure = () => false,
} = require("../config/redis");
const { logger } = require("./logger");
const { acquireLock, releaseLock } = require("./distributedLock");

// In-process dedup — protects against multiple async calls within the SAME
// Node process racing on the same cache key. Cross-process protection comes
// from the Redis lock below.
const inFlightResolvers = new Map();

// ─── Defaults for stampede protection ────────────────────────────────────────
const DEFAULT_LOCK_TTL_SECONDS = 30;
const DEFAULT_MAX_WAIT_MS      = 10_000;
const DEFAULT_POLL_INTERVAL_MS = 250;
const DEFAULT_JITTER_RATIO     = 0.05; // ±5% TTL jitter

function serializeKeyPart(value) {
  return String(value)
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9:_-]/g, "-");
}

function buildCacheKey(...parts) {
  return parts
    .filter((part) => part !== undefined && part !== null && part !== "")
    .map(serializeKeyPart)
    .join(":");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Jitter the TTL by ±ratio so cache entries created in the same burst do
// not all expire on the same second — eliminates synchronised re-stampedes.
function applyJitter(ttlSeconds, ratio = DEFAULT_JITTER_RATIO) {
  const safeRatio = Math.max(0, Math.min(0.5, ratio));
  const delta = ttlSeconds * safeRatio;
  const offset = (Math.random() * 2 - 1) * delta; // uniform in [-delta, +delta]
  return Math.max(1, Math.round(ttlSeconds + offset));
}

async function getCache(key) {
  if (!isRedisReady() || !isRedisWriteAvailable()) return null;

  try {
    const cached = await client.get(key);
    return cached ? JSON.parse(cached) : null;
  } catch (error) {
    logger.warn("Redis cache read failed", {
      key,
      error: error.message,
    });
    return null;
  }
}

async function setCache(key, data, ttlSeconds) {
  if (!isRedisReady() || !isRedisWriteAvailable()) return false;

  try {
    await client.set(key, JSON.stringify(data), "EX", ttlSeconds);
    return true;
  } catch (error) {
    markRedisWriteFailure(error);
    logger.warn("Redis cache write failed", {
      key,
      ttlSeconds,
      error: error.message,
    });
    return false;
  }
}

async function deleteCache(key) {
  if (!isRedisReady() || !isRedisWriteAvailable()) return 0;

  try {
    return client.del(key);
  } catch (error) {
    markRedisWriteFailure(error);
    logger.warn("Redis cache delete failed", {
      key,
      error: error.message,
    });
    return 0;
  }
}

async function deleteCacheByPattern(pattern) {
  if (!isRedisReady() || !isRedisWriteAvailable()) return 0;

  let deleted = 0;
  let cursor = "0";

  try {
    do {
      const [nextCursor, keys] = await client.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = nextCursor;

      if (keys.length > 0) {
        deleted += await client.del(...keys);
      }
    } while (cursor !== "0");

    return deleted;
  } catch (error) {
    markRedisWriteFailure(error);
    logger.warn("Redis cache pattern delete failed", {
      pattern,
      error: error.message,
    });
    return deleted;
  }
}

// Poll the cache key until it appears, or until maxWaitMs elapses.
// Returns the cached value on hit, or null on timeout.
async function waitForCacheFill(key, maxWaitMs, pollIntervalMs) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);
    const value = await getCache(key);
    if (value !== null) return value;
  }
  return null;
}

/**
 * rememberCache — stampede-protected cache lookup.
 *
 * Flow:
 *   1. Read cache. Hit? Return.
 *   2. In-process dedup. If another async call is already resolving this
 *      key inside this Node process, await its promise.
 *   3. Acquire a Redis SET NX EX lock. Got it? Compute, set cache, release.
 *   4. Lock held by peer? Poll the cache every pollIntervalMs up to maxWaitMs.
 *      Return the peer's cached value if it arrives.
 *   5. Wait timed out? Fail open and compute ourselves — better than
 *      returning null. Logged as CACHE_WAIT_TIMEOUT for observability.
 *
 * Options:
 *   lockTtlSeconds — Redis lock TTL (default 30s)
 *   maxWaitMs      — max time to wait for a peer (default 10s)
 *   pollIntervalMs — poll interval while waiting (default 250ms)
 *   jitterRatio    — TTL jitter ratio, 0–0.5 (default 0.05 → ±5%)
 */
async function rememberCache(key, ttlSeconds, resolver, options = {}) {
  // ── 1. First-shot cache read ──────────────────────────────────────────────
  const cached = await getCache(key);
  if (cached !== null) {
    return { data: cached, cacheHit: true };
  }

  // ── 2. In-process dedup ───────────────────────────────────────────────────
  const existingResolver = inFlightResolvers.get(key);
  if (existingResolver) {
    logger.info("CACHE_STAMPEDE_PREVENTED", { key, scope: "in_process" });
    const data = await existingResolver;
    return { data, cacheHit: false, deduped: true };
  }

  const lockKey         = `analytics-lock:${key}`;
  const lockTtlSeconds  = options.lockTtlSeconds  || DEFAULT_LOCK_TTL_SECONDS;
  const maxWaitMs       = options.maxWaitMs       || DEFAULT_MAX_WAIT_MS;
  const pollIntervalMs  = options.pollIntervalMs  || DEFAULT_POLL_INTERVAL_MS;
  const jitterRatio     = options.jitterRatio ?? DEFAULT_JITTER_RATIO;

  // ── 3. Distributed lock ──────────────────────────────────────────────────
  const { acquired, token, degraded } = await acquireLock(lockKey, lockTtlSeconds);

  // If we did not acquire (and Redis is healthy), wait for the peer to fill
  // the cache. The acquireLock helper emits CRON_LOCK_EXISTS by default;
  // we additionally emit CACHE_LOCK_WAIT here for analytics-specific tracing.
  if (!acquired && !degraded) {
    logger.info("CACHE_LOCK_WAIT", { key, lockKey, maxWaitMs });
    const peerData = await waitForCacheFill(key, maxWaitMs, pollIntervalMs);
    if (peerData !== null) {
      logger.info("CACHE_STAMPEDE_PREVENTED", { key, scope: "distributed_lock" });
      return { data: peerData, cacheHit: false, deduped: true, stampedeAvoidedBy: "distributed_lock" };
    }
    // Peer took too long. Fail open and compute ourselves to avoid blocking
    // the user-facing request. Logged at warn so we can spot pathological waits.
    logger.warn("CACHE_WAIT_TIMEOUT", { key, lockKey, maxWaitMs });
  } else if (acquired) {
    logger.info("CACHE_LOCK_ACQUIRED", { key, lockKey, lockTtlSeconds });
  }

  // ── 4. Compute + cache + release ─────────────────────────────────────────
  const resolverPromise = (async () => {
    const data = await resolver();
    const writeTtl = applyJitter(ttlSeconds, jitterRatio);
    await setCache(key, data, writeTtl);
    return data;
  })();

  inFlightResolvers.set(key, resolverPromise);
  try {
    const data = await resolverPromise;
    return { data, cacheHit: false };
  } finally {
    inFlightResolvers.delete(key);
    if (acquired && token) {
      const released = await releaseLock(lockKey, token);
      if (released) {
        logger.info("CACHE_LOCK_RELEASED", { key, lockKey });
      }
      // If release returned false, distributedLock has already emitted
      // CRON_LOCK_LOST — meaning our cache compute outlasted the lock TTL.
      // The cache was written before this point, so peers can read it.
    }
  }
}

module.exports = {
  buildCacheKey,
  deleteCache,
  deleteCacheByPattern,
  getCache,
  rememberCache,
  setCache,
  applyJitter,
};
