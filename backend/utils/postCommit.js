"use strict";

const { withTimeout } = require("./withTimeout");
const { invalidateTradeCaches } = require("./cacheUtils");
const { logger } = require("./logger");

// Work that follows a committed trade write must never decide whether the user
// hears "saved". Redis runs with maxRetriesPerRequest: null (BullMQ requires
// it), so during a reconnect every cache/queue command waits with no limit --
// and when those waits sat in front of the response, a trade that was already
// in Mongo came back to the phone as "Request timed out".

const CACHE_INVALIDATION_BUDGET_MS = 1500;

function scheduleJournalEvent(userId, event) {
  try {
    // Lazy so callers/tests that only need cache helpers don't load it.
    require("../services/mindProgressHooks").scheduleMindRecompute(userId, `trade:${event || "mutation"}`);
  } catch (error) {
    logger.warn("MIND_SCORE_HOOK_FAILED", { error: error?.message });
  }
}

/**
 * Bump the user's trade-cache version, but give up after a short budget.
 * Best-effort: cached lists expire on their own within TRADE_LIST_TTL_SECONDS.
 */
async function invalidateTradeCachesBounded(args, budgetMs = CACHE_INVALIDATION_BUDGET_MS) {
  // Every committed trade mutation passes through here, so this is where the
  // Mind Score learns about it (debounced, detached, never awaited).
  scheduleJournalEvent(args?.userId, args?.event);
  try {
    return await withTimeout(invalidateTradeCaches(args), "invalidateTradeCaches", budgetMs);
  } catch (error) {
    logger.warn("TRADE_CACHE_INVALIDATION_SKIPPED", {
      userId: args?.userId?.toString?.() || String(args?.userId || ""),
      event: args?.event,
      error: error?.message,
    });
    return 0;
  }
}

/**
 * Start a side effect without awaiting it. The call itself happens now (so
 * callers and tests still observe it); only its completion is detached.
 */
function runAfterResponse(label, fn) {
  try {
    Promise.resolve(fn()).catch((error) => {
      logger.warn(label, { error: error?.message });
    });
  } catch (error) {
    logger.warn(label, { error: error?.message });
  }
}

const FUNNEL_BUDGET_MS = 2000;

/**
 * Post-insert allowance snapshot (drives the "N free trades left" pill).
 * Returns null on failure or timeout — withQuota() then sends `quota: null`,
 * which every client already tolerates. Losing the pill is fine; holding a
 * committed save hostage to it is not.
 */
async function recordFunnelBounded(args, budgetMs = FUNNEL_BUDGET_MS) {
  // Lazy: keeps this helper free of the funnel's model graph for callers
  // (and tests) that only need the cache/background helpers.
  const freeTierFunnelService = require("../services/freeTierFunnelService");
  try {
    return await withTimeout(
      freeTierFunnelService.recordTradesCreated(args),
      "recordTradesCreated",
      budgetMs
    );
  } catch (error) {
    logger.warn("FREE_TIER_FUNNEL_SKIPPED", { error: error?.message });
    return null;
  }
}

module.exports = {
  CACHE_INVALIDATION_BUDGET_MS,
  FUNNEL_BUDGET_MS,
  invalidateTradeCachesBounded,
  recordFunnelBounded,
  runAfterResponse,
};
