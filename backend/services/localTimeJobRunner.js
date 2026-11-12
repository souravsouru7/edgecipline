// Runs a daily per-user job at a target LOCAL time (see utils/localTimeSchedule).
//
//   runLocalTimeJob({
//     name: "morningMentorCron", lockName: "morning-mentor",
//     target: { hour: 7, minute: 0 },
//     requireTrades: true,
//     work: (user, { timezone, now }) => sendMorningMentor(user, { now }),
//   })
//
// Called every 15 minutes. Cheap when nothing is due: one distinct() over the
// stored timezones and a few Intl calls.

const Trade = require("../models/Trade");
const IndianTrade = require("../models/IndianTrade");
const userRepository = require("../repositories/user.repository");
const { withCronLock } = require("../utils/distributedLock");
const { runCronWithMetrics } = require("../utils/cronMetrics");
const { dueTimezones, slotKey } = require("../utils/localTimeSchedule");
const { resolveTimeZone, DEFAULT_NOTIFICATION_TIMEZONE } = require("../utils/timezone");
const { logger } = require("../utils/logger");

// Held for the whole due window (30 min) plus headroom; never released early
// on success, so the next tick in the window is a no-op.
const SLOT_LOCK_TTL_SECONDS = 45 * 60;

// Users (of the given ids) with at least one non-deleted trade in either
// market. Scoped to the due batch, not the whole fleet.
async function filterUsersWithTrades(users) {
  if (!users.length) return users;
  const ids = users.map((u) => u._id);
  const [forex, indian] = await Promise.all([
    Trade.distinct("user", { user: { $in: ids }, deletedAt: null, "parsedData.multiTradeGhost": { $ne: true } }),
    IndianTrade.distinct("user", { user: { $in: ids }, deletedAt: null }),
  ]);
  const traders = new Set([...forex, ...indian].map(String));
  return users.filter((u) => traders.has(String(u._id)));
}

async function runLocalTimeJob({
  name,
  lockName,
  target,
  work,
  requireTrades = false,
  filterUsers = null,
  concurrency = 25,
  now = new Date(),
}) {
  const rawTimezones = await userRepository.findDistinctReminderTimezones();
  const resolvedByRaw = new Map(
    rawTimezones.map((raw) => [raw, resolveTimeZone(raw || DEFAULT_NOTIFICATION_TIMEZONE)])
  );
  const due = dueTimezones(now, [...new Set(resolvedByRaw.values())], target);
  if (!due.length) return null;

  const results = [];
  for (const timezone of due) {
    const raws = rawTimezones.filter((raw) => resolvedByRaw.get(raw) === timezone);
    try {
      const lockResult = await withCronLock(
        { name: lockName, lockSuffix: slotKey(now, timezone), ttlSeconds: SLOT_LOCK_TTL_SECONDS, holdUntilExpiry: true },
        async () => {
          let users = await userRepository.findReachableUsersByTimezone(raws);
          if (requireTrades) users = await filterUsersWithTrades(users);
          if (filterUsers) users = await filterUsers(users, { timezone, now });
          logger.info(`[${name}] starting`, { timezone, totalUsers: users.length });
          return runCronWithMetrics({
            name: `${name}:${timezone}`,
            items: users,
            concurrency,
            work: (user) => work(user, { timezone, now }),
          });
        }
      );
      if (lockResult.skipped) continue;
      results.push({ timezone, result: lockResult.result });
    } catch (error) {
      // Lock is released on failure, so the next tick in the window retries.
      logger.error(`[${name}] slot failed`, { timezone, error: error.message, stack: error.stack });
    }
  }
  return results.length ? results : null;
}

module.exports = { runLocalTimeJob, filterUsersWithTrades };
