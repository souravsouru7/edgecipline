"use strict";

// ─── Apple In-App Purchase — product catalogue and lifecycle vocabulary ──────
//
// The ONLY place that knows which App Store products Edgecipline sells. Like
// constants/googlePlay it carries no prices: App Store Connect owns pricing
// per storefront, and StoreKit hands the iOS client the localised price.
//
// Apple models each duration as its own product inside one subscription group
// (unlike Play's base plans under one product). Being in one group is what lets
// a user switch between them as an upgrade/downgrade instead of holding two.
//
// The IDs below are permanent once created in App Store Connect — they can
// never be renamed or reused — so they must match the console exactly.

const { SUBSCRIPTION_STATES, grantsEntitlement } = require("./googlePlay");

const SUBSCRIPTION_GROUP = "Edgecipline Pro";

// Mirrors the web PLAN_CONFIG and the Play BASE_PLANS so an iPhone, Android and
// web user are buying the same thing. `days` is for analytics only — Apple's
// expiresDate is authoritative. `userPlan` is the label written to
// User.subscriptionPlan and must be a value in that enum.
const PRODUCTS = Object.freeze({
  "com.edgecipline.pro.monthly": {
    productId: "com.edgecipline.pro.monthly",
    planType: "monthly",
    userPlan: "monthly",
    days: 30,
    label: "1 month",
  },
  "com.edgecipline.pro.3month": {
    productId: "com.edgecipline.pro.3month",
    planType: "3_months",
    userPlan: "monthly",
    days: 90,
    label: "3 months",
  },
  "com.edgecipline.pro.6month": {
    productId: "com.edgecipline.pro.6month",
    planType: "6_months",
    userPlan: "monthly",
    days: 180,
    label: "6 months",
  },
});

const PRODUCT_IDS = Object.freeze(Object.keys(PRODUCTS));

function getProduct(productId) {
  return PRODUCTS[String(productId || "").trim()] || null;
}

function isAllowedProductId(productId) {
  return Boolean(getProduct(productId));
}

// ─── Apple status → Edgecipline state ───────────────────────────────────────
//
// App Store Server API `status` on a subscription (getAllSubscriptionStatuses)
// and the state implied by a signed transaction are both mapped onto the shared
// SUBSCRIPTION_STATES vocabulary, so grantsEntitlement() is the same single
// rule for both stores.
//
//   1 Active                 — paid and renewing (or cancelled but in period;
//                              see autoRenewStatus). Access.
//   2 Expired                — over. No access.
//   3 Billing retry          — payment failing, Apple retrying, no grace. No
//                              access (Apple's equivalent of Play ON_HOLD).
//   4 Billing grace period   — payment failing, grace enabled. KEEP access.
//   5 Revoked                — refunded / Family Sharing removed. No access.
const APPLE_STATUS_MAP = Object.freeze({
  1: SUBSCRIPTION_STATES.ACTIVE,
  2: SUBSCRIPTION_STATES.EXPIRED,
  3: SUBSCRIPTION_STATES.ON_HOLD,
  4: SUBSCRIPTION_STATES.GRACE_PERIOD,
  5: SUBSCRIPTION_STATES.REVOKED,
});

function mapAppleStatus(status) {
  return APPLE_STATUS_MAP[Number(status)] || SUBSCRIPTION_STATES.PENDING;
}

/**
 * State from a decoded signed transaction alone, used when the App Store
 * Server API is not configured. A revocationDate always wins; otherwise the
 * expiry decides. Cancellation (auto-renew off) is not visible here and does
 * not need to be: a cancelled subscription still grants until expiresDate.
 */
function stateFromTransaction(transaction, now = Date.now()) {
  if (!transaction) return SUBSCRIPTION_STATES.PENDING;
  if (transaction.revocationDate) return SUBSCRIPTION_STATES.REVOKED;
  if (!transaction.expiresDate) return SUBSCRIPTION_STATES.PENDING;
  return Number(transaction.expiresDate) > now
    ? SUBSCRIPTION_STATES.ACTIVE
    : SUBSCRIPTION_STATES.EXPIRED;
}

module.exports = {
  SUBSCRIPTION_GROUP,
  PRODUCTS,
  PRODUCT_IDS,
  getProduct,
  isAllowedProductId,
  mapAppleStatus,
  stateFromTransaction,
  grantsEntitlement,
};
