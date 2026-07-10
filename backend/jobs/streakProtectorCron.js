const cron = require("node-cron");
const { appConfig } = require("../config");
const userRepository = require("../repositories/user.repository");
const streakService = require("../services/streak.service");
const { sendAtRisk } = require("../services/streakNotification.service");
const { logger } = require("../utils/logger");
const { runCronWithMetrics } = require("../utils/cronMetrics");
const { withCronLock, isoDateKey } = require("../utils/distributedLock");

const CRON_NAME = "streakProtectorCron";
const LOCK_NAME = "streak-protector";
// 2-hour TTL covers worst-case processing at 100K users with concurrency 50;
// the daily key changes at midnight so a stale lock can never block more
// than one tick.
const LOCK_TTL_SECONDS = 2 * 60 * 60;

let isRunning = false;

function resolveConcurrency() {
  return appConfig.cron.streakProtectorConcurrency || appConfig.cron.concurrency;
}

async function notifyOne(user, todayKey) {
  // Skip if today is already their last qualifying date — the streak is
  // safe.  We trust the denormalized value here (cron only); a real user
  // visit always re-reads via getStreakSnapshot.
  const lastDay = user?.streaks?.journal?.lastQualifyingDate;
  if (lastDay === todayKey) return null;
  const current = user?.streaks?.journal?.current || 0;
  return sendAtRisk(user._id, { currentStreak: current, dayKey: todayKey });
}

async function runStreakProtectorJob() {
  if (isRunning) {
    logger.warn(`[${CRON_NAME}] previous run still in progress; skipping`);
    return null;
  }
  isRunning = true;
  const minStreak = appConfig.streakProtector.minStreak;

  try {
    const lockSuffix = isoDateKey(new Date(), appConfig.streakProtector.timezone);
    const lockResult = await withCronLock(
      { name: LOCK_NAME, lockSuffix, ttlSeconds: LOCK_TTL_SECONDS },
      async () => {
        let users;
        try {
          users = await userRepository.findUsersWithActiveJournalStreak(minStreak);
        } catch (error) {
          logger.error(`[${CRON_NAME}] failed to fetch users`, {
            error: error.message,
            stack: error.stack,
          });
          return null;
        }

        const concurrency = resolveConcurrency();
        logger.info(`[${CRON_NAME}] starting`, { totalUsers: users.length, concurrency, minStreak });

        return runCronWithMetrics({
          name:        CRON_NAME,
          items:       users,
          concurrency,
          work:        (user) => {
            // Each user's day-key uses their own timezone so we never
            // nudge them after their local midnight has rolled the day.
            const tz = user?.streaks?.timezone || appConfig.streakProtector.timezone;
            const todayKey = streakService.dayKeyInTz(new Date(), tz);
            return notifyOne(user, todayKey);
          },
        });
      }
    );

    if (lockResult.skipped) {
      logger.info(`[${CRON_NAME}] lock held by peer; skipping`, { key: lockResult.key });
      return null;
    }
    return lockResult.result;
  } finally {
    isRunning = false;
  }
}

function startStreakProtectorCron() {
  const { enabled, schedule, timezone } = appConfig.streakProtector;

  if (!enabled) {
    logger.info(`[${CRON_NAME}] disabled by ENABLE_STREAK_PROTECTOR_CRON`);
    return;
  }

  if (!cron.validate(schedule)) {
    logger.warn(`[${CRON_NAME}] invalid cron schedule, skipping`, { schedule });
    return;
  }

  cron.schedule(schedule, () => {
    logger.info(`[${CRON_NAME}] triggered`);
    runStreakProtectorJob().catch((e) =>
      logger.error(`[${CRON_NAME}] job error`, { error: e?.message, stack: e?.stack })
    );
  }, { timezone });

  logger.info(`[${CRON_NAME}] scheduled`, { schedule, timezone, concurrency: resolveConcurrency() });
}

module.exports = { startStreakProtectorCron, runStreakProtectorJob };
