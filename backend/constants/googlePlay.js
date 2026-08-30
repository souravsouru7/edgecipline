"use strict";

// ─── Google Play Billing — product catalogue and lifecycle vocabulary ────────
//
// This file is the ONLY place that knows which Play products Edgecipline sells
// and what Google's subscription states mean to us. It deliberately carries no
// prices: Play Console owns pricing (per-country, per-currency, with Google's
// own tax handling), and the Android client reads the localised price straight
// from the Play Billing library. A price hard-coded here could not be changed
// without shipping a new AAB, and would drift from what the user is actually
// charged — the exact failure mode Razorpay's `priorAmounts` list exists to
// paper over. Do not add prices here.
//
// See docs/google-play-billing.md for the Play Console setup these IDs assume.

// One subscription product. Play models "tiers" as base plans underneath a
// single subscription, not as separate products — separate products would each
// need their own upgrade/downgrade wiring and cannot be swapped between.
const PRODUCT_ID = "edgecipline_pro";

// Base plans mirror the web catalogue in services/paymentService PLAN_CONFIG
// (monthly / 3_months / 6_months) so an Android user and a web user are buying
// the same thing. `days` is NOT used to compute entitlement — Play's own
// expiryTime is authoritative — it exists only for analytics and for the
// Payment receipt row, which records subscriptionDays like every other plan.
//
// `planType` ties a base plan back to the web plan it mirrors, so admin
// screens and revenue reporting can group them. `userPlan` is the display
// label written to User.subscriptionPlan and must be a value in that enum.
const BASE_PLANS = Object.freeze({
  "edgecipline-pro-monthly": {
    basePlanId: "edgecipline-pro-monthly",
    planType: "monthly",
    userPlan: "monthly",
    billingPeriod: "P1M",
    days: 30,
    label: "1 month",
  },
  "edgecipline-pro-3month": {
    basePlanId: "edgecipline-pro-3month",
    planType: "3_months",
    userPlan: "monthly",
    billingPeriod: "P3M",
    days: 90,
    label: "3 months",
  },
  "edgecipline-pro-6month": {
    basePlanId: "edgecipline-pro-6month",
    planType: "6_months",
    userPlan: "monthly",
    billingPeriod: "P6M",
    days: 180,
    label: "6 months",
  },
});

const BASE_PLAN_IDS = Object.freeze(Object.keys(BASE_PLANS));

// The allowlist Phase 4 requires. A purchase whose productId is not exactly
// ours is rejected before it can grant anything — this is what stops a token
// minted against some other developer's product (or a renamed one) from being
// replayed at our verify endpoint.
function isAllowedProductId(productId) {
  return String(productId || "").trim() === PRODUCT_ID;
}

function getBasePlan(basePlanId) {
  return BASE_PLANS[String(basePlanId || "").trim()] || null;
}

// ─── Internal subscription states ───────────────────────────────────────────
//
// Edgecipline's normalised vocabulary. Google's enum is mapped onto this so
// that nothing outside this file has to know Play's naming, and so a future
// Apple IAP integration can map onto the same set.
const SUBSCRIPTION_STATES = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  CANCELLED: "cancelled",
  GRACE_PERIOD: "grace_period",
  ON_HOLD: "on_hold",
  PAUSED: "paused",
  EXPIRED: "expired",
  REVOKED: "revoked",
});

const SUBSCRIPTION_STATE_VALUES = Object.freeze(Object.values(SUBSCRIPTION_STATES));

// purchases.subscriptionsv2.get -> subscriptionState
const PLAY_STATE_MAP = Object.freeze({
  SUBSCRIPTION_STATE_PENDING: SUBSCRIPTION_STATES.PENDING,
  SUBSCRIPTION_STATE_ACTIVE: SUBSCRIPTION_STATES.ACTIVE,
  SUBSCRIPTION_STATE_PAUSED: SUBSCRIPTION_STATES.PAUSED,
  SUBSCRIPTION_STATE_IN_GRACE_PERIOD: SUBSCRIPTION_STATES.GRACE_PERIOD,
  SUBSCRIPTION_STATE_ON_HOLD: SUBSCRIPTION_STATES.ON_HOLD,
  SUBSCRIPTION_STATE_CANCELED: SUBSCRIPTION_STATES.CANCELLED,
  SUBSCRIPTION_STATE_EXPIRED: SUBSCRIPTION_STATES.EXPIRED,
  // Google documents UNSPECIFIED as "should never happen". Treat it as
  // pending rather than active: an unknown state must never grant access.
  SUBSCRIPTION_STATE_UNSPECIFIED: SUBSCRIPTION_STATES.PENDING,
});

function mapPlayState(playState) {
  return PLAY_STATE_MAP[String(playState || "").trim()] || SUBSCRIPTION_STATES.PENDING;
}

// ─── When does PRO exist? (Phase 11) ────────────────────────────────────────
//
// These rules follow Google's documented subscription lifecycle:
//
//   ACTIVE        — paid and renewing. Access.
//   CANCELLED     — auto-renew switched off, but the user paid through
//                   expiryTime and Google does not refund the remainder.
//                   Access UNTIL expiryTime. Revoking early would be taking
//                   back time the user has already paid for.
//   GRACE_PERIOD  — payment failed and Google is retrying. Google's explicit
//                   guidance is to KEEP access so a card that expires does not
//                   lock a paying customer out mid-period. Play reports an
//                   expiryTime that moves forward through the grace window, so
//                   the expiry check below covers it without special-casing.
//   ON_HOLD       — grace period elapsed without payment. Google's guidance is
//                   to REVOKE access while holding the account (up to 30 days)
//                   so it can be restored if the user fixes their payment.
//   PAUSED        — user-initiated pause. No charge, so no access.
//   PENDING       — a pending transaction (e.g. cash payment in some markets)
//                   that Google has NOT confirmed. Never grant on pending.
//   EXPIRED       — over. No access.
//   REVOKED       — refunded/chargeback/removed. No access, immediately, and
//                   without waiting for expiryTime.
//
// Note that ON_HOLD and PAUSED are excluded here even though Play may still
// report a future expiryTime for them, which is why this is a state check and
// not an expiry check alone.
const ENTITLING_STATES = Object.freeze(
  new Set([
    SUBSCRIPTION_STATES.ACTIVE,
    SUBSCRIPTION_STATES.CANCELLED,
    SUBSCRIPTION_STATES.GRACE_PERIOD,
  ])
);

// States where the entitlement is gone the instant we observe them, regardless
// of what expiryTime says.
const TERMINAL_STATES = Object.freeze(
  new Set([
    SUBSCRIPTION_STATES.EXPIRED,
    SUBSCRIPTION_STATES.REVOKED,
  ])
);

/**
 * The single rule for "does this Play subscription grant PRO right now".
 * Both the state AND the expiry must agree — a stale ACTIVE snapshot whose
 * expiryTime has passed must not keep granting access.
 */
function grantsEntitlement(state, expiryTime, now = Date.now()) {
  if (!ENTITLING_STATES.has(state)) return false;
  if (!expiryTime) return false;
  return new Date(expiryTime).getTime() > now;
}

// ─── Real-time developer notifications (Phase 7) ────────────────────────────
//
// Numeric notificationType values from SubscriptionNotification. Named here so
// logs and analytics read as words rather than integers. Every one of these is
// handled the same way — re-fetch the authoritative state from the Play API and
// recompute — so this map is for observability, not for branching logic. That
// is deliberate: branching per notification type is how implementations drift
// out of sync with Google's actual state.
const RTDN_SUBSCRIPTION_TYPES = Object.freeze({
  1: "SUBSCRIPTION_RECOVERED",
  2: "SUBSCRIPTION_RENEWED",
  3: "SUBSCRIPTION_CANCELED",
  4: "SUBSCRIPTION_PURCHASED",
  5: "SUBSCRIPTION_ON_HOLD",
  6: "SUBSCRIPTION_IN_GRACE_PERIOD",
  7: "SUBSCRIPTION_RESTARTED",
  8: "SUBSCRIPTION_PRICE_CHANGE_CONFIRMED",
  9: "SUBSCRIPTION_DEFERRED",
  10: "SUBSCRIPTION_PAUSED",
  11: "SUBSCRIPTION_PAUSE_SCHEDULE_CHANGED",
  12: "SUBSCRIPTION_REVOKED",
  13: "SUBSCRIPTION_EXPIRED",
  20: "SUBSCRIPTION_PENDING_PURCHASE_CANCELED",
});

function describeRtdnType(notificationType) {
  return RTDN_SUBSCRIPTION_TYPES[Number(notificationType)] || `UNKNOWN_${notificationType}`;
}

// ─── Purchase token hygiene ─────────────────────────────────────────────────
//
// Play purchase tokens are long opaque base64url-ish strings. This is a cheap
// shape check that rejects obvious junk before we spend a Play API call on it;
// it is NOT a validity check — only Google can say whether a token is real.
const PURCHASE_TOKEN_PATTERN = /^[A-Za-z0-9_.\-]{20,1200}$/;

function isWellFormedPurchaseToken(token) {
  return PURCHASE_TOKEN_PATTERN.test(String(token || ""));
}

module.exports = {
  PRODUCT_ID,
  BASE_PLANS,
  BASE_PLAN_IDS,
  isAllowedProductId,
  getBasePlan,
  SUBSCRIPTION_STATES,
  SUBSCRIPTION_STATE_VALUES,
  PLAY_STATE_MAP,
  mapPlayState,
  ENTITLING_STATES,
  TERMINAL_STATES,
  grantsEntitlement,
  RTDN_SUBSCRIPTION_TYPES,
  describeRtdnType,
  PURCHASE_TOKEN_PATTERN,
  isWellFormedPurchaseToken,
};
