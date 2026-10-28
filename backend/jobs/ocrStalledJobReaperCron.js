"use strict";

// ─── OCR stalled-job reaper ─────────────────────────────────────────────────
//
// Every recovery path in services/ocrJob.service.js other than this one runs
// inside getOcrJobStatus, which means it fires only while a client is polling.
// Two failures fall through that gap:
//
//   1. The user closes the app mid-upload. Nothing polls, so the row stays
//      PENDING/PROCESSING until the 24h TTL removes it — no terminal status,
//      no ocr_failed push, and for a free-tier account the single upload claim
//      is never returned.
//
//   2. No OCR worker is consuming the queue (crashed, not deployed, PM2 app
//      stopped). The BullMQ job exists and sits in `waiting`, so the
//      missing-queue-job recovery never triggers — `queueState` is truthy —
//      and the client polls every 4s indefinitely.
//
// The sweep is idempotent: every write is guarded on the row still being
// PENDING/PROCESSING, so racing a worker that just finished loses harmlessly.
// The distributed lock is therefore an efficiency measure, not a correctness
// requirement — but it is taken anyway, like the other crons, so this stays
// safe when the API scales past one instance.

const cron = require("node-cron");
const { logger } = require("../utils/logger");
const { recordCronRun } = require("../utils/cronMetrics");
const { withCronLock } = require("../utils/distributedLock");
const { captureOperationalError } = require("../config/sentry");
const { reapStalledOcrJobs } = require("../services/ocrJob.service");

const CRON_NAME = "ocrStalledJobReaperCron";
const LOCK_NAME = "ocr-stalled-reaper";

// Every 2 minutes. The client gives up on a job at 10 minutes
// (OCR_POLL_DEADLINE_MS in features/trade/hooks/useUploadTrade.js) and the
// no-consumer threshold here is 8 minutes, so a stuck job is normally already
// reconciled to FAILED by the time the user is told anything — they see the
// real reason rather than a generic timeout.
const DEFAULT_SCHEDULE = process.env.OCR_REAPER_CRON || "*/2 * * * *";
const LOCK_TTL_SECONDS = Number(process.env.OCR_REAPER_LOCK_TTL_SECONDS || 110);
const BATCH_LIMIT = Math.min(500, Number(process.env.OCR_REAPER_BATCH || 200));

let isRunning = false;

function tickKey(date = new Date()) {
  // One lock per 2-minute window, matching the default schedule.
  const minute = Math.floor(date.getUTCMinutes() / 2) * 2;
  return `${date.toISOString().slice(0, 13)}:${String(minute).padStart(2, "0")}`;
}

async function runOcrStalledJobReaper(now = new Date()) {
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
        const stats = await reapStalledOcrJobs({ limit: BATCH_LIMIT, now: now.getTime() });
        const reaped = stats.failedWaiting + stats.failedProcessing + stats.reconciled;

        // A job failed for want of a consumer is an operational signal, not a
        // user error: it means the OCR worker was not running. Surface it once
        // per sweep rather than per job.
        if (stats.failedWaiting > 0) {
          const error = new Error(
            `${stats.failedWaiting} OCR job(s) failed with no queue consumer — is the OCR worker running?`
          );
          captureOperationalError(error, {
            subsystem: "ocr",
            tags: { event: "no_queue_consumer" },
            extra: stats,
          });
          logger.error("OCR_REAPER_NO_CONSUMER", stats);
        }

        return recordCronRun(CRON_NAME, {
          startedAt,
          durationMs: Date.now() - startMs,
          totalItems: stats.scanned,
          success: reaped + stats.recovered,
          failure: 0,
        });
      }
    );

    if (lockResult.skipped) {
      logger.info(`[${CRON_NAME}] another instance holds the lock; skipping`);
      return recordCronRun(CRON_NAME, { startedAt, durationMs: Date.now() - startMs, skipped: 1 });
    }

    return lockResult.result;
  } catch (error) {
    captureOperationalError(error, { subsystem: "ocr", tags: { event: "reaper_failed" } });
    logger.error(`[${CRON_NAME}] failed`, { error: error.message, stack: error.stack });
    return recordCronRun(CRON_NAME, {
      startedAt,
      durationMs: Date.now() - startMs,
      failure: 1,
    });
  } finally {
    isRunning = false;
  }
}

function startOcrStalledJobReaperCron(schedule = DEFAULT_SCHEDULE) {
  if (!cron.validate(schedule)) {
    throw new Error(`Invalid OCR reaper schedule: "${schedule}". Fix OCR_REAPER_CRON env var.`);
  }

  cron.schedule(schedule, () => {
    runOcrStalledJobReaper().catch((error) =>
      logger.error(`[${CRON_NAME}] unhandled failure`, {
        error: error.message,
        stack: error.stack,
      })
    );
  });

  logger.info("OCR stalled-job reaper scheduled", { schedule, batchLimit: BATCH_LIMIT });
}

module.exports = {
  runOcrStalledJobReaper,
  startOcrStalledJobReaperCron,
};
