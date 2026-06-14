const cron = require("node-cron");
const { appConfig } = require("../config");
const userRepository = require("../repositories/user.repository");
const { sendMorningMentor } = require("../services/morningMentorService");
const { logger } = require("../utils/logger");
const { runCronWithMetrics } = require("../utils/cronMetrics");
const { withCronLock, isoDateKey } = require("../utils/distributedLock");

const CRON_NAME = "morningMentorCron";
const LOCK_NAME = "morning-mentor";
// 2-hour TTL covers worst-case run at 100K users with concurrency 50, with
// headroom. Daily cron fires only once per day so a stale lock can never
// block more than one tick.
const LOCK_TTL_SECONDS = 2 * 60 * 60;

let isRunning = false;

function resolveConcurrency() {
  return appConfig.cron.morningMentorConcurrency || appConfig.cron.concurrency;
}

async function runMorningMentorJob() {
  if (isRunning) {
    logger.warn(`[${CRON_NAME}] previous run still in progress; skipping`);
    return null;
  }
  isRunning = true;

  try {
    // Distributed lock — one cron-tick across the whole fleet. The key changes
    // daily, so a second instance launched on the same day is rejected; a new
    // day always gets a fresh lock. Lock self-clears via TTL if we crash.
    const lockSuffix = isoDateKey(new Date(), appConfig.morningMentor.timezone);
    const lockResult = await withCronLock(
      { name: LOCK_NAME, lockSuffix, ttlSeconds: LOCK_TTL_SECONDS },
      async () => {
        let users;
        try {
          users = await userRepository.findUsersForWeeklyReports();
        } catch (error) {
          logger.error(`[${CRON_NAME}] failed to fetch users`, {
            error: error.message,
            stack: error.stack,
          });
          return null;
        }

        const concurrency = resolveConcurrency();
        logger.info(`[${CRON_NAME}] starting`, { totalUsers: users.length, concurrency });

        return runCronWithMetrics({
          name:        CRON_NAME,
          items:       users,
          concurrency,
          work:        (user) => sendMorningMentor(user._id),
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

function startMorningMentorCron() {
  const { enabled, schedule, timezone = "Asia/Kolkata" } = appConfig.morningMentor;

  if (!enabled) {
    logger.info(`[${CRON_NAME}] disabled by ENABLE_MORNING_MENTOR_CRON`);
    return;
  }

  if (!cron.validate(schedule)) {
    logger.warn(`[${CRON_NAME}] invalid cron schedule, skipping`, { schedule });
    return;
  }

  cron.schedule(schedule, () => {
    logger.info(`[${CRON_NAME}] triggered`);
    runMorningMentorJob().catch((e) =>
      logger.error(`[${CRON_NAME}] job error`, { error: e?.message, stack: e?.stack })
    );
  }, { timezone });

  logger.info(`[${CRON_NAME}] scheduled`, { schedule, timezone, concurrency: resolveConcurrency() });
}

module.exports = { startMorningMentorCron, runMorningMentorJob };
