"use strict";

const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const User = require("../models/Users");
const {
  pickActiveTouchpointForUser,
  TOUCHPOINTS_BY_CODE,
} = require("../services/subscriptionRescueService");
const { buildRescueContext } = require("../services/rescueContextService");
const freeTierNudge = require("../services/freeTierNudgeService");
const freeTierFunnel = require("../services/freeTierFunnelService");
const tradeQuotaService = require("../services/tradeQuotaService");
const { isPremium } = require("../utils/premium");
const analytics = require("../services/analyticsEventService");

// Fields the free-tier banner decision needs beyond the auth-cache
// projection (totalPaid and streaks are not cached).
const FREE_TIER_USER_PROJECTION =
  "_id name email role accountStatus pendingDeletion streaks freeTier trial "
  + "subscriptionStatus subscriptionExpiry playEntitlementExpiry totalPaid";

// Subscription rescue banner, or null. Unchanged behaviour: hidden for
// admins, trial-only premium, healthy subs > 7 days out, and anyone expired
// more than 14 days.
async function buildRescueBanner(user) {
  // If the only reason isPremium is true is the trial, don't show rescue.
  if (user.subscriptionStatus !== "active" && user.subscriptionStatus !== "expired") {
    return null;
  }
  if (isPremium(user) && user.subscriptionStatus !== "active") {
    return null;
  }

  const touchpoint = pickActiveTouchpointForUser(user);
  if (!touchpoint) return null;

  const context = await buildRescueContext(user);
  const payload = touchpoint.build(context);
  const banner = payload.banner;
  if (!banner) return null;

  return {
    funnel: "subscription_rescue",
    touchpoint: touchpoint.code,
    phase: touchpoint.phase,
    tone: touchpoint.tone,
    headline: banner.headline,
    body: banner.body,
    ctaLabel: banner.ctaLabel,
    ctaDeepLink: "/settings",
    metricLabel: banner.metricLabel,
    metricValue: banner.metricValue,
    subscriptionExpiry: user.subscriptionExpiry,
  };
}

// Free-tier nudge banner, or null. Only reached when the rescue funnel has
// nothing to say, so a lapsed subscriber (status "expired") never lands
// here — and isFunnelEligible re-checks "never paid" on the fresh document
// regardless. Returns null after FUNNEL_END_DAYS, for admins, for anyone
// premium, and when the limit is not enforced.
async function buildFreeTierBanner(cachedUser) {
  if (!tradeQuotaService.LIMIT_ENFORCED) return null;
  // Cheap pre-filter on the cached user before touching the database.
  if (isPremium(cachedUser) || freeTierFunnel.hasEverPaid(cachedUser)) return null;

  const user = await User.findById(cachedUser._id).select(FREE_TIER_USER_PROJECTION).lean();
  if (!user || !freeTierFunnel.isFunnelEligible(user)) return null;

  // Legacy exhausted accounts get their T0 stamped on first sight, so the
  // funnel picks them up from here without a migration.
  if (!user.freeTier?.lastFreeTradeAt) {
    for (const market of [tradeQuotaService.FOREX, tradeQuotaService.INDIAN]) {
      const quota = await tradeQuotaService.getQuota({ user, market });
      const stamped = await freeTierFunnel.backfillExhaustedState({ user, market, quota });
      if (stamped) {
        user.freeTier = stamped;
        break;
      }
    }
    if (!user.freeTier?.lastFreeTradeAt) return null;
  }

  const touchpoint = freeTierNudge.pickActiveTouchpointForUser(user);
  if (!touchpoint) return null;

  const context = await freeTierFunnel.buildFreeTierContext(user);
  const payload = touchpoint.build(context);
  const banner = payload.banner;
  if (!banner) return null;

  return {
    funnel: freeTierNudge.FUNNEL,
    touchpoint: touchpoint.code,
    phase: touchpoint.phase,
    tone: touchpoint.tone,
    headline: banner.headline,
    body: banner.body,
    ctaLabel: banner.ctaLabel,
    ctaDeepLink: "/settings",
    metricLabel: banner.metricLabel,
    metricValue: banner.metricValue,
    subscriptionExpiry: null,
    lastFreeTradeAt: user.freeTier.lastFreeTradeAt,
  };
}

// GET /api/rescue/banner
//
// Returns the banner payload for the current user, or `null` if none
// applies. Called on every page load — must be fast and never throw.
//
// Two funnels feed this, in strict priority order:
//   1. subscription rescue (expiring / lapsed paid users)
//   2. free-tier nudges (never-paid users who used their free trades)
// If a user somehow matches both, rescue wins and free-tier is not consulted.
exports.getBanner = asyncHandler(async (req, res) => {
  const user = req.user;
  if (!user || user.role === "admin") {
    return res.json({ banner: null });
  }

  const rescue = await buildRescueBanner(user);
  if (rescue) return res.json({ banner: rescue });

  const freeTier = await buildFreeTierBanner(user);
  res.json({ banner: freeTier });
});

// POST /api/rescue/event   { event, touchpoint?, properties? }
// Client-side beacons (banner_viewed / banner_cta_clicked). Server-side
// `rescue_dispatched` / `free_nudge_sent` already fire from the crons.
const CLIENT_EVENT_ALLOWLIST = new Set([
  "rescue_banner_viewed",
  "rescue_banner_cta_clicked",
  "rescue_banner_dismissed",
  // Free-tier funnel banner + CTA beacons. `touchpoint` is a free_* code.
  "free_nudge_viewed",
  "free_nudge_cta_clicked",
  "free_nudge_dismissed",
]);

exports.recordEvent = asyncHandler(async (req, res) => {
  const { event, touchpoint, properties } = req.body || {};
  if (typeof event !== "string" || !CLIENT_EVENT_ALLOWLIST.has(event)) {
    throw new ApiError(400, "Unknown rescue event", "VALIDATION_ERROR");
  }
  if (touchpoint && !TOUCHPOINTS_BY_CODE[touchpoint] && !freeTierNudge.isFreeTierTouchpoint(touchpoint)) {
    throw new ApiError(400, "Unknown touchpoint", "VALIDATION_ERROR");
  }
  analytics.track(event, {
    userId: req.user._id,
    source: "client",
    properties: {
      touchpoint: touchpoint || null,
      ...(properties && typeof properties === "object" ? properties : {}),
    },
  });
  res.json({ ok: true });
});
