const { Queue, QueueEvents } = require("bullmq");
const { appConfig } = require("../config");
const { bullmqConnection } = require("../config/redis");
const { logger } = require("../utils/logger");

// ─── Identity ────────────────────────────────────────────────────────────────
const SMART_NOTIFICATION_QUEUE_NAME = appConfig.smartNotificationQueue.name;
const SMART_NOTIFICATION_JOB_NAME = "runSmartChecks";
const DELIVER_NOTIFICATION_JOB_NAME = "deliverNotification";

// ─── Queue ───────────────────────────────────────────────────────────────────
//
// Payload contract:
//   { userId: string, tradeId: string, collection: "forex" | "indian",
//     marketType: "Forex" | "Indian_Market", timezone: string }
//
// We intentionally pass only the tradeId — the worker re-reads the trade by
// _id so the check always operates on the current document (covers OCR-edits
// landing between enqueue and execution).
//
const smartNotificationQueue = new Queue(SMART_NOTIFICATION_QUEUE_NAME, {
  connection: bullmqConnection,
  defaultJobOptions: {
    // Retain completed jobs for 1h (drains naturally) and failed jobs for 24h
    // so an operator can inspect the failure window.
    removeOnComplete: { age: 60 * 60, count: 10000 },
    removeOnFail:     { age: 7 * 24 * 60 * 60, count: 10000 },
    attempts:         appConfig.smartNotificationQueue.attempts,
    backoff: {
      type:  "exponential",
      delay: appConfig.smartNotificationQueue.backoffMs,
    },
  },
});

// ─── Enqueue ─────────────────────────────────────────────────────────────────
async function enqueueSmartNotificationChecks(payload) {
  const userId     = payload?.userId?.toString?.() || payload?.userId;
  const tradeId    = payload?.tradeId?.toString?.()    || payload?.tradeId;
  const collection = payload?.collection || "forex";
  const marketType = payload?.marketType || "Forex";
  const timezone   = payload?.timezone   || "Asia/Kolkata";

  if (!userId || !tradeId) {
    logger.error("SMART_QUEUE_INVALID_PAYLOAD", { userId: Boolean(userId), tradeId: Boolean(tradeId) });
    const error = new Error("smartNotification queue payload requires userId + tradeId");
    error.code = "SMART_QUEUE_INVALID_PAYLOAD";
    throw error;
  }

  // jobId guarantees idempotency — submitting the same trade twice (e.g.
  // duplicate trade-save call from a retried API request) reuses the existing
  // BullMQ job rather than running the checks twice.
  const jobId = `sn-${tradeId}`;

  const existing = await smartNotificationQueue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    logger.warn("SMART_QUEUE_DUPLICATE_BLOCKED", { jobId, state });
    return existing;
  }

  const job = await smartNotificationQueue.add(
    SMART_NOTIFICATION_JOB_NAME,
    { userId, tradeId, collection, marketType, timezone },
    { jobId }
  );

  logger.info("SMART_QUEUE_ENQUEUED", { jobId, userId, tradeId, marketType });
  return job;
}

async function enqueueNotificationDelivery({ userId, notification }) {
  const normalizedUserId = userId?.toString?.() || userId;
  const dedupeKey = String(notification?.dedupeKey || "").trim();
  if (!normalizedUserId || !dedupeKey || !notification?.type || !notification?.title || !notification?.body) {
    const error = new Error("notification delivery requires userId, type, title, body, and dedupeKey");
    error.code = "NOTIFICATION_QUEUE_INVALID_PAYLOAD";
    throw error;
  }

  const safeDedupeKey = Buffer.from(dedupeKey).toString("base64url").slice(0, 180);
  const jobId = `notify-${safeDedupeKey}`;
  const existing = await smartNotificationQueue.getJob(jobId);
  if (existing) return existing;

  const job = await smartNotificationQueue.add(
    DELIVER_NOTIFICATION_JOB_NAME,
    { userId: normalizedUserId, notification },
    { jobId }
  );
  logger.info("NOTIFICATION_QUEUE_ENQUEUED", {
    jobId,
    userId: normalizedUserId,
    notificationType: notification.type,
  });
  return job;
}

// ─── Metrics ─────────────────────────────────────────────────────────────────
async function getSmartNotificationQueueMetrics() {
  const counts = await smartNotificationQueue.getJobCounts(
    "waiting",
    "active",
    "completed",
    "failed",
    "delayed",
    "paused"
  );
  return {
    queue:    SMART_NOTIFICATION_QUEUE_NAME,
    counts,
    timestamp: new Date().toISOString(),
  };
}

// ─── Queue-level events (independent of worker — observable from any node) ──
const queueEvents = new QueueEvents(SMART_NOTIFICATION_QUEUE_NAME, {
  connection: bullmqConnection,
});

queueEvents.on("failed", ({ jobId, failedReason, prev }) => {
  logger.error("SMART_QUEUE_JOB_FAILED", { jobId, failedReason, prevState: prev });
});

queueEvents.on("completed", ({ jobId }) => {
  logger.info("SMART_QUEUE_JOB_COMPLETED", { jobId });
});

queueEvents.on("stalled", ({ jobId }) => {
  logger.warn("SMART_QUEUE_JOB_STALLED", { jobId });
});

smartNotificationQueue.on("error", (error) => {
  logger.error("SMART_QUEUE_ERROR", { error: error?.message, stack: error?.stack });
});

module.exports = {
  SMART_NOTIFICATION_QUEUE_NAME,
  SMART_NOTIFICATION_JOB_NAME,
  DELIVER_NOTIFICATION_JOB_NAME,
  smartNotificationQueue,
  enqueueSmartNotificationChecks,
  enqueueNotificationDelivery,
  getSmartNotificationQueueMetrics,
};
