"use strict";

const Trade = require("../models/Trade");
const IndianTrade = require("../models/IndianTrade");
const ApiError = require("../utils/ApiError");
const { isPremium } = require("../utils/premium");
const { appConfig } = require("../config");
const { logger } = require("../utils/logger");

// A free account may log this many trades in EACH market — 2 Forex and 2
// Indian, tracked separately. Premium is unlimited, and per `isPremium` that
// covers an active paid plan, the 7-day trial, and admins.
const FREE_TRADE_LIMIT = Number(appConfig.trades?.freeLimit ?? 2);
const LIMIT_ENFORCED = appConfig.trades?.freeLimitEnforced !== false;

// Enforcing a pay-gate while Razorpay is unconfigured means a free user who
// hits the limit is simply stuck: the app refuses the trade and there is no
// checkout to complete. Say so loudly at boot rather than discovering it from
// support tickets.
if (LIMIT_ENFORCED && !String(appConfig.razorpay?.keyId || "").trim()) {
  logger.warn("TRADE_LIMIT_ENFORCED_WITHOUT_CHECKOUT", {
    message:
      "Free trade limit is enforced but Razorpay is not configured — blocked users will have no way to pay. "
      + "Set FREE_TRADE_LIMIT_ENFORCED=false until checkout is live.",
    freeLimit: FREE_TRADE_LIMIT,
  });
}

const FOREX = "Forex";
const INDIAN = "Indian_Market";

function normaliseMarket(market) {
  const raw = String(market || "").trim();
  return raw === INDIAN || raw.toLowerCase() === "indian" ? INDIAN : FOREX;
}

function modelFor(market) {
  return market === INDIAN ? IndianTrade : Trade;
}

// Counts LIFETIME entries, soft-deleted ones included. Deleting a trade only
// sets `deletedAt`, so counting live rows would let a free user delete and
// re-add forever and never reach the limit — the gate would be decorative.
//
// Ghost rows (`parsedData.multiTradeGhost`) are bookkeeping artifacts of a
// multi-trade screenshot import rather than entries the user made. They are
// excluded everywhere else in the app and must not consume an allowance.
function lifetimeQuery(userId, market) {
  const query = { user: userId };
  if (market === FOREX) {
    query["parsedData.multiTradeGhost"] = { $ne: true };
  }
  return query;
}

async function countLifetimeTrades({ userId, market, session } = {}) {
  const resolved = normaliseMarket(market);
  const query = modelFor(resolved).countDocuments(lifetimeQuery(userId, resolved));
  if (session) query.session(session);
  return query;
}

// UI-facing snapshot so the client can show "1 of 2 free trades left" and open
// the paywall before the user fills in a whole form only to be rejected.
// `exhausted` is derived here once so every surface (quota endpoint, create
// responses, the 402 body) agrees on what "no free trades left" means.
// Pass `session` to read the count inside a transaction that just inserted.
async function getQuota({ user, market, session } = {}) {
  const resolved = normaliseMarket(market);
  if (!user?._id) {
    throw new ApiError(401, "Authentication required", "AUTH_REQUIRED");
  }
  if (!LIMIT_ENFORCED || isPremium(user)) {
    return { market: resolved, premium: true, limit: null, used: 0, remaining: null, exhausted: false };
  }
  const used = await countLifetimeTrades({ userId: user._id, market: resolved, session });
  const remaining = Math.max(0, FREE_TRADE_LIMIT - used);
  return {
    market: resolved,
    premium: false,
    limit: FREE_TRADE_LIMIT,
    used,
    remaining,
    exhausted: remaining === 0,
  };
}

// Throws unless `count` more trades fit inside the caller's remaining free
// allowance. Pass the surrounding `session` on batch paths so the count is
// read inside the same transaction as the insert.
//
// Known race (documented, not fixed here): two requests from the same free
// account that both read `used = 1` before either inserts will both pass,
// leaving the user at 3 trades. A transaction does not close it — MongoDB's
// snapshot isolation lets both inserts commit — and the only real fix is an
// atomic per-market counter with a filtered $inc, as coachQuotaService does.
// That would be a second source of truth beside the lifetime count this gate
// is built on, so it is deliberately left for a dedicated change. The
// exposure is one extra free trade for a user racing their own double-tap;
// the funnel stamp below is idempotent either way.
async function assertCanCreateTrades({ user, market, count = 1, session } = {}) {
  const resolved = normaliseMarket(market);
  if (!user?._id) {
    throw new ApiError(401, "Authentication required", "AUTH_REQUIRED");
  }

  const requested = Number(count);
  if (!Number.isInteger(requested) || requested < 1) {
    throw new ApiError(400, "Trade count must be a positive integer", "VALIDATION_ERROR");
  }

  if (!LIMIT_ENFORCED || isPremium(user)) {
    return { premium: true, limit: null, used: 0, remaining: null };
  }

  const used = await countLifetimeTrades({ userId: user._id, market: resolved, session });
  const remaining = Math.max(0, FREE_TRADE_LIMIT - used);

  if (requested > remaining) {
    // Funnel bookkeeping: remember the first refusal. Lazy require because the
    // funnel service depends on this module. Fire-and-forget — the 402 below
    // must not wait on, or be hidden by, a bookkeeping write.
    require("./freeTierFunnelService")
      .recordBlocked({ user, market: resolved })
      .catch((err) => logger.warn("FREE_TIER_BLOCKED_STAMP_FAILED", { error: err?.message }));

    // 402 rather than 403: this is "payment required", and it is the same
    // status the coach quota uses, so the client's paywall handling already
    // keys off it.
    throw new ApiError(
      402,
      remaining === 0
        ? `You've used your ${FREE_TRADE_LIMIT} free ${resolved === INDIAN ? "Indian market" : "Forex"} trades. Upgrade to keep logging.`
        : `Only ${remaining} free ${resolved === INDIAN ? "Indian market" : "Forex"} trade${remaining === 1 ? "" : "s"} left — this import needs ${requested}. Upgrade to add them all.`,
      "TRADE_LIMIT_REACHED",
      {
        quota: { market: resolved, premium: false, limit: FREE_TRADE_LIMIT, used, remaining, exhausted: remaining === 0 },
        requested,
      }
    );
  }

  return { premium: false, limit: FREE_TRADE_LIMIT, used, remaining };
}

module.exports = {
  FREE_TRADE_LIMIT,
  LIMIT_ENFORCED,
  FOREX,
  INDIAN,
  assertCanCreateTrades,
  countLifetimeTrades,
  getQuota,
  // Exported for testing
  normaliseMarket,
};
