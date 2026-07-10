"use strict";

const AnalyticsEvent = require("../models/AnalyticsEvent");
const { logger } = require("../utils/logger");

// Fire-and-forget event recorder for monetization analytics. Never throws —
// analytics failures must not break the user request. Each event also goes
// through logger.info so it shows up in log-based dashboards before a real
// analytics pipeline is wired in.
//
// Standard events emitted by the trial/paywall system:
//   trial_started                 — registration grants trial
//   trial_day_warning             — day-5/day-6 reminder cron
//   trial_expired                 — trial.endsAt crossed
//   paywall_viewed                — SmartPaywall mounted
//   paywall_cta_clicked           — user tapped "Continue"
//   subscription_started_from_trial — payment verified while trial.used=true
//   trial_extended                — admin grant
function track(event, { userId, properties = {}, source = "server" } = {}) {
  try {
    logger.info(`[analytics] ${event}`, {
      userId: userId ? String(userId) : null,
      ...properties,
    });
  } catch (_) {
    /* never let logging break the caller */
  }

  // Don't await — analytics writes must not slow the request path.
  AnalyticsEvent.create({
    event,
    user: userId || undefined,
    properties,
    source,
  }).catch((err) => {
    logger.warn("[analytics] event persist failed", {
      event,
      error: err.message,
    });
  });
}

module.exports = { track };
