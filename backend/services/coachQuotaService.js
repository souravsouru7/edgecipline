const CoachMessage = require("../models/CoachMessage");
const { isPremium } = require("../utils/premium");
const { isoWeekKey } = require("../utils/distributedLock");
const { client: redis, isRedisReady } = require("../config/redis");
const { logger } = require("../utils/logger");

// Free-tier quota: 5 user-authored questions per ISO week. Premium users are
// unlimited (we still record usage for analytics).
const FREE_WEEKLY_LIMIT = 5;
// We piggy-back on the ISO week so quota resets at the same instant for every
// user (Monday 00:00 UTC). Keeps support conversations simple.
const QUOTA_TTL_SECONDS = 14 * 24 * 60 * 60;

function quotaKey(userId, weekKey) {
  return `coach:quota:${userId}:${weekKey}`;
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

async function getQuota(user) {
  const premium = isPremium(user);
  const weekKey = isoWeekKey(new Date());
  const used = await readUsage(user._id, weekKey);
  const limit = premium ? Infinity : FREE_WEEKLY_LIMIT;
  const remaining = premium ? Infinity : Math.max(0, FREE_WEEKLY_LIMIT - used);

  return {
    premium,
    weekKey,
    used,
    limit: premium ? null : FREE_WEEKLY_LIMIT,
    remaining: premium ? null : remaining,
    resetsAt: nextResetDate(weekKey),
  };
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

module.exports = {
  FREE_WEEKLY_LIMIT,
  getQuota,
  incrementUsage,
  readUsage,
  weekStartFromKey,
};
