const { Queue, QueueEvents } = require("bullmq");
const { appConfig } = require("../config");
const { bullmqConnection } = require("../config/redis");
const { logger } = require("../utils/logger");
const { withTimeout } = require("../utils/withTimeout");

const SMART_ENQUEUE_TIMEOUT_MS = 3000;
const { isPromotionalType, msUntilPromoWindow } = require("../utils/notificationPolicy");

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

  // The connection runs with maxRetriesPerRequest: null, so while Redis is
  // reconnecting every command below waits with no limit. Bound the whole
  // sequence; the caller logs SMART_QUEUE_ENQUEUE_FAILED and moves on.
  return withTimeout((async () => {
    const existing = await smartNotificationQueue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      // Still pending: a retried save — the queued run will read the latest
      // trade anyway, so one job is enough.
      if (!["completed", "failed"].includes(state)) {
        logger.warn("SMART_QUEUE_DUPLICATE_BLOCKED", { jobId, state });
        return existing;
      }
      // Finished: this is a later edit (e.g. profit +50 → -50). Completed jobs
      // are kept for an hour, which used to block the re-check entirely.
      try {
        await existing.remove();
      } catch (error) {
        logger.warn("SMART_QUEUE_RERUN_REMOVE_FAILED", { jobId, state, error: error.message });
        return existing;
      }
    }

    const job = await smartNotificationQueue.add(
      SMART_NOTIFICATION_JOB_NAME,
      { userId, tradeId, collection, marketType, timezone },
      { jobId }
    );

    logger.info("SMART_QUEUE_ENQUEUED", { jobId, userId, tradeId, marketType });
    return job;
  })(), "enqueueSmartNotificationChecks", SMART_ENQUEUE_TIMEOUT_MS);
}

// Lazy require: the preference model is only needed for promotional pushes.
async function resolveUserTimezone(userId) {
  try {
    const NotificationPreference = require("../models/NotificationPreference");
    const prefs = await NotificationPreference.findOne({ user: userId }).select("quietHours.timezone").lean();
    return prefs?.quietHours?.timezone || "Asia/Kolkata";
  } catch {
    return "Asia/Kolkata";
  }
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

  // Upsell / win-back pushes are delayed into the user's daytime instead of
  // landing at 3am from an hourly server-clock cron.
  const delay = isPromotionalType(notification.type)
    ? msUntilPromoWindow(new Date(), await resolveUserTimezone(normalizedUserId))
    : 0;

  const job = await smartNotificationQueue.add(
    DELIVER_NOTIFICATION_JOB_NAME,
    { userId: normalizedUserId, notification },
    { jobId, ...(delay > 0 ? { delay } : {}) }
  );
  logger.info("NOTIFICATION_QUEUE_ENQUEUED", {
    jobId,
    userId: normalizedUserId,
    notificationType: notification.type,
    delayMs: delay,
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
