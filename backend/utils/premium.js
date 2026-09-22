"use strict";

// Centralised premium check. The user record sometimes ships through caches as
// a lean object and sometimes as a hydrated Mongoose doc, so we accept both.
// Admins are always treated as premium so internal coaching/QA flows don't
// trip the free-tier gate.
//
// A user counts as premium if ANY of these are true (in priority order):
//   1. role === "admin"
//   2. active paid subscription (status=active, plan≠free, expiry in future)
//   3. an active Google Play subscription (playEntitlementExpiry in the future)
//   4. inside the 7-day trial window (trial.endsAt in the future)
//
// (2) and (3) are separate fields on purpose. Razorpay sells PREPAID BLOCKS OF
// DAYS: each purchase pushes subscriptionExpiry further out and nothing ever
// takes those days back. Google Play sells a RENEWING AGREEMENT whose expiry
// Google moves — forward on renewal, and effectively backward when a
// subscription is cancelled, held or revoked. Writing both into one date field
// would mean a Play cancellation could shorten days a user had already paid
// Razorpay for, or a Play renewal could resurrect an expired Razorpay plan.
//
// Keeping them apart means the Razorpay path below is COMPLETELY UNTOUCHED by
// this integration — same fields, same cron, same refund maths — and premium is
// simply the union of the two. Which is also why there is no migration: a
// legacy user has no playEntitlementExpiry, and `undefined` is not in the
// future, so they resolve exactly as they did before.
const { appConfig } = require("../config");

// Retiring the trial is a one-line switch here on purpose: isPremium, the
// settings badge, the paywall context and the paid-window stacking in
// paymentService all resolve entitlement through isTrialActive/getTrialState,
// so gating those two covers every caller.
const TRIAL_ENABLED = appConfig.trial?.enabled === true;
const TRIAL_DAYS = Number(appConfig.trial?.days ?? 7);
const TRIAL_MS = TRIAL_DAYS * 24 * 60 * 60 * 1000;

function hasActiveSubscription(user, now = Date.now()) {
  if (user?.subscriptionStatus !== "active") return false;
  const plan = user?.subscriptionPlan;
  if (!plan || plan === "free") return false;
  if (user?.subscriptionExpiry && new Date(user.subscriptionExpiry).getTime() < now) return false;
  return true;
}

// Google Play entitlement. This field is written ONLY by the Play billing
// service, and only ever from a state Google itself returned — never from
// anything the Android client claims. It is a plain future-dated timestamp
// rather than a status because Play's own lifecycle (grace period, cancelled
// but not yet expired, on hold) has already been collapsed into "paid through
// when" by the time it is stored. See constants/googlePlay grantsEntitlement.
//
// Deliberately NOT gated on subscriptionStatus: a Play subscriber may have
// subscriptionStatus "inactive" forever, because that field belongs to the
// Razorpay ledger and the hourly expiry cron that maintains it.
function hasActivePlaySubscription(user, now = Date.now()) {
  const expiry = user?.playEntitlementExpiry;
  if (!expiry) return false;
  return new Date(expiry).getTime() > now;
}

function isTrialActive(user, now = Date.now()) {
  // With trials retired, a stale trial.endsAt left on an old account must not
  // keep granting free access.
  if (!TRIAL_ENABLED) return false;
  const endsAt = user?.trial?.endsAt;
  if (!endsAt) return false;
  return new Date(endsAt).getTime() > now;
}

function isPremium(user) {
  if (!user) return false;
  if (user.role === "admin") return true;
  const now = Date.now();
  if (hasActiveSubscription(user, now)) return true;
  if (hasActivePlaySubscription(user, now)) return true;
  if (isTrialActive(user, now)) return true;
  return false;
}

// The furthest-out date this user is paid through, across every provider.
// UI reads this rather than subscriptionExpiry so a Play-only subscriber sees
// their real renewal date instead of a blank "Active until —".
function getEffectiveExpiry(user) {
  const candidates = [];
  if (hasActiveSubscription(user)) {
    // A grandfathered "active with no expiry" record means unlimited; there is
    // no date to show, and inventing one would be worse than showing none.
    if (!user?.subscriptionExpiry) return null;
    candidates.push(new Date(user.subscriptionExpiry).getTime());
  }
  if (hasActivePlaySubscription(user)) {
    candidates.push(new Date(user.playEntitlementExpiry).getTime());
  }
  if (!candidates.length) return null;
  return new Date(Math.max(...candidates));
}

// Which processor is currently funding this user's access. Distinct from
// getPlanSource, which stays on its existing four values so nothing consuming
// it has to change; this answers the narrower "who do we send them to in order
// to cancel or update payment", which differs entirely between the two.
function getBillingProvider(user) {
  const now = Date.now();
  const play = hasActivePlaySubscription(user, now);
  const prepaid = hasActiveSubscription(user, now);
  if (play && prepaid) {
    // Both live at once — e.g. a web subscriber who later bought on Android.
    // Whichever runs longer is the one that governs renewal.
    return new Date(user.playEntitlementExpiry).getTime() >=
      new Date(user.subscriptionExpiry || 0).getTime()
      ? "google_play"
      : "razorpay";
  }
  if (play) return "google_play";
  if (prepaid) return "razorpay";
  return null;
}

// The status a user would expect to read on their settings page, resolved
// across both ledgers. `subscriptionStatus` alone is the RAZORPAY status: a
// Play subscriber keeps "inactive" there forever (see the schema comment), so
// showing it raw labelled a paying Android user "Inactive" next to a "Monthly
// Pro" plan badge and a "Full access enabled" tick.
//
//   active   — paid access right now, from either provider
//   expired  — had paid access from either provider and it has lapsed
//   inactive — never paid (or only a trial)
//
// Trial is deliberately not folded in: the UI already renders it as its own
// badge from getTrialState, and "active" here must mean "paid".
function getEffectiveSubscriptionStatus(user, now = Date.now()) {
  if (!user) return "inactive";
  if (hasActiveSubscription(user, now) || hasActivePlaySubscription(user, now)) {
    return "active";
  }
  if (user.subscriptionStatus === "expired") return "expired";
  // Razorpay "active" whose expiry has passed but the hourly cron hasn't
  // flipped it yet, or a Play agreement that ran out / was revoked: both are
  // "you had this and it lapsed", which is what "expired" tells the user.
  if (user.subscriptionStatus === "active" && user.subscriptionExpiry) return "expired";
  if (user.playEntitlementExpiry) return "expired";
  return "inactive";
}

// The badge text for the settings page. `User.subscriptionPlan` only knows
// monthly/yearly/custom (it is the Razorpay label, and every Play base plan is
// written there as "monthly" because that enum has no 3/6-month value), so a
// six-month Android subscriber used to read "Monthly Pro". When Play is the
// governing provider the Play summary's planType wins.
const PLAN_LABELS = Object.freeze({
  free: "Free",
  monthly: "Monthly Pro",
  yearly: "Annual Pro",
  custom: "Custom Pro",
});
const PLAY_PLAN_LABELS = Object.freeze({
  monthly: "Monthly Pro",
  "3_months": "3-month Pro",
  "6_months": "6-month Pro",
});

function getPlanLabel(user, playSummary = null) {
  if (!user) return PLAN_LABELS.free;
  const provider = getBillingProvider(user);
  if (provider === "google_play" && playSummary?.planType && PLAY_PLAN_LABELS[playSummary.planType]) {
    return PLAY_PLAN_LABELS[playSummary.planType];
  }
  if (provider === null && !hasActiveSubscription(user) && !hasActivePlaySubscription(user)) {
    // Lapsed or never paid: the stored label is history, not a current plan.
    // A lapsed Play plan still names what they had, for the "expired" card.
    if (playSummary?.planType && PLAY_PLAN_LABELS[playSummary.planType] && user.playEntitlementExpiry) {
      return PLAY_PLAN_LABELS[playSummary.planType];
    }
    if (user.subscriptionStatus === "expired" || user.subscriptionStatus === "active") {
      return PLAN_LABELS[user.subscriptionPlan] || PLAN_LABELS.free;
    }
    return PLAN_LABELS.free;
  }
  return PLAN_LABELS[user.subscriptionPlan] || PLAN_LABELS.free;
}

// UI-facing trial snapshot. Returns null for users who never had a trial
// (legacy accounts pre-feature). Callers can treat null as "not in trial".
function getTrialState(user) {
  // null means "this account has no trial", which is what every UI already
  // renders as nothing — so disabling trials empties the badge and the
  // countdown banner without touching either component.
  if (!TRIAL_ENABLED) return null;
  if (!user) return null;
  const startedAt = user?.trial?.startedAt;
  const endsAt = user?.trial?.endsAt;
  const used = Boolean(user?.trial?.used);
  if (!startedAt && !endsAt && !used) return null;

  const now = Date.now();
  const endMs = endsAt ? new Date(endsAt).getTime() : null;
  const active = endMs !== null && endMs > now;
  const msRemaining = active ? endMs - now : 0;
  const daysRemaining = Math.ceil(msRemaining / (24 * 60 * 60 * 1000));
  const hoursRemaining = Math.ceil(msRemaining / (60 * 60 * 1000));

  return {
    active,
    used,
    startedAt: startedAt || null,
    endsAt: endsAt || null,
    daysRemaining: active ? daysRemaining : 0,
    hoursRemaining: active ? hoursRemaining : 0,
    expired: used && !active && endMs !== null,
    source: user?.trial?.source || null,
  };
}

// Single source of truth for "where does this user's premium come from".
// Used by analytics + UI to know whether to show countdown vs. expiry vs. plan.
function getPlanSource(user) {
  if (!user) return "free";
  if (user.role === "admin") return "admin";
  // A Play subscription is a subscription. It resolves to the same source
  // string as a Razorpay one so every existing consumer — the settings badge,
  // the rescue funnel, analytics — keeps working without learning about
  // providers. Callers that genuinely need the processor use
  // getBillingProvider().
  if (hasActiveSubscription(user)) return "subscription";
  if (hasActivePlaySubscription(user)) return "subscription";
  if (isTrialActive(user)) return "trial";
  return "free";
}

function describePlan(user) {
  return {
    plan:    user?.subscriptionPlan   || "free",
    status:  user?.subscriptionStatus || "inactive",
    premium: isPremium(user),
    source:  getPlanSource(user),
    trial:   getTrialState(user),
    provider: getBillingProvider(user),
    expiresAt: getEffectiveExpiry(user),
    effectiveStatus: getEffectiveSubscriptionStatus(user),
  };
}

// Build the trial-start payload applied by registerUser / googleLogin.
// Callers spread this into User.create({...}). Idempotent at the call site —
// don't apply if user.trial.used is already true.
function buildTrialStart({ source = "auto_register", now = new Date() } = {}) {
  // Empty object so the spread at the registration call site simply adds
  // nothing — a new account is created with no trial subdocument at all.
  if (!TRIAL_ENABLED) return {};
  const start = new Date(now);
  return {
    trial: {
      startedAt:  start,
      endsAt:     new Date(start.getTime() + TRIAL_MS),
      used:       true,
      source,
      extendedBy: 0,
    },
  };
}

module.exports = {
  TRIAL_ENABLED,
  TRIAL_DAYS,
  TRIAL_MS,
  isPremium,
  describePlan,
  isTrialActive,
  hasActiveSubscription,
  hasActivePlaySubscription,
  getEffectiveExpiry,
  getEffectiveSubscriptionStatus,
  getBillingProvider,
  getPlanLabel,
  getTrialState,
  getPlanSource,
  buildTrialStart,
};
