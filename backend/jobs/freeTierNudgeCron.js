"use strict";

const cron = require("node-cron");
const { hourlyKey } = require("../utils/dateUtils");
const User = require("../models/Users");
const { appConfig } = require("../config");
const { logger } = require("../utils/logger");
const { recordCronRun } = require("../utils/cronMetrics");
const { withCronLock } = require("../utils/distributedLock");
const {
  TOUCHPOINTS,
  windowForTouchpoint,
  eligibleUserFilter,
  dispatchTouchpoint,
} = require("../services/freeTierNudgeService");
const { buildFreeTierContext, isFunnelEligible } = require("../services/freeTierFunnelService");
const { LIMIT_ENFORCED } = require("../services/tradeQuotaService");

// Hourly free-tier nudge funnel. Structure mirrors subscriptionRescueCron:
// one pass per touchpoint, a ±12h window around T0 + daysOffset, and the
// RescueDispatch unique index as the idempotency guarantee — a rerun, a
// second instance, or a lock that expired mid-run can only produce
// duplicate-key no-ops, never a second push.

const CRON_NAME = "freeTierNudgeCron";
const LOCK_NAME = "free-tier-nudge";
const LOCK_TTL_SECONDS = 55 * 60;

// Fields the dispatch needs to (re)decide eligibility and personalise copy.
const USER_PROJECTION =
  "_id email name role accountStatus pendingDeletion streaks freeTier trial "
  + "subscriptionStatus subscriptionExpiry playEntitlementExpiry totalPaid";

let isRunning = false;

async function processTouchpoint(touchpoint, now, batchSize) {
  const { from, to } = windowForTouchpoint(touchpoint, now.getTime());

  const users = await User.find({
    ...eligibleUserFilter(),
    "freeTier.lastFreeTradeAt": { $gte: from, $lte: to },
  })
    .select(USER_PROJECTION)
    .limit(batchSize)
    .lean();

  if (!users.length) return { matched: 0, dispatched: 0, skipped: 0, failed: 0 };

  let dispatched = 0;
  let skipped = 0;
  let failed = 0;

  for (const user of users) {
    try {
      // The query above is a coarse filter; the hydrated document decides.
      // Anyone who paid since the query ran is skipped here.
      if (!isFunnelEligible(user)) {
        skipped += 1;
        continue;
      }
      const context = await buildFreeTierContext(user);
      const result = await dispatchTouchpoint({ user, touchpoint, context, now });
      if (result.alreadyDispatched || result.skipped) skipped += 1;
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

async function runFreeTierNudgeJob(now = new Date()) {
  if (isRunning) {
    logger.warn(`[${CRON_NAME}] previous run still in progress; skipping`);
    return recordCronRun(CRON_NAME, { startedAt: now, durationMs: 0, skipped: 1 });
  }

  isRunning = true;
  const startedAt = new Date();
  const startMs = Date.now();
  const batchSize = Math.max(1, appConfig.freeTierNudge?.batchSize || 200);

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
      error: error?.message || "Unknown free-tier nudge cron error",
      failure: 1,
    });
  } finally {
    isRunning = false;
  }
}

function startFreeTierNudgeCron() {
  const cfg = appConfig.freeTierNudge || {};
  if (!cfg.enabled) {
    logger.info(`[${CRON_NAME}] disabled by ENABLE_FREE_TIER_NUDGE_CRON`);
    return;
  }
  // With the free limit unenforced there is no exhaustion, so nothing to
  // nudge about — and the service never stamps T0 in that mode anyway.
  if (!LIMIT_ENFORCED) {
    logger.info(`[${CRON_NAME}] disabled: FREE_TRADE_LIMIT_ENFORCED=false`);
    return;
  }
  const schedule = cfg.schedule || "35 * * * *";
  if (!cron.validate(schedule)) {
    logger.warn(`[${CRON_NAME}] invalid cron schedule, skipping`, { schedule });
    return;
  }

  cron.schedule(schedule, () => {
    runFreeTierNudgeJob().catch((err) => {
      logger.error(`[${CRON_NAME}] unhandled job error`, { error: err.message, stack: err.stack });
    });
  });

  logger.info(`[${CRON_NAME}] scheduled`, { schedule, batchSize: cfg.batchSize || 200 });
}

module.exports = {
  CRON_NAME,
  USER_PROJECTION,
  processTouchpoint,
  runFreeTierNudgeJob,
  startFreeTierNudgeCron,
};
