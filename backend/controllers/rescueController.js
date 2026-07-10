"use strict";

const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const {
  pickActiveTouchpointForUser,
  TOUCHPOINTS_BY_CODE,
} = require("../services/subscriptionRescueService");
const { buildRescueContext } = require("../services/rescueContextService");
const { isPremium } = require("../utils/premium");
const analytics = require("../services/analyticsEventService");

// GET /api/rescue/banner
//
// Returns the rescue banner payload for the current user, or `null` if none
// applies. Called on every page load — must be fast and never throw.
//
// We hide the banner for:
//   - admins (treated as premium)
//   - users whose only premium signal is the active trial (the trial countdown
//     banner already handles that case — no need to also yell "renewal soon")
//   - users with a healthy paid subscription more than 7 days out
//   - users who've been expired more than 14 days (funnel exhausted)
exports.getBanner = asyncHandler(async (req, res) => {
  const user = req.user;
  if (!user || user.role === "admin") {
    return res.json({ banner: null });
  }

  // If the only reason isPremium is true is the trial, don't show rescue.
  if (user.subscriptionStatus !== "active" && user.subscriptionStatus !== "expired") {
    return res.json({ banner: null });
  }
  if (isPremium(user) && user.subscriptionStatus !== "active") {
    return res.json({ banner: null });
  }

  const touchpoint = pickActiveTouchpointForUser(user);
  if (!touchpoint) return res.json({ banner: null });

  const context = await buildRescueContext(user);
  const payload = touchpoint.build(context);
  const banner = payload.banner;
  if (!banner) return res.json({ banner: null });

  res.json({
    banner: {
      touchpoint: touchpoint.code,
      phase: touchpoint.phase,
      tone: touchpoint.tone,
      headline: banner.headline,
      body: banner.body,
      ctaLabel: banner.ctaLabel,
      ctaDeepLink: "/pricing",
      metricLabel: banner.metricLabel,
      metricValue: banner.metricValue,
      subscriptionExpiry: user.subscriptionExpiry,
    },
  });
});

// POST /api/rescue/event   { event, touchpoint?, properties? }
// Client-side beacons (banner_viewed / banner_cta_clicked). Server-side
// `rescue_dispatched` already fires from the cron.
const CLIENT_EVENT_ALLOWLIST = new Set([
  "rescue_banner_viewed",
  "rescue_banner_cta_clicked",
  "rescue_banner_dismissed",
]);

exports.recordEvent = asyncHandler(async (req, res) => {
  const { event, touchpoint, properties } = req.body || {};
  if (typeof event !== "string" || !CLIENT_EVENT_ALLOWLIST.has(event)) {
    throw new ApiError(400, "Unknown rescue event", "VALIDATION_ERROR");
  }
  if (touchpoint && !TOUCHPOINTS_BY_CODE[touchpoint]) {
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
