const IORedis = require("ioredis");

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

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

client.on("ready",       () => console.log("[Redis] Connected and ready"));
client.on("close",       () => console.warn("[Redis] Connection closed — reconnecting…"));
client.on("end",         () => console.warn("[Redis] Connection ended — all retries exhausted. Upload queue unavailable."));
client.on("error",  (err) => console.error("[Redis] Error:", err.message));

const connectRedis = async () => {
  // ioredis throws "already connecting/connected" if connect() is called while the
  // client is already in connecting/ready state (e.g. BullMQ connected it first).
  // Skip the call — the client is usable either way.
  if (["connecting", "connect", "ready"].includes(client.status)) {
    return;
  }
  try {
    await client.connect();
    await client.ping();
    console.log("[Redis] Successfully connected");
  } catch (err) {
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
  isRedisReady,
};
