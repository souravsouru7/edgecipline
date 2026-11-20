const CoachMessage = require("../models/CoachMessage");
const { isPremium } = require("../utils/premium");
const { isoWeekKey } = require("../utils/distributedLock");
const { client: redis, isRedisReady } = require("../config/redis");
const { logger } = require("../utils/logger");

const { appConfig } = require("../config");

// Free tier: N user-authored questions per ISO week (default 5).
// Premium: a fair-use cap per UTC day (default 40). No real trader asks that
// many in a day; a script looping the endpoint does, and each question costs
// ~10-20k Gemini tokens.
const FREE_WEEKLY_LIMIT = Math.max(0, Number(appConfig.ai?.coachFreeWeeklyLimit ?? 5));
const PREMIUM_DAILY_LIMIT = Math.max(1, Number(appConfig.ai?.coachPremiumDailyLimit ?? 40));
// We piggy-back on the ISO week so quota resets at the same instant for every
// user (Monday 00:00 UTC). Keeps support conversations simple.
const QUOTA_TTL_SECONDS = 14 * 24 * 60 * 60;
const DAILY_TTL_SECONDS = 2 * 24 * 60 * 60;

function quotaKey(userId, weekKey) {
  return `coach:quota:${userId}:${weekKey}`;
}

function utcDayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function dailyKey(userId, dayKey) {
  return `coach:quota:day:${userId}:${dayKey}`;
}

function dayStartFromKey(dayKey) {
  return new Date(`${dayKey}T00:00:00.000Z`);
}

// Authoritative counter: Mongo. Redis is just a hot cache used to short-circuit
// the count read in the common case (logged-in user asking another question
// within the same minute). On Redis miss/failure we recount from Mongo so the
// quota cannot be bypassed by cache problems.
async function readUsage(userId, weekKey) {
  if (isRedisReady()) {
    try {
      const cached = await redis.get(quotaKey(userId, weekKey));
      if (cached != null) {
        const n = Number(cached);
        if (Number.isFinite(n)) return n;
      }
    } catch (error) {
      logger.warn("COACH_QUOTA_REDIS_READ_FAILED", { userId: String(userId), error: error?.message });
    }
  }

  const sevenDaysAgo = weekStartFromKey(weekKey);
  const count = await CoachMessage.countDocuments({
    user: userId,
    role: "user",
    // A refunded turn (the reply failed upstream) and a superseded one (the
    // user retried it) are explicitly flagged, so they drop out of the count.
    billable: { $ne: false },
    superseded: { $ne: true },
    createdAt: { $gte: sevenDaysAgo },
  });

  if (isRedisReady()) {
    try {
      await redis.set(quotaKey(userId, weekKey), String(count), "EX", QUOTA_TTL_SECONDS);
    } catch {
      // best-effort prime
    }
  }

  return count;
}

function weekStartFromKey(weekKey) {
  // weekKey is YYYY-Www (ISO 8601). We need the UTC Date of the Monday
  // starting that week so the count window matches the quota.
  const match = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (!match) return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const year = Number(match[1]);
  const week = Number(match[2]);
  // ISO weeks start on Monday; compute via the Jan 4 anchor trick.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const mondayOfWeek1 = new Date(Date.UTC(year, 0, 4 - (jan4Day - 1)));
  return new Date(mondayOfWeek1.getTime() + (week - 1) * 7 * 24 * 60 * 60 * 1000);
}

// Same Redis-first / Mongo-authoritative pattern as the weekly count.
async function readDailyUsage(userId, dayKey) {
  if (isRedisReady()) {
    try {
      const cached = await redis.get(dailyKey(userId, dayKey));
      if (cached != null) {
        const n = Number(cached);
        if (Number.isFinite(n)) return n;
      }
    } catch (error) {
      logger.warn("COACH_DAILY_QUOTA_REDIS_READ_FAILED", { userId: String(userId), error: error?.message });
    }
  }

  const count = await CoachMessage.countDocuments({
    user: userId,
    role: "user",
    billable: { $ne: false },
    superseded: { $ne: true },
    createdAt: { $gte: dayStartFromKey(dayKey) },
  });

  if (isRedisReady()) {
    try {
      await redis.set(dailyKey(userId, dayKey), String(count), "EX", DAILY_TTL_SECONDS);
    } catch {
      // best-effort prime
    }
  }
  return count;
}

async function getQuota(user) {
  const premium = isPremium(user);
  const weekKey = isoWeekKey(new Date());
  const used = await readUsage(user._id, weekKey);
  const remaining = Math.max(0, FREE_WEEKLY_LIMIT - used);

  const quota = {
    premium,
    weekKey,
    used,
    // Kept null for premium: shipped apps (iOS 1.0 / Android 1.1.2) read a
    // null limit as "unlimited" and hide the weekly counter.
    limit: premium ? null : FREE_WEEKLY_LIMIT,
    remaining: premium ? null : remaining,
    resetsAt: nextResetDate(weekKey),
  };

  if (premium) {
    const dayKey = utcDayKey();
    const dailyUsed = await readDailyUsage(user._id, dayKey);
    quota.daily = {
      limit: PREMIUM_DAILY_LIMIT,
      used: dailyUsed,
      remaining: Math.max(0, PREMIUM_DAILY_LIMIT - dailyUsed),
      resetsAt: new Date(dayStartFromKey(dayKey).getTime() + 24 * 60 * 60 * 1000).toISOString(),
    };
  }

  return quota;
}

async function incrementDailyUsage(user) {
  const dayKey = utcDayKey();
  if (isRedisReady()) {
    try {
      const next = await redis.incr(dailyKey(user._id, dayKey));
      if (next === 1) await redis.expire(dailyKey(user._id, dayKey), DAILY_TTL_SECONDS);
      return next;
    } catch (error) {
      logger.warn("COACH_DAILY_QUOTA_REDIS_INC_FAILED", { userId: String(user._id), error: error?.message });
    }
  }
  const used = await readDailyUsage(user._id, dayKey);
  return used + 1;
}

async function refundDailyUsage(user) {
  if (!isRedisReady()) return null;
  const key = dailyKey(user._id, utcDayKey());
  try {
    const next = await redis.decr(key);
    if (next < 0) {
      await redis.set(key, "0", "EX", DAILY_TTL_SECONDS);
      return 0;
    }
    return next;
  } catch (error) {
    logger.warn("COACH_DAILY_QUOTA_REDIS_REFUND_FAILED", { userId: String(user._id), error: error?.message });
    return null;
  }
}

function nextResetDate(weekKey) {
  const start = weekStartFromKey(weekKey);
  return new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
}

// Atomic increment so two concurrent sends from the same user can't both
// squeeze through the last quota slot. Returns the post-increment count.
async function incrementUsage(user) {
  const weekKey = isoWeekKey(new Date());
  if (isRedisReady()) {
    try {
      const next = await redis.incr(quotaKey(user._id, weekKey));
      if (next === 1) {
        await redis.expire(quotaKey(user._id, weekKey), QUOTA_TTL_SECONDS);
      }
      return next;
    } catch (error) {
      logger.warn("COACH_QUOTA_REDIS_INC_FAILED", { userId: String(user._id), error: error?.message });
    }
  }
  // Redis unavailable — fall back to Mongo count + 1 (best-effort; under
  // contention this is racier than the Redis path but still bounded).
  const used = await readUsage(user._id, weekKey);
  return used + 1;
}

// Give back a slot when the question never produced an answer. Mongo is the
// authority (the caller clears `billable` on the user turn); this just keeps
// the Redis cache from lagging a week behind that correction.
//
// Floors at zero: a decrement that races a week rollover must never push the
// counter negative, or the user would silently get a sixth free question.
async function refundUsage(user) {
  const weekKey = isoWeekKey(new Date());
  if (!isRedisReady()) return null;
  try {
    const next = await redis.decr(quotaKey(user._id, weekKey));
    if (next < 0) {
      await redis.set(quotaKey(user._id, weekKey), "0", "EX", QUOTA_TTL_SECONDS);
      return 0;
    }
    return next;
  } catch (error) {
    logger.warn("COACH_QUOTA_REDIS_REFUND_FAILED", { userId: String(user._id), error: error?.message });
    return null;
  }
}

module.exports = {
  FREE_WEEKLY_LIMIT,
  PREMIUM_DAILY_LIMIT,
  getQuota,
  incrementDailyUsage,
  incrementUsage,
  readDailyUsage,
  readUsage,
  refundDailyUsage,
  refundUsage,
  utcDayKey,
  weekStartFromKey,
};
