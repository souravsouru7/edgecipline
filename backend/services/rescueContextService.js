"use strict";

const Trade = require("../models/Trade");
const IndianTrade = require("../models/IndianTrade");
const WeeklyReport = require("../models/WeeklyReport");
const { logger } = require("../utils/logger");
const { toObjectId } = require("../utils/objectId");

// Build the personalization payload for a single rescue touchpoint. Same
// query shape as the SmartPaywall context — but tuned for cron use:
//
//   - Every query .catch()s to safe defaults so a single slow collection
//     can't take the whole funnel down.
//   - Returns flat primitives that fit cleanly into push titles and email
//     subject lines (no nested objects the copy layer has to walk).
//
// This is intentionally NOT a generic "user profile" service. It exists to
// fill the templates in subscriptionRescueService, no more.
async function buildRescueContext(user) {
  const userId = user._id;
  const safe = (p) => p.catch((err) => {
    logger.warn("[rescue] context query failed", { userId: String(userId), error: err.message });
    return null;
  });

  const [forexTradeCount, indianTradeCount, bestSetupAgg, weeklyReportsCount, latestWeekly] = await Promise.all([
    safe(Trade.countDocuments({ user: userId, deletedAt: null })),
    safe(IndianTrade.countDocuments({ user: userId, deletedAt: null })),
    safe(Trade.aggregate([
      // toObjectId: aggregation does not cast, so a cached (string) userId
      // would match nothing here while the countDocuments above still worked.
      { $match: { user: toObjectId(userId), deletedAt: null, strategy: { $nin: [null, ""] } } },
      { $group: { _id: "$strategy", trades: { $sum: 1 }, wins: { $sum: { $cond: [{ $gt: ["$pnl", 0] }, 1, 0] } } } },
      { $match: { trades: { $gte: 3 } } },
      { $addFields: { winRate: { $divide: ["$wins", "$trades"] } } },
      { $sort: { winRate: -1, trades: -1 } },
      { $limit: 1 },
    ])),
    safe(WeeklyReport.countDocuments({ user: userId })),
    safe(WeeklyReport.findOne({ user: userId }).sort({ weekEnd: -1 }).select("aiFeedback weekEnd").lean()),
  ]);

  const tradesLogged = (forexTradeCount || 0) + (indianTradeCount || 0);
  const bestSetup = bestSetupAgg && bestSetupAgg[0]
    ? {
        name: bestSetupAgg[0]._id,
        trades: bestSetupAgg[0].trades,
        winRate: Math.round((bestSetupAgg[0].winRate || 0) * 100),
      }
    : null;

  const streaks = user.streaks || {};
  const journalStreak = Number(streaks?.journal?.current) || 0;
  const ruleStreak = Number(streaks?.rule?.current) || 0;
  const disciplineStreak = Math.max(journalStreak, ruleStreak);
  const longestStreak = Math.max(
    Number(streaks?.journal?.longest) || 0,
    Number(streaks?.rule?.longest) || 0,
  );

  // Pluck a one-line insight if the latest weekly report has structured AI
  // feedback. Keep it short — pushes truncate aggressively on Android.
  let latestInsightLine = null;
  const fb = latestWeekly?.aiFeedback;
  if (fb && typeof fb === "object") {
    latestInsightLine =
      (typeof fb.headline === "string" && fb.headline) ||
      (typeof fb.summary === "string" && fb.summary.slice(0, 140)) ||
      (Array.isArray(fb.insights) && typeof fb.insights[0] === "string" && fb.insights[0].slice(0, 140)) ||
      null;
  }

  return {
    name: (user.name || "").split(" ")[0] || "trader",
    disciplineStreak,
    journalStreak,
    ruleStreak,
    longestStreak,
    tradesLogged,
    bestSetup,                         // { name, trades, winRate } | null
    weeklyReportsCount: weeklyReportsCount || 0,
    latestInsightLine,                 // string | null
    subscriptionExpiry: user.subscriptionExpiry || null,
  };
}

module.exports = { buildRescueContext };
