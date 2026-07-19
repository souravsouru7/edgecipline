const IORedis = require("ioredis");
const { captureOperationalError } = require("./sentry");

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const REDIS_WRITE_FAILURE_COOLDOWN_MS = Number(process.env.REDIS_WRITE_FAILURE_COOLDOWN_MS || 60_000);
let redisWritesUnavailableUntil = 0;
let redisWritesConfirmed = false;

function isRedisWriteError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    message.includes("misconf") ||
    message.includes("read only") ||
    message.includes("readonly") ||
    message.includes("stop-writes-on-bgsave-error")
  );
}

function markRedisWriteFailure(error, cooldownMs = REDIS_WRITE_FAILURE_COOLDOWN_MS) {
  if (!isRedisWriteError(error)) return false;
  redisWritesConfirmed = false;
  redisWritesUnavailableUntil = Date.now() + Math.max(1_000, Number(cooldownMs) || REDIS_WRITE_FAILURE_COOLDOWN_MS);
  return true;
}

function isRedisWriteAvailable() {
  return client.status === "ready" && redisWritesConfirmed && Date.now() >= redisWritesUnavailableUntil;
}

async function verifyRedisWrites() {
  if (client.status !== "ready") return false;
  const probeKey = "__edgecipline:redis-write-probe";
  try {
    await client.set(probeKey, "1", "EX", 5);
    await client.del(probeKey);
    redisWritesConfirmed = true;
    redisWritesUnavailableUntil = 0;
    return true;
  } catch (error) {
    markRedisWriteFailure(error);
    console.warn("[Redis] Write probe failed; response caches will be bypassed:", error.message);
    return false;
  }
}

const client = new IORedis(redisUrl, {
  maxRetriesPerRequest: null, // required by BullMQ
  enableReadyCheck: false,    // required by BullMQ
  connectTimeout: 15_000,
  lazyConnect: true,          // connectRedis() controls when we actually connect
  retryStrategy(times) {
    if (times > 8) {
      console.error("[Redis] Stopped reconnecting after 8 attempts. Make sure Redis is running.");
      return null; // ioredis fires "end" event — isRedisReady() will return false
    }
    return Math.min(times * 400, 4_000);
  },
});

client.on("ready",       () => {
  console.log("[Redis] Connected and ready");
  verifyRedisWrites().catch((error) => {
    markRedisWriteFailure(error);
    console.warn("[Redis] Write probe failed; response caches will be bypassed:", error.message);
  });
});
client.on("close",       () => console.warn("[Redis] Connection closed — reconnecting…"));
client.on("end", () => {
  const error = new Error("Redis connection ended after all retries were exhausted");
  console.warn("[Redis] Connection ended - all retries exhausted. Distributed rate limiting is degraded.");
  captureOperationalError(error, {
    subsystem: "redis",
    tags: { event: "reconnect_exhausted", rate_limiter: "degraded" },
  });
});
client.on("error",  (err) => {
  console.error("[Redis] Error:", err.message);
  markRedisWriteFailure(err);
  captureOperationalError(err, { subsystem: "redis", tags: { event: "client_error" } });
});

const connectRedis = async () => {
  // ioredis throws "already connecting/connected" if connect() is called while the
  // client is already in connecting/ready state (e.g. BullMQ connected it first).
  // Skip the call — the client is usable either way.
  if (["connecting", "connect"].includes(client.status)) {
    return;
  }
  if (client.status === "ready") {
    await verifyRedisWrites();
    return;
  }
  try {
    await client.connect();
    await client.ping();
    await verifyRedisWrites();
    console.log("[Redis] Successfully connected");
  } catch (err) {
    captureOperationalError(err, { subsystem: "redis", tags: { event: "connect_failed" } });
    console.error("[Redis] Failed to connect:", err.message);
    console.warn("[Redis] Upload queue and caching will be unavailable until Redis is reachable");
    // Don't throw — Redis is optional. The app runs with reduced functionality.
    // isRedisReady() will return false and callers handle the degraded state.
  }
};

// Single source of truth: ioredis tracks its own state correctly.
// No separate flag that can fall out of sync.
const isRedisReady = () => client.status === "ready";

module.exports = {
  client,
  bullmqConnection: client,
  connectRedis,
  isRedisWriteAvailable,
  isRedisReady,
  markRedisWriteFailure,
  verifyRedisWrites,
};
