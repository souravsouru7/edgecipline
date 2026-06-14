const cron = require("node-cron");
const { appConfig } = require("../config");
const userRepository = require("../repositories/user.repository");
const notificationService = require("../services/notificationService");
const { logger } = require("../utils/logger");
const { runCronWithMetrics } = require("../utils/cronMetrics");
const { withCronLock, quarterHourKey } = require("../utils/distributedLock");
const {
  DEFAULT_NOTIFICATION_TIMEZONE,
  formatLocalTime,
  getLocalDateKey,
  resolveTimeZone,
} = require("../utils/timezone");

const CRON_NAME = "sessionReminderCron";
const LOCK_NAME = "session-reminder";
// TTL must be SHORTER than the cron interval (15 min) so a crashed lock
// auto-clears before the next tick. 14 minutes leaves 1 minute headroom —
// the actual work is well under 1 minute even at 100K users with concurrency 50.
const LOCK_TTL_SECONDS = 14 * 60;

const DEFAULT_SESSIONS = [
  {
    id: "london_open",
    label: "London Open",
    market: "Forex",
    reminderTime: "12:45",
    openTime: "13:00",
    deepLink: "/trades?session=London",
  },
  {
    id: "new_york_open",
    label: "New York Open",
    market: "Forex",
    reminderTime: "18:15",
    openTime: "18:30",
    deepLink: "/trades?session=New%20York",
  },
];

let isRunning = false;

function resolveConcurrency() {
  return appConfig.cron.sessionReminderConcurrency || appConfig.cron.concurrency;
}

function getSessionReminderTimezone() {
  const configuredTimezone = appConfig.sessionReminders?.timezone || DEFAULT_NOTIFICATION_TIMEZONE;
  const timezone = resolveTimeZone(configuredTimezone);
  if (timezone !== configuredTimezone) {
    logger.warn("[SessionReminder] invalid timezone; falling back to Asia/Kolkata", {
      timezone: configuredTimezone,
      fallbackTimezone: timezone,
    });
  }
  return timezone;
}

function getLocalHourMinute(date, timezone) {
  return formatLocalTime(date, timezone).slice(11, 16);
}

function getDueSessions(now = new Date(), timezone = getSessionReminderTimezone()) {
  const localTime = getLocalHourMinute(now, timezone);
  return DEFAULT_SESSIONS.filter((session) => session.reminderTime === localTime);
}

async function sendSessionReminder(userId, session, now = new Date(), timezone = getSessionReminderTimezone()) {
  const dateKey = getLocalDateKey(now, timezone);
  const scheduledFor = `${dateKey} ${session.reminderTime}`;
  const notification = await notificationService.notifyUser(userId, {
    type: "session_reminder",
    title: `${session.label} starts soon`,
    body: `${session.label} opens at ${session.openTime}. Review your plan before the first trade.`,
    sourceType: "cron",
    dedupeKey: `session-reminder:${userId}:${session.market}:${session.id}:${dateKey}`,
    deepLink: session.deepLink,
    data: {
      screen: "trades",
      marketType: session.market,
      session: session.id,
      scheduledFor,
      timezone,
    },
  });

  logger.info("[SessionReminder]", {
    userId: userId?.toString?.(),
    market: session.market,
    session: session.id,
    scheduledFor,
    sentAt: new Date().toISOString(),
    notificationSent: Boolean(notification),
  });

  return notification;
}

async function runSessionReminderJob(now = new Date()) {
  if (isRunning) {
    logger.warn(`[${CRON_NAME}] previous run still in progress; skipping`);
    return null;
  }
  isRunning = true;

  try {
    const timezone = getSessionReminderTimezone();
    const dueSessions = getDueSessions(now, timezone);

    // Fast-path: if no sessions are due in this tick, do NOT pay the
    // user-fetch cost OR the Redis lock round-trip. Cron fires every
    // 15 minutes; ~95% of ticks are no-ops.
    if (!dueSessions.length) {
      logger.info("[SessionReminder] no due sessions", {
        timezone,
        localTime: getLocalHourMinute(now, timezone),
      });
      return null;
    }

    // Lock per 15-minute tick (YYYY-MM-DDTHH:MM rounded to nearest :00/:15/:30/:45).
    // Two API instances triggered by the same cron tick will both attempt
    // acquire — the loser logs CRON_LOCK_EXISTS and exits without fan-out.
    const lockSuffix = quarterHourKey(now, timezone);
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

        const pairs = [];
        for (const user of users) {
          for (const session of dueSessions) {
            pairs.push({ user, session });
          }
        }

        logger.info(`[${CRON_NAME}] starting`, {
          totalUsers: users.length,
          dueSessions: dueSessions.map((s) => s.id),
          totalPairs: pairs.length,
          concurrency,
        });

        return runCronWithMetrics({
          name:        CRON_NAME,
          items:       pairs,
          concurrency,
          work:        ({ user, session }) => sendSessionReminder(user._id, session, now, timezone),
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

function startSessionReminderCron() {
  const enabled = appConfig.sessionReminders?.enabled;
  if (!enabled) {
    logger.info("[SessionReminder] disabled by ENABLE_SESSION_REMINDERS_CRON");
    return;
  }

  const schedule = appConfig.sessionReminders?.schedule || "*/15 * * * *";
  if (!cron.validate(schedule)) {
    logger.warn(`[${CRON_NAME}] invalid cron schedule, skipping`, { schedule });
    return;
  }

  cron.schedule(schedule, () => {
    runSessionReminderJob().catch((error) => {
      logger.error(`[${CRON_NAME}] job error`, {
        error: error?.message,
        stack: error?.stack,
      });
    });
  });

  logger.info(`[${CRON_NAME}] scheduled`, {
    schedule,
    timezone: getSessionReminderTimezone(),
    concurrency: resolveConcurrency(),
  });
}

module.exports = {
  DEFAULT_SESSIONS,
  getDueSessions,
  runSessionReminderJob,
  sendSessionReminder,
  startSessionReminderCron,
};
