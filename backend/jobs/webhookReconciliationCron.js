const cron = require("node-cron");
const WebhookEvent = require("../models/WebhookEvent");
const { appConfig } = require("../config");
const { logger } = require("../utils/logger");
const { recordCronRun } = require("../utils/cronMetrics");
const { withCronLock } = require("../utils/distributedLock");
const { captureOperationalError } = require("../config/sentry");
const {
  MAX_PROCESSING_ATTEMPTS,
  reprocessStoredWebhookEvent,
} = require("../services/razorpayWebhookService");
const {
  reprocessStoredPlayEvent,
} = require("../services/googlePlayNotificationService");

const CRON_NAME = "webhookReconciliationCron";
const LOCK_NAME = "webhook-reconciliation";
const LOCK_TTL_SECONDS = 10 * 60;

// Razorpay retries a failed delivery on its own schedule. Only reach for an
// event once that has had time to work — otherwise reconciliation just races
// the provider and burns attempts on events that were about to succeed.
const MIN_EVENT_AGE_MS = 10 * 60 * 1000;

let isRunning = false;

function tickKey(date = new Date()) {
  // One lock per 15-minute window, matching the default schedule.
  const minute = Math.floor(date.getUTCMinutes() / 15) * 15;
  return `${date.toISOString().slice(0, 13)}:${String(minute).padStart(2, "0")}`;
}

async function findRecoverableEvents(now, batchSize) {
  return WebhookEvent.find({
    processed: false,
    permanentlyFailed: { $ne: true },
    processingAttempts: { $lt: MAX_PROCESSING_ATTEMPTS },
    createdAt: { $lt: new Date(now.getTime() - MIN_EVENT_AGE_MS) },
  })
    // `provider` decides which reprocessor an event goes to. Without it every
    // event was handed to the Razorpay path, which would look at a Google Play
    // payload, find no `event` field, log "unsupported event skipped" and mark
    // it processed — silently discarding a lifecycle change instead of
    // recovering it.
    .select("_id eventId eventType provider processingAttempts")
    .sort({ createdAt: 1 })
    .limit(batchSize)
    .lean();
}

/**
 * A permanently-failed webhook means the provider may have taken money we
 * never fulfilled — or, for Google Play, that a cancellation or refund never
 * withdrew access. That is not a log line — it needs a human.
 */
function alertPermanentFailure(event) {
  const provider = event.provider === "google_play" ? "google_play" : "razorpay";
  const error = new Error(
    `${provider} webhook permanently failed after ${MAX_PROCESSING_ATTEMPTS} attempts: ${event.eventType}`
  );
  captureOperationalError(error, {
    level: "error",
    subsystem: provider,
    tags: {
      operation: "webhook_reconciliation",
      event_type: event.eventType,
      provider,
    },
    extra: {
      eventId: event.eventId,
      attempts: MAX_PROCESSING_ATTEMPTS,
      lastError: event.error,
    },
  });
  logger.error("[WebhookReconciliation] PERMANENT FAILURE — manual intervention required", {
    eventId: event.eventId,
    eventType: event.eventType,
    attempts: MAX_PROCESSING_ATTEMPTS,
    error: event.error,
  });
}

async function reconcileWebhookEvents(now = new Date()) {
  const batchSize = Math.max(1, appConfig.webhookReconciliation?.batchSize || 50);
  const candidates = await findRecoverableEvents(now, batchSize);

  let recovered = 0;
  let stillFailing = 0;
  let exhausted = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    // Sequential on purpose. These call out to the payment provider's API and
    // write subscriptions; a burst of parallel retries would both hammer the
    // provider and widen the window for lock contention.
    const outcome = candidate.provider === "google_play"
      ? await reprocessStoredPlayEvent(candidate.eventId, MAX_PROCESSING_ATTEMPTS)
      : await reprocessStoredWebhookEvent(candidate.eventId);

    if (!outcome) {
      // Claimed by a live delivery or a peer instance between the query and
      // the claim. Correct outcome — leave it to whoever holds it.
      skipped += 1;
      continue;
    }
    if (outcome.recovered) {
      recovered += 1;
      continue;
    }

    stillFailing += 1;
    if (outcome.exhausted) {
      exhausted += 1;
      alertPermanentFailure({ ...outcome, provider: candidate.provider });
    }
  }

  return {
    scanned: candidates.length,
    recovered,
    stillFailing,
    exhausted,
    skipped,
  };
}

async function runWebhookReconciliationJob(now = new Date()) {
  if (isRunning) {
    logger.warn(`[${CRON_NAME}] previous run still in progress; skipping`);
    return recordCronRun(CRON_NAME, { startedAt: now, durationMs: 0, skipped: 1 });
  }

  isRunning = true;
  const startedAt = new Date();
  const startMs = Date.now();

  try {
    const lockResult = await withCronLock(
      { name: LOCK_NAME, lockSuffix: tickKey(now), ttlSeconds: LOCK_TTL_SECONDS },
      async () => {
        const result = await reconcileWebhookEvents(now);

        if (result.scanned > 0) {
          logger.info(`[${CRON_NAME}] completed`, {
            ...result,
            timestamp: new Date().toISOString(),
          });
        }

        return recordCronRun(CRON_NAME, {
          startedAt,
          durationMs: Date.now() - startMs,
          totalItems: result.scanned,
          success: result.recovered,
          failure: result.stillFailing,
          skipped: result.skipped,
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
    captureOperationalError(error, {
      subsystem: "razorpay",
      tags: { operation: "webhook_reconciliation_job" },
    });
    return recordCronRun(CRON_NAME, {
      startedAt,
      durationMs: Date.now() - startMs,
      error: error?.message || "Unknown webhook reconciliation error",
      failure: 1,
    });
  } finally {
    isRunning = false;
  }
}

function startWebhookReconciliationCron() {
  if (!appConfig.webhookReconciliation?.enabled) {
    logger.info(`[${CRON_NAME}] disabled by ENABLE_WEBHOOK_RECONCILIATION_CRON`);
    return;
  }

  const schedule = appConfig.webhookReconciliation?.schedule || "*/15 * * * *";
  if (!cron.validate(schedule)) {
    logger.warn(`[${CRON_NAME}] invalid cron schedule, skipping`, { schedule });
    return;
  }

  cron.schedule(schedule, () => {
    runWebhookReconciliationJob().catch((error) => {
      logger.error(`[${CRON_NAME}] unhandled job error`, {
        error: error?.message,
        stack: error?.stack,
      });
    });
  });

  logger.info(`[${CRON_NAME}] scheduled`, {
    schedule,
    batchSize: appConfig.webhookReconciliation?.batchSize || 50,
    maxAttempts: MAX_PROCESSING_ATTEMPTS,
  });
}

module.exports = {
  MIN_EVENT_AGE_MS,
  findRecoverableEvents,
  reconcileWebhookEvents,
  runWebhookReconciliationJob,
  startWebhookReconciliationCron,
  tickKey,
};
