const cron = require("node-cron");
const { appConfig } = require("../config");
const { sendAtRisk } = require("../services/streakNotification.service");
const { runLocalTimeJob } = require("../services/localTimeJobRunner");
const { LOCAL_TIME_TICK, parseLocalTime } = require("../utils/localTimeSchedule");
const { getLocalCalendarDateAfter, getLocalDateKey, getTimeZoneParts } = require("../utils/timezone");
const { logger } = require("../utils/logger");

const CRON_NAME = "streakProtectorCron";
const LOCK_NAME = "streak-protector";
const DEFAULT_TARGET = { hour: 21, minute: 0 };

let isRunning = false;

function resolveConcurrency() {
  return appConfig.cron.streakProtectorConcurrency || appConfig.cron.concurrency;
}

function yesterdayKey(now, timezone) {
  const day = getLocalCalendarDateAfter(getTimeZoneParts(now, timezone), -1);
  return `${day.year}-${String(day.month).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`;
}

/**
 * A journal streak is alive only while its last qualifying day is today or
 * yesterday (streak.service computeStreaksFromEntries). It is "at risk" —
 * worth a push — only when that day is exactly YESTERDAY: alive, but needs
 * today. The stored `current` is only recomputed when the user acts, so a
 * user who stopped weeks ago still had current=12 and was told "Your 12-day
 * streak is alive" every night.
 */
function streakAtRisk(user, now, timezone, minStreak) {
  const journal = user?.streaks?.journal || {};
  if ((journal.current || 0) < minStreak) return false;
  return journal.lastQualifyingDate === yesterdayKey(now, timezone);
}

async function runStreakProtectorJob(now = new Date()) {
  if (isRunning) {
    logger.warn(`[${CRON_NAME}] previous run still in progress; skipping`);
    return null;
  }
  isRunning = true;
  const minStreak = appConfig.streakProtector?.minStreak ?? 3;
  try {
    return await runLocalTimeJob({
      name: CRON_NAME,
      lockName: LOCK_NAME,
      target: parseLocalTime(appConfig.streakProtector?.localTime, DEFAULT_TARGET),
      concurrency: resolveConcurrency(),
      now,
      filterUsers: (users, { timezone }) => users.filter((u) => streakAtRisk(u, now, timezone, minStreak)),
      work: (user, ctx) => sendAtRisk(user._id, {
        currentStreak: user.streaks.journal.current,
        dayKey: getLocalDateKey(ctx.now, ctx.timezone),
      }),
    });
  } finally {
    isRunning = false;
  }
}

function startStreakProtectorCron() {
  if (!appConfig.streakProtector?.enabled) {
    logger.info(`[${CRON_NAME}] disabled by ENABLE_STREAK_PROTECTOR_CRON`);
    return;
  }

  cron.schedule(LOCAL_TIME_TICK, () => {
    runStreakProtectorJob().catch((e) =>
      logger.error(`[${CRON_NAME}] job error`, { error: e?.message, stack: e?.stack })
    );
  });

  logger.info(`[${CRON_NAME}] scheduled`, {
    tick: LOCAL_TIME_TICK,
    localTime: appConfig.streakProtector?.localTime || "21:00",
    concurrency: resolveConcurrency(),
  });
}

module.exports = { startStreakProtectorCron, runStreakProtectorJob, streakAtRisk };
