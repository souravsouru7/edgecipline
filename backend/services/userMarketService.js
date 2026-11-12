"use strict";

/**
 * Which markets is a user actually active in?
 *
 * There is no explicit "markets enabled" toggle on the account. The product
 * already infers a user's market from three things, and this module makes
 * that inference reusable so market-gated notifications (session reminders)
 * agree with the coach, onboarding and dashboard:
 *
 *   1. User.preferredMarket           — chosen during onboarding / settings
 *      (always counts)
 *   2. a non-deleted trade logged in that market in the last 30 days
 *   3. a setup strategy created/edited for that market in the last 30 days
 *
 * 2 and 3 used to be "ever": one Forex trade logged once made an Indian-only
 * trader a Forex user forever (London/New York reminders every weekday with
 * no way out short of disabling session reminders altogether).
 *
 * A user with none of these signals is "market-less" (brand-new account that
 * never picked a market) and gets no market-specific notifications at all.
 */

const Trade = require("../models/Trade");
const IndianTrade = require("../models/IndianTrade");
const SetupStrategy = require("../models/SetupStrategy");
const { MARKETS } = require("../utils/marketCalendar");

const FOREX_TRADE_FILTER = {
  deletedAt: null,
  marketType: { $ne: MARKETS.INDIAN },
  "parsedData.multiTradeGhost": { $ne: true },
};
const INDIAN_TRADE_FILTER = { deletedAt: null };

const RECENT_ACTIVITY_DAYS = 30;

function recentSince(now = new Date()) {
  return new Date(now.getTime() - RECENT_ACTIVITY_DAYS * 24 * 60 * 60 * 1000);
}

function toIdString(value) {
  return value?.toString?.() || String(value || "");
}

async function collectUserIdsByMarket(now = new Date()) {
  const since = recentSince(now);
  const [forexTraders, indianTraders, forexSetups, indianSetups] = await Promise.all([
    Trade.distinct("user", { ...FOREX_TRADE_FILTER, createdAt: { $gte: since } }),
    IndianTrade.distinct("user", { ...INDIAN_TRADE_FILTER, createdAt: { $gte: since } }),
    SetupStrategy.distinct("user", { marketType: MARKETS.FOREX, updatedAt: { $gte: since } }),
    SetupStrategy.distinct("user", { marketType: MARKETS.INDIAN, updatedAt: { $gte: since } }),
  ]);
  return {
    [MARKETS.FOREX]: new Set([...forexTraders, ...forexSetups].map(toIdString)),
    [MARKETS.INDIAN]: new Set([...indianTraders, ...indianSetups].map(toIdString)),
  };
}

/**
 * Bulk resolution for cron fan-outs: four distinct() queries for the whole
 * fleet instead of N per-user lookups.
 *
 * @param {Array<{_id, preferredMarket?}>} users
 * @returns {Promise<Map<string, Set<string>>>} userId → set of active markets
 */
async function resolveActiveMarketsForUsers(users = []) {
  const byMarket = await collectUserIdsByMarket();
  const result = new Map();
  for (const user of users) {
    const id = toIdString(user?._id);
    const markets = new Set();
    if (user?.preferredMarket === MARKETS.FOREX || user?.preferredMarket === MARKETS.INDIAN) {
      markets.add(user.preferredMarket);
    }
    if (byMarket[MARKETS.FOREX].has(id)) markets.add(MARKETS.FOREX);
    if (byMarket[MARKETS.INDIAN].has(id)) markets.add(MARKETS.INDIAN);
    result.set(id, markets);
  }
  return result;
}

/**
 * Single-user resolution for request-time decisions.
 */
async function getActiveMarketsForUser(user) {
  const id = toIdString(user?._id || user);
  const markets = new Set();
  if (user?.preferredMarket === MARKETS.FOREX || user?.preferredMarket === MARKETS.INDIAN) {
    markets.add(user.preferredMarket);
  }
  const since = recentSince();
  const [forexCount, indianCount, forexSetup, indianSetup] = await Promise.all([
    Trade.countDocuments({ user: id, ...FOREX_TRADE_FILTER, createdAt: { $gte: since } }).limit(1),
    IndianTrade.countDocuments({ user: id, ...INDIAN_TRADE_FILTER, createdAt: { $gte: since } }).limit(1),
    SetupStrategy.exists({ user: id, marketType: MARKETS.FOREX, updatedAt: { $gte: since } }),
    SetupStrategy.exists({ user: id, marketType: MARKETS.INDIAN, updatedAt: { $gte: since } }),
  ]);
  if (forexCount > 0 || forexSetup) markets.add(MARKETS.FOREX);
  if (indianCount > 0 || indianSetup) markets.add(MARKETS.INDIAN);
  return markets;
}

module.exports = {
  RECENT_ACTIVITY_DAYS,
  resolveActiveMarketsForUsers,
  getActiveMarketsForUser,
};
