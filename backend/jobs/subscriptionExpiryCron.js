const cron = require("node-cron");
const User = require("../models/Users");
const { appConfig } = require("../config");
const { logger } = require("../utils/logger");
const { recordCronRun } = require("../utils/cronMetrics");
const { withCronLock } = require("../utils/distributedLock");
const { invalidateAuthCache } = require("../services/authCacheService");

const CRON_NAME = "subscriptionExpiryCron";
const LOCK_NAME = "subscription-expiry";
const LOCK_TTL_SECONDS = 55 * 60;

let isRunning = false;

function hourlyKey(date = new Date()) {
  return date.toISOString().slice(0, 13);
}

async function invalidateUsers(userIds) {
  await Promise.allSettled(userIds.map((userId) => invalidateAuthCache(userId)));
}

async function expireSubscriptionBatch(now, batchSize) {
  const users = await User.find({
    subscriptionStatus: "active",
    subscriptionExpiry: { $lt: now },
  })
    .select("_id subscriptionExpiry")
    .sort({ subscriptionExpiry: 1 })
    .limit(batchSize)
    .lean();

  if (!users.length) {
    return { matched: 0, modified: 0, userIds: [] };
  }

  const userIds = users.map((user) => user._id);
  const result = await User.updateMany(
    {
      _id: { $in: userIds },
      subscriptionStatus: "active",
      subscriptionExpiry: { $lt: now },
    },
    {
      $set: {
        subscriptionStatus: "expired",
      },
    }
  );

  await invalidateUsers(userIds);

  return {
    matched: result.matchedCount || result.n || 0,
    modified: result.modifiedCount || result.nModified || 0,
    userIds,
  };
}

async function expireSubscriptions(now = new Date()) {
  const batchSize = Math.max(1, appConfig.subscriptionExpiry?.batchSize || 500);
  let totalMatched = 0;
  let totalModified = 0;
  let batches = 0;

  while (true) {
    const batch = await expireSubscriptionBatch(now, batchSize);
    if (!batch.matched) break;

    batches += 1;
    totalMatched += batch.matched;
    totalModified += batch.modified;

    logger.info(`[${CRON_NAME}] expired subscription batch`, {
      matched: batch.matched,
      modified: batch.modified,
      timestamp: now.toISOString(),
    });

    if (batch.matched < batchSize) break;
  }

  return { totalMatched, totalModified, batches };
}

async function runSubscriptionExpiryJob(now = new Date()) {
  if (isRunning) {
    logger.warn(`[${CRON_NAME}] previous run still in progress; skipping`);
    return recordCronRun(CRON_NAME, {
      startedAt: now,
      durationMs: 0,
      skipped: 1,
    });
  }

  isRunning = true;
  const startedAt = new Date();
  const startMs = Date.now();

  try {
    const lockResult = await withCronLock(
      {
        name: LOCK_NAME,
        lockSuffix: hourlyKey(now),
        ttlSeconds: LOCK_TTL_SECONDS,
      },
      async () => {
        logger.info(`[${CRON_NAME}] starting`, {
          timestamp: now.toISOString(),
        });

        const result = await expireSubscriptions(now);

        logger.info(`[${CRON_NAME}] completed`, {
          usersExpired: result.totalModified,
          matched: result.totalMatched,
          batches: result.batches,
          timestamp: new Date().toISOString(),
        });

        return recordCronRun(CRON_NAME, {
          startedAt,
          durationMs: Date.now() - startMs,
          totalItems: result.totalMatched,
          success: result.totalModified,
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
      timestamp: new Date().toISOString(),
    });
    return recordCronRun(CRON_NAME, {
      startedAt,
      durationMs: Date.now() - startMs,
      error: error?.message || "Unknown subscription expiry error",
      failure: 1,
    });
  } finally {
    isRunning = false;
  }
}

function startSubscriptionExpiryCron() {
  const enabled = appConfig.subscriptionExpiry?.enabled;
  if (!enabled) {
    logger.info(`[${CRON_NAME}] disabled by ENABLE_SUBSCRIPTION_EXPIRY_CRON`);
    return;
  }

  const schedule = appConfig.subscriptionExpiry?.schedule || "0 * * * *";
  if (!cron.validate(schedule)) {
    logger.warn(`[${CRON_NAME}] invalid cron schedule, skipping`, { schedule });
    return;
  }

  cron.schedule(schedule, () => {
    runSubscriptionExpiryJob().catch((error) => {
      logger.error(`[${CRON_NAME}] unhandled job error`, {
        error: error?.message,
        stack: error?.stack,
      });
    });
  });

  logger.info(`[${CRON_NAME}] scheduled`, {
    schedule,
    batchSize: appConfig.subscriptionExpiry?.batchSize || 500,
  });
}

module.exports = {
  expireSubscriptionBatch,
  expireSubscriptions,
  hourlyKey,
  runSubscriptionExpiryJob,
  startSubscriptionExpiryCron,
};
