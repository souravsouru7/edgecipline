const cron = require("node-cron");
const { appConfig } = require("../config");
const userRepository = require("../repositories/user.repository");
const notificationService = require("../services/notificationService");
const { resolveActiveMarketsForUsers } = require("../services/userMarketService");
const { logger } = require("../utils/logger");
const { runCronWithMetrics } = require("../utils/cronMetrics");
const { withCronLock } = require("../utils/distributedLock");
const { MARKETS, getMarketDayStatus } = require("../utils/marketCalendar");
const {
  getLocalDateKey,
  getLocalDayOfWeek,
  getTimeZoneParts,
  getUserNotificationTimezone,
  zonedTimeToUtc,
} = require("../utils/timezone");

const CRON_NAME = "sessionReminderCron";
const LOCK_NAME = "session-reminder";

// The cron ticks every 15 minutes. A session is "due" from its reminder time
// until DUE_WINDOW_MS later, so one late or skipped tick still sends it. The
// per-occurrence lock (held to expiry) + the per-user dedupe key make sure
// the second tick inside the window sends nothing.
const DUE_WINDOW_MS = 30 * 60 * 1000;
const OCCURRENCE_LOCK_TTL_SECONDS = 45 * 60;

// The user's night, in their own timezone. A reminder that would land here is
// skipped (a US trader does not want "London opens" at 03:00).
const USER_NIGHT = Object.freeze({ startHour: 23, endHour: 6 });

// Reasons a reminder was NOT sent. Logged with every decision so an operator
// can answer "why didn't user X get the London reminder on Tuesday?" from
// the logs alone.
const SKIP_REASONS = Object.freeze({
  MARKET_CLOSED: "MARKET_CLOSED",
  WEEKEND: "WEEKEND",
  HOLIDAY: "HOLIDAY",
  MARKET_NOT_ENABLED: "MARKET_NOT_ENABLED",
  PREFERENCE_DISABLED: "PREFERENCE_DISABLED",
  USER_WEEKEND: "USER_WEEKEND",
  USER_NIGHT: "USER_NIGHT",
});

// Each session is defined in ITS OWN market's timezone, so daylight saving is
// handled by the calendar instead of by hand:
//   London 08:00 Europe/London   = 12:30 IST in summer, 13:30 IST in winter
//   New York 08:00 America/New_York = 17:30 IST in US summer, 18:30 in winter
// The old table hard-coded IST wall times (13:00 / 18:30), which were wrong
// for half the year and in the London case never right.
//
// Copy is relative ("in 15 minutes") so it is correct in every user timezone.
const DEFAULT_SESSIONS = [
  {
    id: "london_open",
    label: "London session",
    market: MARKETS.FOREX,
    timezone: "Europe/London",
    open: { hour: 8, minute: 0 },
    leadMinutes: 15,
    deepLink: "/trades?session=London",
    screen: "trades",
    title: "London session opens in 15 minutes",
    body: "Review your plan and risk before your first trade.",
  },
  {
    id: "new_york_open",
    label: "New York session",
    market: MARKETS.FOREX,
    timezone: "America/New_York",
    open: { hour: 8, minute: 0 },
    leadMinutes: 15,
    deepLink: "/trades?session=New%20York",
    screen: "trades",
    title: "New York session opens in 15 minutes",
    body: "Review your plan and risk before your first trade.",
  },
  {
    id: "indian_market_open",
    label: "Indian Market Open",
    market: MARKETS.INDIAN,
    timezone: "Asia/Kolkata",
    open: { hour: 9, minute: 15 },
    leadMinutes: 15,
    deepLink: "/indian-market/trades?session=Morning%20Session",
    screen: "indian-trades",
    title: "NSE opens at 9:15 AM",
    body: "Opens in 15 minutes. Check your setup and risk before the first trade.",
  },
];

let isRunning = false;

function resolveConcurrency() {
  return appConfig.cron.sessionReminderConcurrency || appConfig.cron.concurrency;
}

/**
 * When today's occurrence of a session is due, in UTC. "Today" is the
 * session's own market date at `now`.
 */
function getSessionOccurrence(session, now = new Date()) {
  const local = getTimeZoneParts(now, session.timezone);
  const openAt = zonedTimeToUtc(
    { year: local.year, month: local.month, day: local.day, hour: session.open.hour, minute: session.open.minute, second: 0 },
    session.timezone
  );
  const remindAt = new Date(openAt.getTime() - session.leadMinutes * 60 * 1000);
  return {
    openAt,
    remindAt,
    // Market-local date of the session — the identity of this occurrence.
    marketDate: getLocalDateKey(openAt, session.timezone),
  };
}

/**
 * Sessions whose reminder is due at `now` (within the due window). Market
 * open/closed state is NOT applied here — see getEligibleSessions — so tests
 * and logs can tell "nothing scheduled now" apart from "scheduled but closed".
 */
function getDueSessions(now = new Date()) {
  const nowMs = now.getTime();
  return DEFAULT_SESSIONS.filter((session) => {
    const { remindAt } = getSessionOccurrence(session, now);
    return nowMs >= remindAt.getTime() && nowMs < remindAt.getTime() + DUE_WINDOW_MS;
  });
}

/**
 * Due sessions split into those whose market is open on the session's own
 * date (weekday + holiday rules in the market's timezone) and those that are
 * not, with the calendar's reason attached.
 */
function getEligibleSessions(now = new Date()) {
  const eligible = [];
  const skipped = [];
  for (const session of getDueSessions(now)) {
    const { openAt } = getSessionOccurrence(session, now);
    const status = getMarketDayStatus(session.market, openAt, session.timezone);
    if (status.open) {
      eligible.push(session);
    } else {
      skipped.push({ session, reason: status.reason || SKIP_REASONS.MARKET_CLOSED });
    }
  }
  return { eligible, skipped };
}

/**
 * Per-user gate: never on the user's own Saturday/Sunday, never in their
 * night. Returns null when the user should get it, or the skip reason.
 */
function getUserSkipReason(userTimezone, now = new Date()) {
  const day = getLocalDayOfWeek(now, userTimezone);
  if (day === 0 || day === 6) return SKIP_REASONS.USER_WEEKEND;
  const { hour } = getTimeZoneParts(now, userTimezone);
  if (hour >= USER_NIGHT.startHour || hour < USER_NIGHT.endHour) return SKIP_REASONS.USER_NIGHT;
  return null;
}

function logDecision(fields) {
  logger.info("SESSION_REMINDER_DECISION", fields);
}

async function sendSessionReminder(user, session, now = new Date()) {
  const userId = user?._id ?? user;
  const userTimezone = getUserNotificationTimezone(user);
  const { marketDate, openAt } = getSessionOccurrence(session, now);
  // Same key shape as before (user's local day) so a deploy mid-day cannot
  // re-send a reminder that already went out under the old code.
  const tradingDay = getLocalDateKey(now, userTimezone);
  const dedupeKey = `session-reminder:${userId}:${session.market}:${session.id}:${tradingDay}`;

  const userSkip = getUserSkipReason(userTimezone, now);
  if (userSkip) {
    logDecision({
      notificationType: "session_reminder",
      marketType: session.market,
      userId: userId?.toString?.(),
      session: session.id,
      marketDate,
      userTimezone,
      eligible: false,
      sent: false,
      reason: userSkip,
    });
    return null;
  }

  const notification = await notificationService.notifyUser(userId, {
    type: "session_reminder",
    title: session.title,
    body: session.body,
    sourceType: "cron",
    dedupeKey,
    deepLink: session.deepLink,
    data: {
      screen: session.screen || "trades",
      marketType: session.market,
      session: session.id,
      opensAt: openAt.toISOString(),
      marketDate,
    },
  });

  logDecision({
    notificationType: "session_reminder",
    marketType: session.market,
    userId: userId?.toString?.(),
    tradingDay,
    marketDate,
    session: session.id,
    eligible: true,
    sent: Boolean(notification),
    status: notification?.status || null,
    reason: notification ? null : SKIP_REASONS.PREFERENCE_DISABLED,
    dedupeKey,
  });
  return notification;
}

async function sendOccurrence(session, now) {
  const { marketDate } = getSessionOccurrence(session, now);
  return withCronLock(
    {
      name: LOCK_NAME,
      lockSuffix: `${session.id}:${marketDate}`,
      ttlSeconds: OCCURRENCE_LOCK_TTL_SECONDS,
      // Keep the lock for the whole due window: the next tick (still inside
      // the window) and any peer instance must not fan out again.
      holdUntilExpiry: true,
    },
    async () => {
      let users;
      let marketsByUser;
      try {
        users = await userRepository.findUsersForSessionReminders();
        marketsByUser = await resolveActiveMarketsForUsers(users);
      } catch (error) {
        logger.error(`[${CRON_NAME}] failed to fetch users`, { error: error.message, stack: error.stack });
        // Throw so the lock is released and the next tick in the window retries.
        throw error;
      }

      const targets = users.filter((user) => (marketsByUser.get(String(user._id)) || new Set()).has(session.market));
      logger.info(`[${CRON_NAME}] starting`, {
        session: session.id,
        marketDate,
        totalUsers: users.length,
        targets: targets.length,
        skippedMarketNotEnabled: users.length - targets.length,
        concurrency: resolveConcurrency(),
      });

      return runCronWithMetrics({
        name: `${CRON_NAME}:${session.id}`,
        items: targets,
        concurrency: resolveConcurrency(),
        work: (user) => sendSessionReminder(user, session, now),
      });
    }
  );
}

async function runSessionReminderJob(now = new Date()) {
  if (isRunning) {
    logger.warn(`[${CRON_NAME}] previous run still in progress; skipping`);
    return null;
  }

  isRunning = true;
  try {
    // Fast-path: ~95% of 15-minute ticks have nothing due.
    if (!getDueSessions(now).length) return null;

    const { eligible, skipped } = getEligibleSessions(now);
    for (const { session, reason } of skipped) {
      logDecision({
        notificationType: "session_reminder",
        marketType: session.market,
        session: session.id,
        marketDate: getSessionOccurrence(session, now).marketDate,
        eligible: false,
        reason,
      });
    }

    const results = [];
    for (const session of eligible) {
      try {
        const lockResult = await sendOccurrence(session, now);
        if (lockResult.skipped) {
          logger.info(`[${CRON_NAME}] occurrence already handled`, { session: session.id, key: lockResult.key });
          continue;
        }
        results.push(lockResult.result);
      } catch (error) {
        logger.error(`[${CRON_NAME}] session failed`, { session: session.id, error: error.message });
      }
    }
    return results.length ? results : null;
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
      logger.error(`[${CRON_NAME}] job error`, { error: error?.message, stack: error?.stack });
    });
  });

  logger.info(`[${CRON_NAME}] scheduled`, {
    schedule,
    sessions: DEFAULT_SESSIONS.map((s) => `${s.market}:${s.id}@${String(s.open.hour).padStart(2, "0")}:${String(s.open.minute).padStart(2, "0")} ${s.timezone}`),
    concurrency: resolveConcurrency(),
  });
}

module.exports = {
  DEFAULT_SESSIONS,
  SKIP_REASONS,
  getDueSessions,
  getEligibleSessions,
  getSessionOccurrence,
  getUserSkipReason,
  runSessionReminderJob,
  sendSessionReminder,
  startSessionReminderCron,
};
