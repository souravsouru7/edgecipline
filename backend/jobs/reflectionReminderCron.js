const cron = require("node-cron");
const { appConfig } = require("../config");
const userRepository = require("../repositories/user.repository");
const Trade = require("../models/Trade");
const IndianTrade = require("../models/IndianTrade");
const DailyReflection = require("../models/DailyReflection");
const notificationService = require("../services/notificationService");
const streakService = require("../services/streak.service");
const { logger } = require("../utils/logger");
const { runCronWithMetrics } = require("../utils/cronMetrics");
const { withCronLock, isoDateKey } = require("../utils/distributedLock");

const CRON_NAME = "reflectionReminderCron";
const LOCK_NAME = "reflection-reminder";
// Two hours covers a 100K-user batch at concurrency 50 with headroom. Daily
// cron, lock self-clears via TTL.
const LOCK_TTL_SECONDS = 2 * 60 * 60;

// Three smart variants. Choice is made per-user from today's activity.
const VARIANTS = {
  logged_trades: {
    title: "📓 Close the day.",
    body:  "You traded today. 30 seconds of reflection turns trades into lessons.",
  },
  no_trades: {
    title: "🧘 Quiet day — worth a check-in.",
    body:  "No trades today. A quick reflection still keeps the streak alive and the discipline sharp.",
  },
  no_login: {
    title: "🌙 Did the market move you today?",
    body:  "Tap to log how today felt. Less than 30 seconds — and your weekly insight gets sharper.",
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

function startOfDayUtcRange(dayKey) {
  // dayKey is YYYY-MM-DD; we widen one calendar day each side so trades that
  // straddle UTC midnight in either direction are still counted.
  const [y, m, d] = dayKey.split("-").map(Number);
  const mid = Date.UTC(y, m - 1, d);
  return {
    start: new Date(mid - 24 * 60 * 60 * 1000),
    end:   new Date(mid + 2 * 24 * 60 * 60 * 1000),
  };
}

async function classifyUser(userId, dayKey) {
  // Already reflected (or already skipped) → no nudge.
  const existing = await DailyReflection.findOne({ user: userId, day: dayKey })
    .select({ _id: 1 })
    .lean();
  if (existing) return null;

  // Did the user trade today? Count is cheap with the indexed query.
  const { start, end } = startOfDayUtcRange(dayKey);
  const tradeFilter = {
    user: userId,
    deletedAt: null,
    createdAt: { $gte: start, $lte: end },
  };
  const [forexCount, indianCount] = await Promise.all([
    Trade.countDocuments({ ...tradeFilter, "parsedData.multiTradeGhost": { $ne: true } }),
    IndianTrade.countDocuments(tradeFilter),
  ]);
  const tradedToday = forexCount + indianCount > 0;

  // Logged-in check: any trade activity today implies an active session.
  // For "no login" we leave the heuristic permissive — if the user neither
  // traded nor reflected and we're past 7:30 PM local, the reminder still
  // ships under the no_login variant.
  if (tradedToday) return "logged_trades";
  return "no_login"; // could refine with a real "last active" signal later
}

async function sendReminder(userId, dayKey) {
  const variantKey = await classifyUser(userId, dayKey);
  if (!variantKey) return { skipped: true, reason: "already_reflected" };

  // Map no_login → no_trades when the user has no trades today and we want a
  // more focused message; we keep both variants distinct so they're tuneable
  // independently as we learn from open rates.
  const variant = VARIANTS[variantKey] || VARIANTS.no_login;

  await notificationService.notifyUser(userId, {
    type:      "evening_reflection",
    title:     variant.title,
    body:      variant.body,
    sourceType: "cron",
    dedupeKey: `evening-reflection:${userId}:${dayKey}`,
    deepLink:  "/reflection",
    data: {
      screen: "reflection",
      variant: variantKey,
      day:     dayKey,
    },
  });

  return { sent: true, variant: variantKey };
}

async function runReflectionReminderJob(now = new Date()) {
  if (isRunning) {
    logger.warn(`[${CRON_NAME}] previous run still in progress; skipping`);
    return null;
  }
  isRunning = true;

  try {
    const timezone = appConfig.reflectionReminder?.timezone || "Asia/Kolkata";
    const dayKey = isoDateKey(now, timezone);
    const lockResult = await withCronLock(
      { name: LOCK_NAME, lockSuffix: dayKey, ttlSeconds: LOCK_TTL_SECONDS },
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
        logger.info(`[${CRON_NAME}] starting`, {
          totalUsers: users.length,
          concurrency,
          dayKey,
        });

        return runCronWithMetrics({
          name: CRON_NAME,
          items: users,
          concurrency,
          work: async (user) => {
            // Use the user's own timezone for the dayKey when computing
            // "today's reflection exists". Falls back to the cron's timezone
            // when the user has no preference set.
            let userDayKey = dayKey;
            try {
              const snap = await streakService.getStreakSnapshot(user._id);
              if (snap?.todayKey) userDayKey = snap.todayKey;
            } catch {
              // Best-effort; fall through to the cron-wide dayKey.
            }
            await sendReminder(user._id, userDayKey);
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

function startReflectionReminderCron() {
  const cfg = appConfig.reflectionReminder || {};
  if (!cfg.enabled) {
    logger.info(`[${CRON_NAME}] disabled by ENABLE_REFLECTION_REMINDER_CRON`);
    return;
  }

  const schedule = cfg.schedule || "30 19 * * *";
  const timezone = cfg.timezone || "Asia/Kolkata";

  if (!cron.validate(schedule)) {
    logger.warn(`[${CRON_NAME}] invalid cron schedule, skipping`, { schedule });
    return;
  }

  cron.schedule(schedule, () => {
    logger.info(`[${CRON_NAME}] triggered`);
    runReflectionReminderJob().catch((error) =>
      logger.error(`[${CRON_NAME}] job error`, {
        error: error?.message,
        stack: error?.stack,
      })
    );
  }, { timezone });

  logger.info(`[${CRON_NAME}] scheduled`, {
    schedule,
    timezone,
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
