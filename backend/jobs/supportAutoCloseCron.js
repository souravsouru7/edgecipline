const cron = require("node-cron");
const { appConfig } = require("../config");
const { logger } = require("../utils/logger");
const { recordCronRun } = require("../utils/cronMetrics");
const { withCronLock } = require("../utils/distributedLock");
const ticketService = require("../services/supportTicket.service");
const { AUTO_CLOSE_AFTER_DAYS } = require("../constants/support");

const CRON_NAME = "supportAutoCloseCron";
const LOCK_NAME = "support-auto-close";
const LOCK_TTL_SECONDS = 55 * 60;

/**
 * Closes tickets that have been resolved longer than the reopen window.
 *
 * Without this, "resolved" accumulates forever and the queue's resolved tab
 * becomes an unreadable archive. The window matters: a customer may reopen a
 * resolved ticket for AUTO_CLOSE_AFTER_DAYS, and the moment that stops being
 * true is the moment the ticket is genuinely finished.
 *
 * Safe to run on several instances — the sweep is idempotent (the update
 * predicate excludes anything already closed), and the distributed lock is an
 * efficiency win rather than a correctness requirement.
 */
let isRunning = false;

function dailyKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

async function runSupportAutoCloseJob(now = new Date()) {
  if (isRunning) {
    logger.warn(`[${CRON_NAME}] previous run still in progress; skipping`);
    return recordCronRun(CRON_NAME, { startedAt: now, durationMs: 0, skipped: 1 });
  }

  isRunning = true;
  const startedAt = new Date();
  const startMs = Date.now();
  const batchSize = Math.max(1, appConfig.support?.autoClose?.batchSize || 500);

  try {
    const lockResult = await withCronLock(
      { name: LOCK_NAME, lockSuffix: dailyKey(now), ttlSeconds: LOCK_TTL_SECONDS },
      async () => {
        let totalClosed = 0;
        let batches = 0;

        // Bounded loop rather than one enormous update, so a backlog cannot
        // monopolise the connection pool for the rest of the app.
        // eslint-disable-next-line no-constant-condition
        while (true) {
          // eslint-disable-next-line no-await-in-loop
          const batch = await ticketService.autoCloseResolvedTickets({ batchSize });
          if (!batch.closed) break;
          totalClosed += batch.closed;
          batches += 1;
          if (batch.closed < batchSize) break;
        }

        if (totalClosed > 0) {
          logger.info(`[${CRON_NAME}] completed`, {
            ticketsClosed: totalClosed,
            batches,
            afterDays: AUTO_CLOSE_AFTER_DAYS,
          });
        }

        return recordCronRun(CRON_NAME, {
          startedAt,
          durationMs: Date.now() - startMs,
          totalItems: totalClosed,
          success: totalClosed,
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
    logger.error(`[${CRON_NAME}] job error`, { error: error?.message, stack: error?.stack });
    return recordCronRun(CRON_NAME, {
      startedAt,
      durationMs: Date.now() - startMs,
      error: error?.message || "Unknown support auto-close error",
      failure: 1,
    });
  } finally {
    isRunning = false;
  }
}

function startSupportAutoCloseCron() {
  if (!appConfig.support?.autoClose?.enabled) {
    logger.info(`[${CRON_NAME}] disabled by ENABLE_SUPPORT_AUTO_CLOSE_CRON`);
    return;
  }

  const schedule = appConfig.support.autoClose.schedule || "0 2 * * *";
  if (!cron.validate(schedule)) {
    logger.warn(`[${CRON_NAME}] invalid cron schedule, skipping`, { schedule });
    return;
  }

  cron.schedule(schedule, () => {
    runSupportAutoCloseJob().catch((error) => {
      logger.error(`[${CRON_NAME}] unhandled job error`, {
        error: error?.message,
        stack: error?.stack,
      });
    });
  });

  logger.info(`[${CRON_NAME}] scheduled`, { schedule, afterDays: AUTO_CLOSE_AFTER_DAYS });
}

module.exports = {
  dailyKey,
  runSupportAutoCloseJob,
  startSupportAutoCloseCron,
};
