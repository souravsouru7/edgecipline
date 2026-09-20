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
 *   2. a non-deleted trade in that market's collection
 *   3. a setup strategy created for that market
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

function toIdString(value) {
  return value?.toString?.() || String(value || "");
}

async function collectUserIdsByMarket() {
  const [forexTraders, indianTraders, forexSetups, indianSetups] = await Promise.all([
    Trade.distinct("user", FOREX_TRADE_FILTER),
    IndianTrade.distinct("user", INDIAN_TRADE_FILTER),
    SetupStrategy.distinct("user", { marketType: MARKETS.FOREX }),
    SetupStrategy.distinct("user", { marketType: MARKETS.INDIAN }),
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
  const [forexCount, indianCount, forexSetup, indianSetup] = await Promise.all([
    Trade.countDocuments({ user: id, ...FOREX_TRADE_FILTER }).limit(1),
    IndianTrade.countDocuments({ user: id, ...INDIAN_TRADE_FILTER }).limit(1),
    SetupStrategy.exists({ user: id, marketType: MARKETS.FOREX }),
    SetupStrategy.exists({ user: id, marketType: MARKETS.INDIAN }),
  ]);
  if (forexCount > 0 || forexSetup) markets.add(MARKETS.FOREX);
  if (indianCount > 0 || indianSetup) markets.add(MARKETS.INDIAN);
  return markets;
}

module.exports = {
  resolveActiveMarketsForUsers,
  getActiveMarketsForUser,
};
