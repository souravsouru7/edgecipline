const User = require("../models/Users");
const Trade = require("../models/Trade");
const IndianTrade = require("../models/IndianTrade");
const SetupStrategy = require("../models/SetupStrategy");
const { logger } = require("../utils/logger");
const { invalidateAuthCache } = require("./authCacheService");

// Existing users (created before this deploy) have:
//   - `preferredMarket` possibly set
//   - 0 or more SetupStrategy rows
//   - 0 or more Trade / IndianTrade rows
//   - `onboarding.welcomeSeen` likely true (from the legacy FirstLoginWelcome)
//   - NONE of the new flags: marketSelected, journalSeen,
//     tradeSkipped, the timestamp fields
//
// Without a backfill, the new funnel reports them as 0/6 and `resolveLandingPath`
// would bounce them to /onboarding even though they're long-since activated.
// This service mirrors the runtime state from the user's existing data — it
// only writes "true" or a timestamp, never overwrites a manually-set flag.
//
// Runs in two contexts:
//   1. Lazy: called from onboardingService.getState() once per user. Cheap
//      (small reads, idempotent writes) and self-healing.
//   2. Bulk: a backfill script can call backfillUserOnboarding(userId) for
//      every user in the system to migrate the whole base in one pass.

async function loadFunnelSignals(userId) {
  const [tradeCount, indianTradeCount, setupCount, earliestTrade, earliestIndianTrade] = await Promise.all([
    Trade.countDocuments({ user: userId, deletedAt: null, "parsedData.multiTradeGhost": { $ne: true } }),
    IndianTrade.countDocuments({ user: userId, deletedAt: null }).catch(() => 0),
    SetupStrategy.countDocuments({ user: userId }),
    Trade.findOne({ user: userId, deletedAt: null }, { tradeDate: 1, createdAt: 1, effectiveTradeDate: 1, ocrJobId: 1 })
      .sort({ effectiveTradeDate: 1, createdAt: 1 }).lean(),
    IndianTrade.findOne({ user: userId, deletedAt: null }, { tradeDate: 1, createdAt: 1, effectiveTradeDate: 1, ocrJobId: 1 })
      .sort({ effectiveTradeDate: 1, createdAt: 1 }).lean()
      .catch(() => null),
  ]);

  // Earliest trade across both markets — used to stamp firstTradeAt at an
  // honest moment (when the user actually started logging), not at backfill
  // time. firstScreenshotUploadAt follows the same rule but only fires if
  // the earliest trade came from an OCR job.
  const candidates = [earliestTrade, earliestIndianTrade].filter(Boolean);
  const earliest = candidates.sort((a, b) =>
    new Date(a.effectiveTradeDate || a.createdAt || 0) - new Date(b.effectiveTradeDate || b.createdAt || 0)
  )[0] || null;

  return {
    tradeCount: tradeCount + indianTradeCount,
    setupCount,
    earliestTradeAt: earliest
      ? new Date(earliest.effectiveTradeDate || earliest.tradeDate || earliest.createdAt)
      : null,
    earliestTradeFromOcr: Boolean(earliest?.ocrJobId),
  };
}

// Build a $set update that only touches fields the existing record doesn't
// already have set. Mongo `$set` with a truthy value will overwrite false →
// true, which is exactly what we want for the boolean flags. For timestamps,
// we use $min so the earliest known time wins (so re-running the backfill
// never moves the stamp forward).
function buildBackfillUpdate({ user, signals }) {
  const o = user.onboarding || {};
  const set = {};
  const min = {};

  if (signals.setupCount > 0 && !o.setupAdded) {
    set["onboarding.setupAdded"] = true;
  }
  if (user.preferredMarket && !o.marketSelected) {
    set["onboarding.marketSelected"] = true;
  }
  if (signals.tradeCount > 0) {
    if (!o.tradeAdded) set["onboarding.tradeAdded"] = true;
    // A user who's been trading is past the welcome — flip both. We don't
    // touch welcomeSeen unilaterally for users without trades; they may
    // still benefit from the welcome slide.
    if (!o.welcomeSeen) set["onboarding.welcomeSeen"] = true;
    // If they already have trades, they are past the import and journal
    // review steps. Keep firstInsightSeen for legacy state compatibility.
    if (!o.firstInsightSeen) set["onboarding.firstInsightSeen"] = true;
    if (!o.journalSeen) set["onboarding.journalSeen"] = true;
  }

  if (signals.earliestTradeAt) {
    min["onboarding.firstTradeAt"] = signals.earliestTradeAt;
    if (signals.earliestTradeFromOcr) {
      min["onboarding.firstScreenshotUploadAt"] = signals.earliestTradeAt;
    }
  }

  // startedAt: if we can prove the user started before this deploy (any
  // trade or setup), stamp the earliest activity as startedAt. Otherwise
  // leave it null and let the normal onboarding flow set it.
  if (!o.startedAt) {
    if (signals.earliestTradeAt) {
      min["onboarding.startedAt"] = signals.earliestTradeAt;
    } else if (signals.setupCount > 0 && user.createdAt) {
      min["onboarding.startedAt"] = new Date(user.createdAt);
    }
  }

  // Top-level "fully activated" mirror. We require trade + setup + journal so
  // a user who only created a setup still flows through the import/review loop.
  const wouldBeFullyActivated =
    (o.setupAdded || set["onboarding.setupAdded"]) &&
    (o.tradeAdded || set["onboarding.tradeAdded"]) &&
    (o.journalSeen || set["onboarding.journalSeen"]) &&
    (o.welcomeSeen || set["onboarding.welcomeSeen"]);

  if (wouldBeFullyActivated && !user.isOnboardingCompleted) {
    set.isOnboardingCompleted = true;
    set.hasSeenWelcomeGuide = true;
    if (!o.completedAt) {
      set["onboarding.completedAt"] = new Date();
    }
  }

  return { set, min };
}

// Idempotent. Safe to call from any read path. Returns whether anything
// actually changed so callers can decide whether to invalidate the auth cache.
async function backfillUserOnboarding(userId, opts = {}) {
  if (!userId) return { changed: false, reason: "no_user" };

  const user = await User.findById(userId)
    .select("preferredMarket onboarding isOnboardingCompleted hasSeenWelcomeGuide createdAt")
    .lean();
  if (!user) return { changed: false, reason: "user_missing" };

  // Cheap pre-check: if the user already shows up as fully activated AND has
  // a startedAt or firstTradeAt stamp, skip the trade/setup count queries.
  // Self-healing on subsequent calls if data shifts later.
  const o = user.onboarding || {};
  const alreadyConsistent =
    user.isOnboardingCompleted &&
    o.tradeAdded && o.setupAdded && o.journalSeen && o.welcomeSeen &&
    (o.firstTradeAt || !opts.force);
  if (alreadyConsistent && !opts.force) {
    return { changed: false, reason: "already_consistent" };
  }

  const signals = await loadFunnelSignals(userId);

  // Nothing to backfill: user is genuinely brand new (no trades, no setups,
  // no preferredMarket). Leave them alone — the onboarding flow will write
  // the flags as they progress.
  if (
    signals.tradeCount === 0 &&
    signals.setupCount === 0 &&
    !user.preferredMarket &&
    !opts.force
  ) {
    return { changed: false, reason: "no_signals", signals };
  }

  const { set, min } = buildBackfillUpdate({ user, signals });

  const update = {};
  if (Object.keys(set).length) update.$set = set;
  if (Object.keys(min).length) update.$min = min;

  if (!update.$set && !update.$min) {
    return { changed: false, reason: "no_changes", signals };
  }

  if (opts.dryRun) {
    return { changed: true, dryRun: true, set, min, signals };
  }

  await User.updateOne({ _id: userId }, update);
  await invalidateAuthCache(userId).catch(() => {});

  logger.info("ONBOARDING_BACKFILLED", {
    userId: String(userId),
    setKeys: Object.keys(set),
    minKeys: Object.keys(min),
    tradeCount: signals.tradeCount,
    setupCount: signals.setupCount,
    forced: Boolean(opts.force),
  });

  return { changed: true, set, min, signals };
}

// Variant used by the bulk migration script. Skips the lazy short-circuit so
// the script always re-reads the canonical signals.
async function backfillAllUsers({ concurrency = 25, batchSize = 500, logEvery = 100 } = {}) {
  const total = await User.countDocuments({});
  let processed = 0;
  let changed = 0;
  let skipped = 0;

  for (let skip = 0; skip < total; skip += batchSize) {
    const users = await User.find({}, { _id: 1 }).skip(skip).limit(batchSize).lean();
    // Bounded parallelism per batch.
    for (let i = 0; i < users.length; i += concurrency) {
      const slice = users.slice(i, i + concurrency);
      await Promise.all(slice.map(async (u) => {
        try {
          const result = await backfillUserOnboarding(u._id, { force: true });
          if (result.changed) changed += 1; else skipped += 1;
        } catch (error) {
          logger.warn("ONBOARDING_BACKFILL_USER_FAILED", {
            userId: String(u._id), error: error?.message,
          });
        }
      }));
      processed += slice.length;
      if (processed % logEvery === 0) {
        logger.info("ONBOARDING_BACKFILL_PROGRESS", { processed, total, changed, skipped });
      }
    }
  }

  logger.info("ONBOARDING_BACKFILL_DONE", { processed, total, changed, skipped });
  return { processed, total, changed, skipped };
}

module.exports = {
  backfillUserOnboarding,
  backfillAllUsers,
  // Exported for tests
  buildBackfillUpdate,
  loadFunnelSignals,
};
