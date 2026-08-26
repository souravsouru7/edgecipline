const cron = require("node-cron");
const WebhookEvent = require("../models/WebhookEvent");
const { appConfig } = require("../config");
const { logger } = require("../utils/logger");
const { recordCronRun } = require("../utils/cronMetrics");
const { withCronLock } = require("../utils/distributedLock");

const CRON_NAME = "webhookRetentionCron";
const LOCK_NAME = "webhook-retention";
const LOCK_TTL_SECONDS = 55 * 60;

// The WebhookEvent document is NEVER deleted — `eventId` is the idempotency
// key that makes duplicate webhook delivery safe, and deleting it would let a
// replayed event re-activate a subscription months later. Only the bulky,
// PII-bearing `payload` is dropped. The tombstone keeps the schema's
// `required: true` satisfied while making the pruning visible.
const PRUNED_PAYLOAD = { pruned: true };

let isRunning = false;

function dailyKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

/**
 * Prune payloads from events that are:
 *   - successfully processed (an unprocessed event may still be recoverable
 *     by the reconciliation cron, which needs the payload to replay it), and
 *   - not permanently failed (those are evidence for a human), and
 *   - older than the retention window, and
 *   - not already pruned.
 */
async function pruneProcessedPayloads(now = new Date(), batchSize) {
  const retentionDays = Math.max(1, appConfig.webhookRetention?.days || 90);
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

  const stale = await WebhookEvent.find({
    processed: true,
    permanentlyFailed: { $ne: true },
    payloadPrunedAt: { $exists: false },
    processedAt: { $lt: cutoff },
  })
    .select("_id")
    .limit(batchSize)
    .lean();

  if (!stale.length) return { matched: 0, pruned: 0, retentionDays };

  const result = await WebhookEvent.updateMany(
    { _id: { $in: stale.map((doc) => doc._id) } },
    { $set: { payload: PRUNED_PAYLOAD, payloadPrunedAt: new Date() } }
  );

  return {
    matched: stale.length,
    pruned: result.modifiedCount || result.nModified || 0,
    retentionDays,
  };
}

async function runWebhookRetentionJob(now = new Date()) {
  if (isRunning) {
    logger.warn(`[${CRON_NAME}] previous run still in progress; skipping`);
    return recordCronRun(CRON_NAME, { startedAt: now, durationMs: 0, skipped: 1 });
  }

  isRunning = true;
  const startedAt = new Date();
  const startMs = Date.now();
  const batchSize = Math.max(1, appConfig.webhookRetention?.batchSize || 500);

  try {
    const lockResult = await withCronLock(
      { name: LOCK_NAME, lockSuffix: dailyKey(now), ttlSeconds: LOCK_TTL_SECONDS },
      async () => {
        let totalPruned = 0;
        let batches = 0;

        while (true) {
          const batch = await pruneProcessedPayloads(now, batchSize);
          if (!batch.matched) break;
          totalPruned += batch.pruned;
          batches += 1;
          if (batch.matched < batchSize) break;
        }

        if (totalPruned > 0) {
          logger.info(`[${CRON_NAME}] completed`, {
            payloadsPruned: totalPruned,
            batches,
            retentionDays: appConfig.webhookRetention?.days || 90,
          });
        }

        return recordCronRun(CRON_NAME, {
          startedAt,
          durationMs: Date.now() - startMs,
          totalItems: totalPruned,
          success: totalPruned,
          failure: 0,
        });
      }
    );

    if (lockResult.skipped) {
      logger.info(`[${CRON_NAME}] lock held by peer; skipping`, { key: lockResult.key });
      return recordCronRun(CRON_NAME, {
        startedAt,
        durationMs: Date.now() - startMs,
        skipped: 1,
      });
    }

    return lockResult.result;
  } catch (error) {
    logger.error(`[${CRON_NAME}] job error`, {
      error: error?.message,
      stack: error?.stack,
    });
    return recordCronRun(CRON_NAME, {
      startedAt,
      durationMs: Date.now() - startMs,
      error: error?.message || "Unknown webhook retention error",
      failure: 1,
    });
  } finally {
    isRunning = false;
  }
}

function startWebhookRetentionCron() {
  if (!appConfig.webhookRetention?.enabled) {
    logger.info(`[${CRON_NAME}] disabled by ENABLE_WEBHOOK_RETENTION_CRON`);
    return;
  }

  const schedule = appConfig.webhookRetention?.schedule || "30 3 * * *";
  if (!cron.validate(schedule)) {
    logger.warn(`[${CRON_NAME}] invalid cron schedule, skipping`, { schedule });
    return;
  }

  cron.schedule(schedule, () => {
    runWebhookRetentionJob().catch((error) => {
      logger.error(`[${CRON_NAME}] unhandled job error`, {
        error: error?.message,
        stack: error?.stack,
      });
    });
  });

  logger.info(`[${CRON_NAME}] scheduled`, {
    schedule,
    retentionDays: appConfig.webhookRetention?.days || 90,
  });
}

module.exports = {
  PRUNED_PAYLOAD,
  dailyKey,
  pruneProcessedPayloads,
  runWebhookRetentionJob,
  startWebhookRetentionCron,
};
