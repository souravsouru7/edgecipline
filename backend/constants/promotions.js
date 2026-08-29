"use strict";

const CAMPAIGN_TYPES = ["influencer", "festival", "general", "new_user", "other"];
const CAMPAIGN_STATUSES = ["draft", "active", "paused", "ended"];
const COUPON_STATUSES = ["active", "disabled"];
const DISCOUNT_TYPES = ["percent", "fixed"];
const CHECKOUT_SESSION_STATUSES = ["open", "paid", "expired", "superseded"];
const REDEMPTION_STATUSES = ["applied", "reversed"];
const INFLUENCER_STATUSES = ["active", "inactive"];
const ORDERABLE_PLAN_TYPES = ["monthly", "3_months", "6_months"];

const PUBLIC_COUPON_ERROR = "This code isn't valid";
const MIN_PAYABLE_RUPEES = 1;
const CHECKOUT_SESSION_TTL_MS = 45 * 60 * 1000;
const ATTRIBUTION_COOKIE = "ec_aid";
const ATTRIBUTION_TTL_DAYS = 180;

function normalizeCouponCode(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

function normalizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function roundRupees(value) {
  return Math.round(Number(value));
}

module.exports = {
  CAMPAIGN_TYPES,
  CAMPAIGN_STATUSES,
  COUPON_STATUSES,
  DISCOUNT_TYPES,
  CHECKOUT_SESSION_STATUSES,
  REDEMPTION_STATUSES,
  INFLUENCER_STATUSES,
  ORDERABLE_PLAN_TYPES,
  PUBLIC_COUPON_ERROR,
  MIN_PAYABLE_RUPEES,
  CHECKOUT_SESSION_TTL_MS,
  ATTRIBUTION_COOKIE,
  ATTRIBUTION_TTL_DAYS,
  normalizeCouponCode,
  normalizeSlug,
  roundRupees,
};
