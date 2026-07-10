"use strict";

const cron = require("node-cron");
const User = require("../models/Users");
const { appConfig } = require("../config");
const { logger } = require("../utils/logger");
const { recordCronRun } = require("../utils/cronMetrics");
const { withCronLock } = require("../utils/distributedLock");
const {
  TOUCHPOINTS,
  windowForTouchpoint,
  statusFilterForPhase,
  dispatchTouchpoint,
} = require("../services/subscriptionRescueService");
const { buildRescueContext } = require("../services/rescueContextService");

const CRON_NAME = "subscriptionRescueCron";
const LOCK_NAME = "subscription-rescue";
const LOCK_TTL_SECONDS = 55 * 60;

let isRunning = false;

function hourlyKey(date = new Date()) {
  return date.toISOString().slice(0, 13);
}

// Per-touchpoint pass: query users in the window for that touchpoint and
// dispatch. The RescueDispatch unique index dedupes — we don't need to
// pre-check.
async function processTouchpoint(touchpoint, now, batchSize) {
  const { from, to } = windowForTouchpoint(touchpoint, now.getTime());
  const subscriptionStatus = statusFilterForPhase(touchpoint.phase);

  const users = await User.find({
    role: { $ne: "admin" },
    subscriptionStatus,
    subscriptionExpiry: { $gte: from, $lte: to },
  })
    // Project just what we need — keeps memory bounded for large funnels.
    .select("_id email name streaks subscriptionStatus subscriptionExpiry trial")
    .limit(batchSize)
    .lean();

  if (!users.length) return { matched: 0, dispatched: 0, skipped: 0, failed: 0 };

  let dispatched = 0;
  let skipped = 0;
  let failed = 0;

  // Sequential per user to keep load on the queue + email service predictable.
  // Concurrency can be tuned later via env if needed.
  for (const user of users) {
    try {
      const context = await buildRescueContext(user);
      const result = await dispatchTouchpoint({ user, touchpoint, context });
      if (result.alreadyDispatched) skipped += 1;
      else if (result.dispatched) dispatched += 1;
    } catch (err) {
      failed += 1;
      logger.warn(`[${CRON_NAME}] dispatch failure`, {
        userId: String(user._id),
        touchpoint: touchpoint.code,
        error: err.message,
      });
    }
  }

  return { matched: users.length, dispatched, skipped, failed };
}

async function runSubscriptionRescueJob(now = new Date()) {
  if (isRunning) {
    logger.warn(`[${CRON_NAME}] previous run still in progress; skipping`);
    return recordCronRun(CRON_NAME, { startedAt: now, durationMs: 0, skipped: 1 });
  }

  isRunning = true;
  const startedAt = new Date();
  const startMs = Date.now();
  const batchSize = Math.max(1, appConfig.subscriptionRescue?.batchSize || 200);

  try {
    const lockResult = await withCronLock(
      {
        name: LOCK_NAME,
        lockSuffix: hourlyKey(now),
        ttlSeconds: LOCK_TTL_SECONDS,
      },
      async () => {
        logger.info(`[${CRON_NAME}] starting`, { timestamp: now.toISOString() });

        const perTouchpoint = [];
        let totalMatched = 0;
        let totalDispatched = 0;
        let totalSkipped = 0;
        let totalFailed = 0;

        for (const tp of TOUCHPOINTS) {
          const res = await processTouchpoint(tp, now, batchSize);
          perTouchpoint.push({ touchpoint: tp.code, ...res });
          totalMatched += res.matched;
          totalDispatched += res.dispatched;
          totalSkipped += res.skipped;
          totalFailed += res.failed;
        }

        logger.info(`[${CRON_NAME}] completed`, {
          totalMatched, totalDispatched, totalSkipped, totalFailed,
          perTouchpoint,
          timestamp: new Date().toISOString(),
        });

        return recordCronRun(CRON_NAME, {
          startedAt,
          durationMs: Date.now() - startMs,
          totalItems: totalMatched,
          success: totalDispatched,
          failure: totalFailed,
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
      error: error?.message || "Unknown rescue cron error",
      failure: 1,
    });
  } finally {
    isRunning = false;
  }
}

function startSubscriptionRescueCron() {
  const cfg = appConfig.subscriptionRescue || {};
  if (!cfg.enabled) {
    logger.info(`[${CRON_NAME}] disabled by ENABLE_SUBSCRIPTION_RESCUE_CRON`);
    return;
  }
  const schedule = cfg.schedule || "15 * * * *";
  if (!cron.validate(schedule)) {
    logger.warn(`[${CRON_NAME}] invalid cron schedule, skipping`, { schedule });
    return;
  }

  cron.schedule(schedule, () => {
    runSubscriptionRescueJob().catch((err) => {
      logger.error(`[${CRON_NAME}] unhandled job error`, { error: err.message, stack: err.stack });
    });
  });

  logger.info(`[${CRON_NAME}] scheduled`, { schedule, batchSize: cfg.batchSize || 200 });
}

module.exports = {
  CRON_NAME,
  processTouchpoint,
  runSubscriptionRescueJob,
  startSubscriptionRescueCron,
};
