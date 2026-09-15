"use strict";

const User = require("../models/Users");
const Trade = require("../models/Trade");
const IndianTrade = require("../models/IndianTrade");
const tradeQuotaService = require("./tradeQuotaService");
const { isPremium } = require("../utils/premium");
const { invalidateAuthCache } = require("./authCacheService");
const analytics = require("./analyticsEventService");
const { logger } = require("../utils/logger");

// ─── Free-tier conversion funnel: state + personalization ────────────────────
//
// A free account gets FREE_TRADE_LIMIT trades in each market. The moment the
// first market runs out is T0 (User.freeTier.lastFreeTradeAt); the nudge cron
// in freeTierNudgeService counts days from there. This module owns:
//
//   - the ONLY writes to User.freeTier (all conditional + idempotent)
//   - the "never paid" eligibility rule that keeps lapsed subscribers in the
//     subscription rescue funnel instead of this one
//   - the personalization context (live trades, streaks, rule-based teaser)
//     shared by the paywall, the post-save sheet, the banner and the emails
//
// Nothing here calls an AI. The teaser is a deterministic lookup over the
// user's own trades so it costs nothing and never hallucinates a number.

const { FOREX, INDIAN, FREE_TRADE_LIMIT, LIMIT_ENFORCED, normaliseMarket } = tradeQuotaService;

// Most trades the personalization surfaces ever show. Two markets × two free
// trades is the natural ceiling; a legacy free user with 50 trades sees the
// four most recent.
const MAX_CONTEXT_TRADES = 4;

const MARKET_LABEL = {
  [FOREX]: "Forex",
  [INDIAN]: "Indian market",
};

function marketLabel(market) {
  return MARKET_LABEL[normaliseMarket(market)] || "Forex";
}

// ─── Eligibility ─────────────────────────────────────────────────────────────

// "Has this account ever held a paid plan?" — the line between the two
// funnels. A lapsed subscriber (status "expired", or a past Play entitlement,
// or any recorded payment) belongs to subscriptionRescueService and must
// never be nudged as if they had only ever seen the free tier.
//
// Reads only fields that already exist on User; there is deliberately no
// second payment-history ledger.
function hasEverPaid(user) {
  if (!user) return false;
  if (user.subscriptionStatus && user.subscriptionStatus !== "inactive") return true;
  if (user.subscriptionExpiry) return true;
  if (user.playEntitlementExpiry) return true;
  if (Number(user.totalPaid) > 0) return true;
  return false;
}

// True when the funnel may track / contact this user at all. Re-evaluated at
// every write and at every dispatch, never trusted from a stale read.
function isFunnelEligible(user) {
  if (!user?._id) return false;
  if (!LIMIT_ENFORCED) return false;
  if (user.role === "admin") return false;
  if (user.accountStatus === "disabled" || user.pendingDeletion) return false;
  if (isPremium(user)) return false;
  if (hasEverPaid(user)) return false;
  return true;
}

// ─── State writes (all idempotent) ───────────────────────────────────────────

async function invalidateCache(userId) {
  try {
    await invalidateAuthCache(userId);
  } catch (err) {
    logger.warn("[freeTier] auth cache invalidate failed", { userId: String(userId), error: err?.message });
  }
}

// Marks `market` exhausted. Pipeline update so the whole thing is one atomic
// document write:
//   - lastFreeTradeAt is set only if it is still null (first market wins; a
//     later market never moves T0 and never restarts the funnel)
//   - exhaustedMarkets is a set union, so a retry cannot duplicate the entry
// The filter excludes users who already have this market recorded, so the
// return value doubles as "did THIS call newly exhaust the market" — which is
// what decides whether the post-save sheet is shown and whether the analytics
// event fires. Returns the updated freeTier sub-doc, or null when the market
// was already recorded.
async function markMarketExhausted({ userId, market, now = new Date(), session = null } = {}) {
  const resolved = normaliseMarket(market);
  const query = User.findOneAndUpdate(
    { _id: userId, "freeTier.exhaustedMarkets": { $ne: resolved } },
    [
      {
        $set: {
          "freeTier.lastFreeTradeAt": { $ifNull: ["$freeTier.lastFreeTradeAt", now] },
          "freeTier.exhaustedMarkets": {
            $setUnion: [{ $ifNull: ["$freeTier.exhaustedMarkets", []] }, [resolved]],
          },
        },
      },
    ],
    { returnDocument: "after", projection: { freeTier: 1 } }
  );
  if (session) query.session(session);
  const updated = await query.lean();
  return updated ? updated.freeTier : null;
}

// Called after a successful create (single or batch) on either market. Reads
// the lifetime count — inside the caller's transaction when one is passed —
// so the returned quota reflects the rows that were just written, then stamps
// the funnel state when this save used the last free slot.
//
// Returns the quota view for the API response plus `showLastFreeTradeSheet`,
// which is true only when THIS request exhausted the market and the account
// has not already dismissed the sheet on some other device.
async function recordTradesCreated({ user, market, session = null, now = new Date() } = {}) {
  const resolved = normaliseMarket(market);
  const quota = await tradeQuotaService.getQuota({ user, market: resolved, session });
  const result = { quota, showLastFreeTradeSheet: false, exhaustedNow: false };

  if (!quota.exhausted || !isFunnelEligible(user)) return result;

  let freeTier;
  try {
    freeTier = await markMarketExhausted({ userId: user._id, market: resolved, now, session });
  } catch (err) {
    // Bookkeeping must never fail a trade that has already been saved.
    logger.warn("[freeTier] exhaustion stamp failed", {
      userId: String(user._id), market: resolved, error: err?.message,
    });
    return result;
  }
  if (!freeTier) return result; // already recorded by an earlier request

  result.exhaustedNow = true;
  result.showLastFreeTradeSheet = !freeTier.lastFreeTradeSheetDismissedAt;
  await invalidateCache(user._id);
  analytics.track("free_allowance_exhausted", {
    userId: user._id,
    properties: {
      market: resolved,
      limit: quota.limit,
      used: quota.used,
      exhaustedMarkets: freeTier.exhaustedMarkets,
      lastFreeTradeAt: freeTier.lastFreeTradeAt,
      source: "create",
    },
  });
  return result;
}

// Lazy backfill for accounts that ran out of free trades before this funnel
// shipped: the first /quota, paywall-context or banner call that observes
// `used >= limit` with no T0 recorded stamps it as of now. Same pattern as
// the lazy `trial_expired` emission in trialController — cheap, needs no
// migration, and the conditional update guarantees a single fire. Anchoring
// on "now" rather than the old trade's date is deliberate: the user is
// demonstrably active right now, which is when the sequence is useful.
async function backfillExhaustedState({ user, market, quota, now = new Date() } = {}) {
  if (!quota || quota.premium || quota.remaining !== 0) return null;
  if (!isFunnelEligible(user)) return null;
  const resolved = normaliseMarket(market);
  if (Array.isArray(user.freeTier?.exhaustedMarkets) && user.freeTier.exhaustedMarkets.includes(resolved)) {
    return null;
  }
  let freeTier;
  try {
    freeTier = await markMarketExhausted({ userId: user._id, market: resolved, now });
  } catch (err) {
    logger.warn("[freeTier] backfill failed", { userId: String(user._id), market: resolved, error: err?.message });
    return null;
  }
  if (!freeTier) return null;
  await invalidateCache(user._id);
  analytics.track("free_allowance_exhausted", {
    userId: user._id,
    properties: {
      market: resolved,
      limit: quota.limit,
      used: quota.used,
      exhaustedMarkets: freeTier.exhaustedMarkets,
      lastFreeTradeAt: freeTier.lastFreeTradeAt,
      source: "backfill",
    },
  });
  return freeTier;
}

// First 402 the account ever received. Fire-and-forget from the quota gate.
async function recordBlocked({ user, market, now = new Date() } = {}) {
  if (!isFunnelEligible(user)) return;
  try {
    await User.updateOne(
      { _id: user._id, "freeTier.firstBlockedAt": null },
      { $set: { "freeTier.firstBlockedAt": now } }
    );
  } catch (err) {
    logger.warn("[freeTier] firstBlockedAt stamp failed", {
      userId: String(user._id), market: normaliseMarket(market), error: err?.message,
    });
  }
}

// Server-side dismissal of the post-save sheet. Only the FIRST dismissal is
// recorded; it suppresses the sheet, nothing else in the funnel.
async function dismissLastFreeTradeSheet(userId, now = new Date()) {
  const res = await User.updateOne(
    { _id: userId, "freeTier.lastFreeTradeSheetDismissedAt": null },
    { $set: { "freeTier.lastFreeTradeSheetDismissedAt": now } }
  );
  if (res.modifiedCount > 0) await invalidateCache(userId);
  return { dismissed: true };
}

// ─── Personalization context ─────────────────────────────────────────────────

function toNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Display-safe projection of a trade row. Nothing from parsedData, images,
// notes or evidence leaves the server here — the banner/email/sheet only
// need what a trader would recognise their trade by.
function presentTrade(row, market) {
  const date = row.effectiveTradeDate || row.tradeDate || row.createdAt || null;
  return {
    id: String(row._id),
    market,
    symbol: String(row.pair || row.underlying || "").trim() || null,
    side: row.type === "SELL" ? "SELL" : row.type === "BUY" ? "BUY" : null,
    pnl: toNumberOrNull(row.profit),
    date: date ? new Date(date).toISOString() : null,
    strategy: typeof row.strategy === "string" && row.strategy.trim() ? row.strategy.trim() : null,
    optionType: market === INDIAN && (row.optionType === "CE" || row.optionType === "PE") ? row.optionType : null,
  };
}

const TRADE_PROJECTION = "pair underlying type profit strategy optionType tradeDate effectiveTradeDate createdAt";

// Live (not soft-deleted, not ghost) trades across both markets, newest
// first, capped at MAX_CONTEXT_TRADES. Every query .catch()es to [] so the
// cron and the paywall keep working when one collection is slow.
async function loadRecentTrades(userId) {
  const perMarket = Math.max(FREE_TRADE_LIMIT, MAX_CONTEXT_TRADES);
  const safe = (p) => p.catch((err) => {
    logger.warn("[freeTier] trade query failed", { userId: String(userId), error: err?.message });
    return [];
  });
  const [forex, indian] = await Promise.all([
    safe(
      Trade.find({ user: userId, deletedAt: null, "parsedData.multiTradeGhost": { $ne: true } })
        .sort({ effectiveTradeDate: -1, _id: -1 })
        .limit(perMarket)
        .select(TRADE_PROJECTION)
        .lean()
    ),
    safe(
      IndianTrade.find({ user: userId, deletedAt: null })
        .sort({ effectiveTradeDate: -1, _id: -1 })
        .limit(perMarket)
        .select(TRADE_PROJECTION)
        .lean()
    ),
  ]);
  const all = [
    ...(forex || []).map((row) => presentTrade(row, FOREX)),
    ...(indian || []).map((row) => presentTrade(row, INDIAN)),
  ];
  all.sort((a, b) => {
    const ad = a.date ? Date.parse(a.date) : 0;
    const bd = b.date ? Date.parse(b.date) : 0;
    return bd - ad;
  });
  return all.slice(0, MAX_CONTEXT_TRADES);
}

const COUNT_WORDS = { 2: "two", 3: "three", 4: "four" };
function countWord(n) {
  return COUNT_WORDS[n] || String(n);
}

// Deterministic, locked teaser. Precedence: same instrument → same direction
// → one-sided results → generic. The copy names a count ONLY when that many
// live trades exist, so a user who deleted one of their two free trades is
// never told "your two trades".
function buildTeaserInsight(trades = []) {
  const list = Array.isArray(trades) ? trades.filter(Boolean) : [];
  const n = list.length;

  if (n === 0) {
    return {
      code: "fallback",
      locked: true,
      text: "Your trading history contains a pattern worth exploring — unlock to see it.",
    };
  }

  if (n === 1) {
    const symbol = list[0].symbol;
    return {
      code: "single_trade",
      locked: true,
      text: symbol
        ? `There's more to read in your ${symbol} trade than the P&L — unlock to see it.`
        : "There's more to read in your first trade than the P&L — unlock to see it.",
    };
  }

  const symbols = list.map((t) => (t.symbol || "").toUpperCase()).filter(Boolean);
  if (symbols.length === n && new Set(symbols).size === 1) {
    return {
      code: "same_pair",
      locked: true,
      text: `Your ${countWord(n)} ${symbols[0]} trades share a pattern — unlock to see it.`,
    };
  }

  const sides = list.map((t) => t.side).filter(Boolean);
  if (sides.length === n && new Set(sides).size === 1) {
    return {
      code: "same_direction",
      locked: true,
      text: n === 2
        ? "Both trades leaned the same way — there's a pattern worth checking."
        : `All ${countWord(n)} trades leaned the same way — there's a pattern worth checking.`,
    };
  }

  const pnls = list.map((t) => t.pnl).filter((v) => typeof v === "number" && v !== 0);
  if (pnls.length === n && (pnls.every((v) => v > 0) || pnls.every((v) => v < 0))) {
    return {
      code: "pnl_pattern",
      locked: true,
      text: "Your recent trades reveal a pattern in your results — unlock to see it.",
    };
  }

  return {
    code: "generic",
    locked: true,
    text: "Your recent trades share a pattern — unlock to see it.",
  };
}

const CONTEXT_USER_PROJECTION = "name email streaks freeTier subscriptionStatus subscriptionExpiry playEntitlementExpiry totalPaid role trial";

// Full personalization payload. Accepts either a hydrated user (cron) or the
// projected auth-cache user (request path) — the latter has no `streaks` or
// `freeTier`, so those are fetched on demand.
async function buildFreeTierContext(user) {
  let source = user;
  if (source && (source.streaks === undefined || source.freeTier === undefined)) {
    const fresh = await User.findById(source._id).select(CONTEXT_USER_PROJECTION).lean().catch(() => null);
    if (fresh) source = { ...source, ...fresh };
  }
  const userId = source._id;
  const recentTrades = await loadRecentTrades(userId);

  const streaks = source.streaks || {};
  const journalStreak = Number(streaks?.journal?.current) || 0;
  const ruleStreak = Number(streaks?.rule?.current) || 0;
  const disciplineStreak = Math.max(journalStreak, ruleStreak);
  const longestStreak = Math.max(
    Number(streaks?.journal?.longest) || 0,
    Number(streaks?.rule?.longest) || 0,
  );

  const exhaustedMarkets = Array.isArray(source.freeTier?.exhaustedMarkets) ? source.freeTier.exhaustedMarkets : [];
  // The market the funnel started on. Falls back to the newest trade's market
  // for legacy users whose state has not been backfilled yet.
  const primaryMarket = exhaustedMarkets[0] || recentTrades[0]?.market || FOREX;
  const primaryTrade = recentTrades.find((t) => t.market === primaryMarket) || recentTrades[0] || null;

  return {
    name: (source.name || "").split(" ")[0] || "trader",
    recentTrades,
    tradesLogged: recentTrades.length,
    primaryTrade,
    primaryMarket,
    primaryMarketLabel: marketLabel(primaryMarket),
    exhaustedMarkets,
    freeTradeLimit: FREE_TRADE_LIMIT,
    disciplineStreak,
    journalStreak,
    ruleStreak,
    longestStreak,
    teaserInsight: buildTeaserInsight(recentTrades),
    lastFreeTradeAt: source.freeTier?.lastFreeTradeAt || null,
    // Phase 4 (first-purchase offer) is not implemented; the key exists so
    // clients can already branch on it without a later contract change.
    offer: null,
  };
}

module.exports = {
  MAX_CONTEXT_TRADES,
  marketLabel,
  hasEverPaid,
  isFunnelEligible,
  markMarketExhausted,
  recordTradesCreated,
  backfillExhaustedState,
  recordBlocked,
  dismissLastFreeTradeSheet,
  buildTeaserInsight,
  buildFreeTierContext,
  loadRecentTrades,
};
