"use strict";

// Centralised premium check. The user record sometimes ships through caches as
// a lean object and sometimes as a hydrated Mongoose doc, so we accept both.
// Admins are always treated as premium so internal coaching/QA flows don't
// trip the free-tier gate.
//
// A user counts as premium if ANY of these are true (in priority order):
//   1. role === "admin"
//   2. active paid subscription (status=active, plan≠free, expiry in future)
//   3. inside the 7-day trial window (trial.endsAt in the future)
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
  if (isTrialActive(user, now)) return true;
  return false;
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
  if (hasActiveSubscription(user)) return "subscription";
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
  getTrialState,
  getPlanSource,
  buildTrialStart,
};
