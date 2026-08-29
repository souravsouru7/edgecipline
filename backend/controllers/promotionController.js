"use strict";

const asyncHandler = require("../utils/asyncHandler");
const { quoteCheckout, publicQuote } = require("../services/promotionQuote.service");
const { getOrderablePlanConfig } = require("../services/paymentService");
const attribution = require("../services/attribution.service");
const { ATTRIBUTION_COOKIE, ATTRIBUTION_TTL_DAYS } = require("../constants/promotions");
const { appConfig } = require("../config");

function setAidCookie(res, anonymousId) {
  res.cookie(ATTRIBUTION_COOKIE, anonymousId, {
    httpOnly: true,
    sameSite: "lax",
    secure: appConfig.env === "production",
    maxAge: ATTRIBUTION_TTL_DAYS * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

exports.validateCoupon = asyncHandler(async (req, res) => {
  const { code, planType } = req.body;
  const plan = getOrderablePlanConfig(planType);
  const quote = await quoteCheckout({ user: req.user, plan, couponCode: code });
  res.json(publicQuote(quote));
});

exports.recordTouch = asyncHandler(async (req, res) => {
  const anonymousId =
    req.body.anonymousId ||
    attribution.readAnonymousId(req) ||
    attribution.newAnonymousId();
  const result = await attribution.recordTouch({
    anonymousId,
    userId: req.user?._id,
    refSlug: req.body.ref,
    utm: {
      source: req.body.utmSource,
      medium: req.body.utmMedium,
      campaign: req.body.utmCampaign,
    },
    landingPath: req.body.landingPath,
  });
  setAidCookie(res, result.anonymousId);
  if (req.user?._id) {
    await attribution.attachUser(req.user._id, result.anonymousId);
  }
  res.json({
    anonymousId: result.anonymousId,
    ref: result.influencer?.slug || null,
  });
});

exports.refRedirect = asyncHandler(async (req, res) => {
  const slug = req.params.slug;
  const anonymousId = attribution.readAnonymousId(req) || attribution.newAnonymousId();
  await attribution.recordTouch({
    anonymousId,
    refSlug: slug,
    landingPath: `/r/${slug}`,
  });
  setAidCookie(res, anonymousId);
  const origin = (appConfig.cors.allowedOrigins || [])[0] || "https://edgecipline.com";
  res.redirect(302, `${origin.replace(/\/$/, "")}/register?ref=${encodeURIComponent(slug)}`);
});
