"use strict";

// ─── Google Play acknowledgement sweep ──────────────────────────────────────
//
// Google AUTOMATICALLY REFUNDS and revokes any subscription purchase that has
// not been acknowledged within three days of purchase. The verify path
// acknowledges inline, but that call can fail (Play 5xx, timeout, deploy in
// progress) and the only other things that retry it are an RTDN or the user
// reopening the app — neither of which is guaranteed to happen inside the
// window. This job is the guarantee.
//
// It does nothing clever: every unacknowledged row older than the minimum age
// is pushed back through syncPurchase, which re-reads Google's state and
// acknowledges only if the purchase is still entitling. A row that Google has
// since refunded or that is still PENDING is left alone by the same rules that
// govern the live path. Rows past `alertAfterHours` also raise an operational
// alert, because one more failed retry means the money goes back.

const cron = require("node-cron");
const PlaySubscription = require("../models/PlaySubscription");
const { appConfig } = require("../config");
const { logger } = require("../utils/logger");
const { recordCronRun } = require("../utils/cronMetrics");
const { withCronLock } = require("../utils/distributedLock");
const { captureOperationalError } = require("../config/sentry");
const { fingerprintPurchaseToken } = require("../utils/playAccountIdentity");
const { syncPurchase, isPlayBillingAvailable } = require("../services/googlePlayBillingService");

const CRON_NAME = "playAcknowledgementSweepCron";
const LOCK_NAME = "play-ack-sweep";
const LOCK_TTL_SECONDS = 25 * 60;

let isRunning = false;

function tickKey(date = new Date()) {
  // One lock per 30-minute window, matching the default schedule.
  const minute = Math.floor(date.getUTCMinutes() / 30) * 30;
  return `${date.toISOString().slice(0, 13)}:${String(minute).padStart(2, "0")}`;
}

async function findUnacknowledged(now, { batchSize, minAgeMinutes }) {
  const cutoff = new Date(now.getTime() - minAgeMinutes * 60 * 1000);
  return PlaySubscription.find({
    acknowledged: false,
    detachedAt: null,
    createdAt: { $lt: cutoff },
  })
    .select("_id purchaseToken createdAt state acknowledgementAttempts lastAcknowledgementError")
    .sort({ createdAt: 1 })
    .limit(batchSize)
    .lean();
}

function alertAtRisk(row, now) {
  const ageHours = Math.round((now.getTime() - new Date(row.createdAt).getTime()) / 36e5);
  const purchaseRef = fingerprintPurchaseToken(row.purchaseToken);
  const error = new Error(`Google Play purchase unacknowledged for ${ageHours}h — refund at 72h`);
  captureOperationalError(error, {
    level: "error",
    subsystem: "google_play",
    tags: { operation: "ack_sweep" },
    extra: {
      purchaseRef,
      ageHours,
      state: row.state,
      attempts: row.acknowledgementAttempts,
      lastError: row.lastAcknowledgementError,
    },
  });
  logger.error("PLAY_ACK_SWEEP_AT_RISK", {
    purchaseRef,
    ageHours,
    state: row.state,
    attempts: row.acknowledgementAttempts,
    lastError: row.lastAcknowledgementError,
  });
}

/**
 * One pass over the unacknowledged rows. Exported for tests and for a manual
 * run from a REPL when Play is misbehaving.
 */
async function sweepUnacknowledgedPurchases(now = new Date()) {
  const settings = appConfig.playAckSweep || {};
  const batchSize = Math.max(1, settings.batchSize || 100);
  const minAgeMinutes = Math.max(1, settings.minAgeMinutes || 30);
  const alertAfterMs = Math.max(1, settings.alertAfterHours || 48) * 60 * 60 * 1000;

  if (!isPlayBillingAvailable()) {
    // Nothing can be acknowledged without credentials; say so rather than
    // burning a batch of failed API calls every half hour.
    logger.warn(`[${CRON_NAME}] Google Play billing unavailable; sweep skipped`);
    return { scanned: 0, acknowledged: 0, skipped: 0, failed: 0, atRisk: 0, unavailable: true };
  }

  const rows = await findUnacknowledged(now, { batchSize, minAgeMinutes });

  let acknowledged = 0;
  let skipped = 0;
  let failed = 0;
  let atRisk = 0;

  for (const row of rows) {
    const purchaseRef = fingerprintPurchaseToken(row.purchaseToken);
    try {
      // Sequential on purpose — each is a Play Developer API call.
      const outcome = await syncPurchase({ purchaseToken: row.purchaseToken, userId: null, source: "reconcile" });
      if (outcome.acknowledged) {
        acknowledged += 1;
      } else {
        // Not entitling (pending, refunded, expired) or the ack failed again.
        skipped += 1;
      }
    } catch (error) {
      failed += 1;
      logger.warn("PLAY_ACK_SWEEP_SYNC_FAILED", {
        purchaseRef,
        code: error?.errorCode || null,
        error: error?.message,
      });
    }

    if (now.getTime() - new Date(row.createdAt).getTime() > alertAfterMs) {
      // Re-read: the sync above may have just fixed it.
      const fresh = await PlaySubscription.findById(row._id).select("acknowledged").lean();
      if (fresh && !fresh.acknowledged) {
        atRisk += 1;
        alertAtRisk(row, now);
      }
    }
  }

  return { scanned: rows.length, acknowledged, skipped, failed, atRisk };
}

async function runPlayAcknowledgementSweepJob(now = new Date()) {
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
        logger.info(`[${CRON_NAME}] starting`, { timestamp: now.toISOString() });

        const result = await sweepUnacknowledgedPurchases(now);

        logger.info(`[${CRON_NAME}] completed`, { ...result, timestamp: new Date().toISOString() });

        return recordCronRun(CRON_NAME, {
          startedAt,
          durationMs: Date.now() - startMs,
          totalItems: result.scanned,
          success: result.acknowledged,
          failure: result.failed,
        });
      }
    );

    if (lockResult.skipped) {
      logger.info(`[${CRON_NAME}] lock held by peer; skipping`, { key: lockResult.key });
      return recordCronRun(CRON_NAME, { startedAt, durationMs: Date.now() - startMs, skipped: 1 });
    }

    return lockResult.result;
  } catch (error) {
    logger.error(`[${CRON_NAME}] job error`, { error: error?.message, stack: error?.stack });
    return recordCronRun(CRON_NAME, {
      startedAt,
      durationMs: Date.now() - startMs,
      error: error?.message || "Unknown ack sweep error",
      failure: 1,
    });
  } finally {
    isRunning = false;
  }
}

function startPlayAcknowledgementSweepCron() {
  const settings = appConfig.playAckSweep || {};
  if (!settings.enabled) {
    logger.info(`[${CRON_NAME}] disabled by ENABLE_PLAY_ACK_SWEEP_CRON`);
    return;
  }
  if (!appConfig.googlePlay?.enabled) {
    logger.info(`[${CRON_NAME}] not scheduled: GOOGLE_PLAY_BILLING_ENABLED is off`);
    return;
  }

  const schedule = settings.schedule || "*/30 * * * *";
  if (!cron.validate(schedule)) {
    logger.warn(`[${CRON_NAME}] invalid cron schedule, skipping`, { schedule });
    return;
  }

  cron.schedule(schedule, () => {
    runPlayAcknowledgementSweepJob().catch((error) => {
      logger.error(`[${CRON_NAME}] unhandled job error`, { error: error?.message, stack: error?.stack });
    });
  });

  logger.info(`[${CRON_NAME}] scheduled`, {
    schedule,
    batchSize: settings.batchSize,
    minAgeMinutes: settings.minAgeMinutes,
    alertAfterHours: settings.alertAfterHours,
  });
}

module.exports = {
  sweepUnacknowledgedPurchases,
  runPlayAcknowledgementSweepJob,
  startPlayAcknowledgementSweepCron,
  findUnacknowledged,
};
