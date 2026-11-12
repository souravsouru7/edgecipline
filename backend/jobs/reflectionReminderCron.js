const cron = require("node-cron");
const { appConfig } = require("../config");
const Trade = require("../models/Trade");
const IndianTrade = require("../models/IndianTrade");
const DailyReflection = require("../models/DailyReflection");
const notificationService = require("../services/notificationService");
const { runLocalTimeJob } = require("../services/localTimeJobRunner");
const { LOCAL_TIME_TICK, parseLocalTime } = require("../utils/localTimeSchedule");
const { getDayRange, getLocalDateKey } = require("../utils/timezone");
const { logger } = require("../utils/logger");

const CRON_NAME = "reflectionReminderCron";
const LOCK_NAME = "reflection-reminder";
const DEFAULT_TARGET = { hour: 19, minute: 30 };

// Variant chosen per user from TODAY's activity, in the user's timezone.
const VARIANTS = {
  logged_trades: {
    title: "Close the day",
    body:  "You traded today. 30 seconds of reflection turns today's trades into lessons.",
  },
  no_trades: {
    title: "Quiet day: worth a check-in",
    body:  "No trades today. A quick reflection still keeps your discipline record honest.",
  },
};

let isRunning = false;

function resolveConcurrency() {
  return (
    appConfig.reflectionReminder?.concurrency ||
    appConfig.cron?.reflectionReminderConcurrency ||
    appConfig.cron?.concurrency ||
    50
  );
}

/**
 * null when the user already reflected (or skipped) today; otherwise the
 * variant key. "Today" is the user's local calendar day — the old check
 * looked at a three-day UTC window and said "You traded today" about
 * yesterday's trades.
 */
async function classifyUser(userId, dayKey, timezone, now = new Date()) {
  const existing = await DailyReflection.findOne({ user: userId, day: dayKey })
    .select({ _id: 1 })
    .lean();
  if (existing) return null;

  const { start, end } = getDayRange(now, timezone);
  const inRange = { $gte: start, $lt: end };
  // When the trade happened (tradeDate), falling back to when it was saved.
  const dateFilter = { $or: [{ tradeDate: inRange }, { tradeDate: null, createdAt: inRange }] };
  const [forexCount, indianCount] = await Promise.all([
    Trade.countDocuments({ user: userId, deletedAt: null, "parsedData.multiTradeGhost": { $ne: true }, ...dateFilter }),
    IndianTrade.countDocuments({ user: userId, deletedAt: null, ...dateFilter }),
  ]);
  return forexCount + indianCount > 0 ? "logged_trades" : "no_trades";
}

async function sendReminder(userId, dayKey, timezone, now = new Date()) {
  const variantKey = await classifyUser(userId, dayKey, timezone, now);
  if (!variantKey) return { skipped: true, reason: "already_reflected" };
  const variant = VARIANTS[variantKey];

  await notificationService.notifyUser(userId, {
    type:       "evening_reflection",
    title:      variant.title,
    body:       variant.body,
    sourceType: "cron",
    dedupeKey:  `evening-reflection:${userId}:${dayKey}`,
    deepLink:   "/reflection",
    data: { screen: "reflection", variant: variantKey, day: dayKey },
  });

  return { sent: true, variant: variantKey };
}

// 19:30 in each user's own timezone, to reachable users who have logged at
// least one trade (it used to go to every User document, admins included).
// Runs on weekends too — reflecting on a quiet day is still useful.
async function runReflectionReminderJob(now = new Date()) {
  if (isRunning) {
    logger.warn(`[${CRON_NAME}] previous run still in progress; skipping`);
    return null;
  }
  isRunning = true;
  try {
    return await runLocalTimeJob({
      name: CRON_NAME,
      lockName: LOCK_NAME,
      target: parseLocalTime(appConfig.reflectionReminder?.localTime, DEFAULT_TARGET),
      requireTrades: true,
      concurrency: resolveConcurrency(),
      now,
      work: (user, ctx) => sendReminder(user._id, getLocalDateKey(ctx.now, ctx.timezone), ctx.timezone, ctx.now),
    });
  } finally {
    isRunning = false;
  }
}

function startReflectionReminderCron() {
  if (!appConfig.reflectionReminder?.enabled) {
    logger.info(`[${CRON_NAME}] disabled by ENABLE_REFLECTION_REMINDER_CRON`);
    return;
  }

  cron.schedule(LOCAL_TIME_TICK, () => {
    runReflectionReminderJob().catch((error) =>
      logger.error(`[${CRON_NAME}] job error`, { error: error?.message, stack: error?.stack })
    );
  });

  logger.info(`[${CRON_NAME}] scheduled`, {
    tick: LOCAL_TIME_TICK,
    localTime: appConfig.reflectionReminder?.localTime || "19:30",
    concurrency: resolveConcurrency(),
  });
}

module.exports = {
  VARIANTS,
  classifyUser,
  runReflectionReminderJob,
  sendReminder,
  startReflectionReminderCron,
};
