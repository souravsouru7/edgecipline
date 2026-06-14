const cron = require("node-cron");
const { appConfig } = require("../config");
const userRepository = require("../repositories/user.repository");
const notificationService = require("../services/notificationService");
const { logger } = require("../utils/logger");
const { runCronWithMetrics } = require("../utils/cronMetrics");
const { withCronLock, isoWeekKey } = require("../utils/distributedLock");

const CRON_NAME = "weeklyReportsCron";
const LOCK_NAME = "weekly-report";
// 1-hour TTL — weekly reminder is a small notification fan-out; well under
// 1h even at 100K users with concurrency 50. Weekly cron fires once per
// scheduled day so stale-lock blocking time is bounded by that interval.
const LOCK_TTL_SECONDS = 60 * 60;
const MARKET_TYPES = ["Forex", "Indian_Market"];

let isRunning = false;

function resolveConcurrency() {
  return appConfig.cron.weeklyReportsConcurrency || appConfig.cron.concurrency;
}

function getWeeklyReminderKey(date = new Date()) {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  const day = start.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  start.setUTCDate(start.getUTCDate() - diff);
  return start.toISOString().slice(0, 10);
}

// Sends both market reminders for a single user. Per-market errors are caught
// individually so one failure does not poison the other reminder for that user.
async function sendRemindersForUser(user, weekKey) {
  const results = await Promise.allSettled(
    MARKET_TYPES.map((marketType) =>
      notificationService.notifyUser(user._id, {
        type: "weekly_report_reminder",
        title: "Weekly review is ready",
        body: "Your weekly trading review is ready. Generate it when you want AI feedback.",
        sourceType: "cron",
        dedupeKey: `weekly-report-reminder:${user._id}:${marketType}:${weekKey}`,
        deepLink: `/weekly-reports?marketType=${encodeURIComponent(marketType)}`,
        data: {
          screen: "weekly-report",
          marketType,
          action: "generate_on_demand",
        },
      })
    )
  );

  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    // Throw so the metrics layer counts this user as a failure. Log the
    // per-market detail so we can see WHICH market failed.
    failed.forEach((r, idx) => {
      logger.error(`[${CRON_NAME}] market reminder failed`, {
        userId: user._id?.toString?.(),
        marketType: MARKET_TYPES[idx],
        error: r.reason?.message,
      });
    });
    const err = new Error(`weekly reminder failed for ${failed.length}/${MARKET_TYPES.length} markets`);
    err.failedMarkets = failed.length;
    throw err;
  }
}

async function runWeeklyReportsJob() {
  if (isRunning) {
    logger.warn(`[${CRON_NAME}] previous run still in progress; skipping`);
    return null;
  }
  isRunning = true;

  try {
    // ISO week-of-year — same key for every cron tick that lands in the same
    // week, so even if the schedule overlaps a week boundary the second tick
    // in the new week always re-acquires.
    const lockSuffix = isoWeekKey(new Date());
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
        const weekKey = getWeeklyReminderKey();
        logger.info(`[${CRON_NAME}] starting`, {
          totalUsers: users.length,
          concurrency,
          weekKey,
        });

        return runCronWithMetrics({
          name:        CRON_NAME,
          items:       users,
          concurrency,
          work:        (user) => sendRemindersForUser(user, weekKey),
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

function startWeeklyReportsCron() {
  const enabled = appConfig.weeklyReports.enabled;
  if (!enabled) {
    logger.info(`[${CRON_NAME}] disabled by ENABLE_WEEKLY_REPORTS_CRON`);
    return;
  }

  const schedule = appConfig.weeklyReports.schedule;

  if (!cron.validate(schedule)) {
    logger.warn(`[${CRON_NAME}] invalid cron schedule, skipping`, { schedule });
    return;
  }

  cron.schedule(schedule, () => {
    logger.info(`[${CRON_NAME}] triggered`);
    runWeeklyReportsJob().catch((e) =>
      logger.error(`[${CRON_NAME}] job error`, { error: e?.message, stack: e?.stack })
    );
  });

  logger.info(`[${CRON_NAME}] scheduled`, { schedule, concurrency: resolveConcurrency() });
}

module.exports = { startWeeklyReportsCron, runWeeklyReportsJob };
