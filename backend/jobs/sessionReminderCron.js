const cron = require("node-cron");
const { appConfig } = require("../config");
const userRepository = require("../repositories/user.repository");
const notificationService = require("../services/notificationService");
const { resolveActiveMarketsForUsers } = require("../services/userMarketService");
const { logger } = require("../utils/logger");
const { runCronWithMetrics } = require("../utils/cronMetrics");
const { withCronLock, quarterHourKey } = require("../utils/distributedLock");
const { MARKETS, getMarketDayStatus } = require("../utils/marketCalendar");
const {
  DEFAULT_NOTIFICATION_TIMEZONE,
  getLocalDateKey,
  getLocalHourMinute,
  getUserNotificationTimezone,
  resolveTimeZone,
} = require("../utils/timezone");

const CRON_NAME = "sessionReminderCron";
const LOCK_NAME = "session-reminder";

// TTL must be SHORTER than the cron interval (15 min) so a crashed lock
// auto-clears before the next tick. 14 minutes leaves 1 minute headroom —
// the actual work is well under 1 minute even at 100K users with concurrency 50.
const LOCK_TTL_SECONDS = 14 * 60;

// Reasons a reminder was NOT sent. Logged with every decision so an operator
// can answer "why didn't user X get the London reminder on Tuesday?" from
// the logs alone.
const SKIP_REASONS = Object.freeze({
  MARKET_CLOSED: "MARKET_CLOSED",
  WEEKEND: "WEEKEND",
  HOLIDAY: "HOLIDAY",
  MARKET_NOT_ENABLED: "MARKET_NOT_ENABLED",
  PREFERENCE_DISABLED: "PREFERENCE_DISABLED",
});

// Each session belongs to exactly one market. The reminder is compared
// against the wall clock in the cron's timezone (IST by default); the
// market calendar decides whether that market is open on that day.
//
// Forex sessions keep their original wording (the session name already says
// which market it is). The Indian session is worded for the Indian market
// and deep-links into the Indian trading area — it must never reuse the
// Forex London/New York copy.
const DEFAULT_SESSIONS = [
  {
    id: "london_open",
    label: "London Open",
    market: MARKETS.FOREX,
    reminderTime: "12:45",
    openTime: "13:00",
    deepLink: "/trades?session=London",
    screen: "trades",
    title: "London Open starts soon",
    body: "London Open opens at 13:00. Review your plan before the first trade.",
  },
  {
    id: "new_york_open",
    label: "New York Open",
    market: MARKETS.FOREX,
    reminderTime: "18:15",
    openTime: "18:30",
    deepLink: "/trades?session=New%20York",
    screen: "trades",
    title: "New York Open starts soon",
    body: "New York Open opens at 18:30. Review your plan before the first trade.",
  },
  {
    id: "indian_market_open",
    label: "Indian Market Open",
    market: MARKETS.INDIAN,
    reminderTime: "09:00",
    openTime: "09:15",
    deepLink: "/indian-market/trades?session=Morning%20Session",
    screen: "indian-trades",
    title: "Indian Market opens at 9:15 AM",
    body: "NSE opens in 15 minutes. Check your setup and risk before the first trade.",
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

/**
 * Sessions whose reminder time matches this tick's wall clock. Market
 * open/closed state is NOT applied here — see getEligibleSessions — so tests
 * and logs can tell "nothing scheduled now" apart from "scheduled but closed".
 */
function getDueSessions(now = new Date(), timezone = getSessionReminderTimezone()) {
  const localTime = getLocalHourMinute(now, timezone);
  return DEFAULT_SESSIONS.filter((session) => session.reminderTime === localTime);
}

/**
 * Due sessions split into those whose market is open today and those it is
 * not, with the calendar's reason (WEEKEND / HOLIDAY) attached to the latter.
 */
function getEligibleSessions(now = new Date(), timezone = getSessionReminderTimezone()) {
  const eligible = [];
  const skipped = [];
  for (const session of getDueSessions(now, timezone)) {
    const status = getMarketDayStatus(session.market, now, timezone);
    if (status.open) {
      eligible.push(session);
    } else {
      skipped.push({ session, reason: status.reason || SKIP_REASONS.MARKET_CLOSED });
    }
  }
  return { eligible, skipped };
}

function logDecision(fields) {
  logger.info("SESSION_REMINDER_DECISION", fields);
}

async function sendSessionReminder(user, session, now = new Date(), timezone = getSessionReminderTimezone()) {
  const userId = user?._id ?? user;
  // The reminder fires on the cron's clock, but the *day* it belongs to is
  // keyed in the user's own zone so the dedupe key rolls over with their day.
  const userTimezone = getUserNotificationTimezone(user, timezone);
  const tradingDay = getLocalDateKey(now, userTimezone);
  const scheduledFor = `${getLocalDateKey(now, timezone)} ${session.reminderTime}`;
  const dedupeKey = `session-reminder:${userId}:${session.market}:${session.id}:${tradingDay}`;

  const notification = await notificationService.notifyUser(userId, {
    type: "session_reminder",
    title: session.title || `${session.label} starts soon`,
    body: session.body || `${session.label} opens at ${session.openTime}. Review your plan before the first trade.`,
    sourceType: "cron",
    dedupeKey,
    deepLink: session.deepLink,
    data: {
      screen: session.screen || "trades",
      marketType: session.market,
      session: session.id,
      scheduledFor,
      timezone,
    },
  });

  logDecision({
    notificationType: "session_reminder",
    marketType: session.market,
    userId: userId?.toString?.(),
    tradingDay,
    session: session.id,
    eligible: true,
    sent: Boolean(notification),
    status: notification?.status || null,
    reason: notification ? null : SKIP_REASONS.PREFERENCE_DISABLED,
    dedupeKey,
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

    // Weekend / holiday gate. Evaluated before the lock so a closed day is
    // as cheap as an off-schedule tick, and logged per session so the reason
    // is visible even when nothing goes out.
    const { eligible, skipped } = getEligibleSessions(now, timezone);
    for (const { session, reason } of skipped) {
      logDecision({
        notificationType: "session_reminder",
        marketType: session.market,
        session: session.id,
        tradingDay: getLocalDateKey(now, timezone),
        eligible: false,
        reason,
      });
    }
    if (!eligible.length) {
      logger.info("[SessionReminder] due sessions all closed today", {
        timezone,
        skipped: skipped.map(({ session, reason }) => `${session.id}:${reason}`),
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
        let marketsByUser;
        try {
          users = await userRepository.findUsersForSessionReminders();
          marketsByUser = await resolveActiveMarketsForUsers(users);
        } catch (error) {
          logger.error(`[${CRON_NAME}] failed to fetch users`, {
            error: error.message,
            stack: error.stack,
          });
          return null;
        }

        const concurrency = resolveConcurrency();
        const pairs = [];
        let marketNotEnabled = 0;
        for (const user of users) {
          const activeMarkets = marketsByUser.get(String(user._id)) || new Set();
          for (const session of eligible) {
            if (activeMarkets.has(session.market)) {
              pairs.push({ user, session });
            } else {
              marketNotEnabled += 1;
            }
          }
        }

        logger.info(`[${CRON_NAME}] starting`, {
          totalUsers: users.length,
          dueSessions: eligible.map((s) => `${s.market}:${s.id}`),
          totalPairs: pairs.length,
          skippedMarketNotEnabled: marketNotEnabled,
          reasonForSkips: SKIP_REASONS.MARKET_NOT_ENABLED,
          concurrency,
        });

        return runCronWithMetrics({
          name:        CRON_NAME,
          items:       pairs,
          concurrency,
          work:        ({ user, session }) => sendSessionReminder(user, session, now, timezone),
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
    sessions: DEFAULT_SESSIONS.map((s) => `${s.market}:${s.id}@${s.reminderTime}`),
    concurrency: resolveConcurrency(),
  });
}

module.exports = {
  DEFAULT_SESSIONS,
  SKIP_REASONS,
  getDueSessions,
  getEligibleSessions,
  runSessionReminderJob,
  sendSessionReminder,
  startSessionReminderCron,
};
