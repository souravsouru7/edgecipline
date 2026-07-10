"use strict";

const RescueDispatch = require("../models/RescueDispatch");
const { enqueueNotificationDelivery } = require("../queues/smartNotificationQueue");
const { sendRescueEmail } = require("./mailService");
const analytics = require("./analyticsEventService");
const { logger } = require("../utils/logger");

// ─── Touchpoint definitions ──────────────────────────────────────────────────
//
// Each touchpoint is data, not code. The cron iterates over this table once
// per run; renderers (push title/body, banner copy, email subject) live with
// the data so a copy change is a one-line edit.
//
// `daysOffset` is days from subscriptionExpiry: negative = pre-expiry,
// 0 = expiry day, positive = win-back.
//
// `channels` is the dispatch policy. Banner is always true here because the
// frontend GET /api/rescue/banner is read-on-demand — it's marked true so
// banner-impression analytics know the user was eligible.

const TOUCHPOINTS = [
  {
    code: "d_minus_7",
    daysOffset: -7,
    phase: "pre_expiry",
    notificationType: "renewal_d_minus_7",
    channels: { banner: true, push: false, email: false },
    tone: "celebrate",
    build: (ctx) => ({
      // In-app banner — soft, celebratory.
      banner: {
        headline: ctx.disciplineStreak >= 7
          ? `${ctx.name}, you've built a ${ctx.disciplineStreak}-day discipline streak.`
          : `${ctx.tradesLogged} trades of evidence and counting.`,
        body: "Premium renews in 7 days — keep the momentum.",
        ctaLabel: "Review plan",
        metricLabel: ctx.disciplineStreak >= 7 ? "Discipline streak" : "Trades logged",
        metricValue: ctx.disciplineStreak >= 7 ? `${ctx.disciplineStreak} days` : String(ctx.tradesLogged),
      },
    }),
  },
  {
    code: "d_minus_3",
    daysOffset: -3,
    phase: "pre_expiry",
    notificationType: "renewal_d_minus_3",
    channels: { banner: true, push: true, email: true },
    tone: "loss_aversion",
    build: (ctx) => ({
      banner: {
        headline: ctx.disciplineStreak >= 3
          ? `Renew to continue your ${ctx.disciplineStreak}-day discipline streak.`
          : `Your ${ctx.weeklyReportsCount || 0} weekly reports are about to pause.`,
        body: "Premium renews in 3 days. Don't lose what you've built.",
        ctaLabel: "Renew now",
        metricLabel: ctx.disciplineStreak >= 3 ? "Streak at risk" : "Reports pausing",
        metricValue: ctx.disciplineStreak >= 3 ? `${ctx.disciplineStreak} days` : String(ctx.weeklyReportsCount || 0),
      },
      push: {
        title: ctx.disciplineStreak >= 3
          ? `Your ${ctx.disciplineStreak}-day streak needs you`
          : `3 days to renew Premium`,
        body: "Tap to keep your weekly insights and AI coach running.",
      },
      email: {
        subject: ctx.disciplineStreak >= 3
          ? `${ctx.name}, your ${ctx.disciplineStreak}-day streak is 3 days from pause`
          : "3 days left on your Premium",
        intro: "You've earned what you've built — here's what renewing keeps:",
      },
    }),
  },
  {
    code: "d_minus_1",
    daysOffset: -1,
    phase: "pre_expiry",
    notificationType: "renewal_d_minus_1",
    channels: { banner: true, push: true, email: true },
    tone: "urgent",
    build: (ctx) => ({
      banner: {
        headline: "Premium ends tomorrow",
        body: ctx.bestSetup
          ? `Your ${ctx.bestSetup.name} setup (${ctx.bestSetup.winRate}% win) won't appear in next week's report unless you renew.`
          : "Renew now to keep your AI coach, weekly reports, and unlimited extractions.",
        ctaLabel: "Renew Premium",
        metricLabel: "Time left",
        metricValue: "< 24h",
      },
      push: {
        title: `Premium ends tomorrow${ctx.disciplineStreak >= 5 ? ` — protect your ${ctx.disciplineStreak}-day streak` : ""}`,
        body: "One tap to renew. Keep everything you've built.",
      },
      email: {
        subject: ctx.disciplineStreak >= 5
          ? `Tomorrow: your ${ctx.disciplineStreak}-day streak goes on pause`
          : "Tomorrow: your Premium ends",
        intro: "This is the last day to renew without a gap.",
      },
    }),
  },
  {
    code: "d_plus_0",
    daysOffset: 0,
    phase: "expiry",
    notificationType: "renewal_d_plus_0",
    channels: { banner: true, push: true, email: true },
    tone: "graceful",
    build: (ctx) => ({
      banner: {
        headline: "Your Premium has ended — but your data is safe",
        body: "Renew anytime to bring back AI insights, weekly reports, and unlimited coach.",
        ctaLabel: "Reactivate Premium",
        metricLabel: "Built so far",
        metricValue: `${ctx.tradesLogged} trades`,
      },
      push: {
        title: "Your Premium just ended",
        body: ctx.latestInsightLine
          ? `Your last insight: "${ctx.latestInsightLine.slice(0, 70)}…"`
          : "Reactivate anytime to keep building.",
      },
      email: {
        subject: "Your Premium ended — here's what's waiting",
        intro: "Your trades, journal, and history are all safe. When you're ready, one tap reactivates everything.",
      },
    }),
  },
  {
    code: "d_plus_3",
    daysOffset: 3,
    phase: "win_back",
    notificationType: "winback_d_plus_3",
    channels: { banner: true, push: true, email: false },
    tone: "we_miss_you",
    build: (ctx) => ({
      banner: {
        headline: ctx.longestStreak >= 7
          ? `Your best streak was ${ctx.longestStreak} days. Rebuild it.`
          : "Your AI coach is on standby.",
        body: "Reactivate Premium to unfreeze weekly reports and insights.",
        ctaLabel: "Bring me back",
        metricLabel: "Longest streak",
        metricValue: `${ctx.longestStreak} days`,
      },
      push: {
        title: ctx.bestSetup
          ? `Your ${ctx.bestSetup.name} setup is waiting`
          : "Your AI coach misses you",
        body: "3 days since Premium ended. Tap to reactivate.",
      },
    }),
  },
  {
    code: "d_plus_7",
    daysOffset: 7,
    phase: "win_back",
    notificationType: "winback_d_plus_7",
    channels: { banner: true, push: true, email: true },
    tone: "dna_fading",
    build: (ctx) => ({
      banner: {
        headline: "Your Trading DNA is frozen as of last week",
        body: "Each week without Premium is a week your DNA doesn't update. Reactivate to resume.",
        ctaLabel: "Resume Premium",
        metricLabel: "Trades on file",
        metricValue: String(ctx.tradesLogged),
      },
      push: {
        title: "Your Trading DNA hasn't moved in a week",
        body: "Reactivate to resume weekly evolution.",
      },
      email: {
        subject: `${ctx.name}, your Trading DNA is on pause`,
        intro: "It's been a week. Your edge keeps evolving — but only when Premium is on.",
      },
    }),
  },
  {
    code: "d_plus_14",
    daysOffset: 14,
    phase: "win_back",
    notificationType: "winback_d_plus_14",
    channels: { banner: true, push: false, email: true },
    tone: "last_call",
    build: (ctx) => ({
      banner: {
        headline: "Still here? Your spot's still here too.",
        body: "Two weeks off Premium. Whenever you're ready, your history is exactly where you left it.",
        ctaLabel: "Pick up where I left off",
        metricLabel: "Reports archived",
        metricValue: String(ctx.weeklyReportsCount || 0),
      },
      email: {
        subject: "Whenever you're ready",
        intro: "No pressure. Just a note: your trades, your streaks, and your weekly reports are all preserved. One tap brings the coach back.",
      },
    }),
  },
];

const TOUCHPOINTS_BY_CODE = Object.fromEntries(TOUCHPOINTS.map((t) => [t.code, t]));

// ─── Window math ─────────────────────────────────────────────────────────────
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_HALF_MS = 12 * 60 * 60 * 1000; // ±12h drift tolerance per cron run

// For a touchpoint with daysOffset D, the target window of subscriptionExpiry
// values right now is: now - D ± 12h.
//   pre-expiry (D = -7): expiry in (now + 6.5d, now + 7.5d)
//   expiry day (D = 0):  expiry in (now - 12h, now + 12h)
//   win-back  (D = +7):  expiry in (now - 7.5d, now - 6.5d)
function windowForTouchpoint(touchpoint, now = Date.now()) {
  const center = now - touchpoint.daysOffset * ONE_DAY_MS;
  return {
    from: new Date(center - WINDOW_HALF_MS),
    to:   new Date(center + WINDOW_HALF_MS),
  };
}

// Which subscriptionStatus values are eligible for each phase.
function statusFilterForPhase(phase) {
  if (phase === "pre_expiry" || phase === "expiry") return "active";
  return "expired"; // win_back
}

// Pick the touchpoint whose message the user should see RIGHT NOW.
//
// Unlike the cron — which only fires within a tight ±12h window — the banner
// is continuous: between two cron touchpoints we keep showing the last one
// the user "crossed" so the dashboard never goes back to a generic state
// mid-cycle.
//
// Pre-expiry (status=active):
//   daysUntilExpiry <= 1  → D-1
//   daysUntilExpiry <= 3  → D-3
//   daysUntilExpiry <= 7  → D-7
//   else                  → null (subscription is healthy, no rescue copy)
// Post-expiry (status=expired):
//   daysSinceExpiry >= 14 → D+14
//   daysSinceExpiry >= 7  → D+7
//   daysSinceExpiry >= 3  → D+3
//   daysSinceExpiry >= 0  → D+0
function pickActiveTouchpointForUser(user, now = Date.now()) {
  if (!user?.subscriptionExpiry) return null;
  const expiryMs = new Date(user.subscriptionExpiry).getTime();
  const diffDays = (expiryMs - now) / ONE_DAY_MS;

  if (user.subscriptionStatus === "active") {
    if (diffDays > 7)  return null;
    if (diffDays <= 1) return TOUCHPOINTS_BY_CODE.d_minus_1;
    if (diffDays <= 3) return TOUCHPOINTS_BY_CODE.d_minus_3;
    return TOUCHPOINTS_BY_CODE.d_minus_7;
  }

  if (user.subscriptionStatus === "expired") {
    const sinceDays = -diffDays;
    if (sinceDays >= 14) return TOUCHPOINTS_BY_CODE.d_plus_14;
    if (sinceDays >= 7)  return TOUCHPOINTS_BY_CODE.d_plus_7;
    if (sinceDays >= 3)  return TOUCHPOINTS_BY_CODE.d_plus_3;
    if (sinceDays >= 0)  return TOUCHPOINTS_BY_CODE.d_plus_0;
  }

  return null;
}

// ─── Dispatch ────────────────────────────────────────────────────────────────
//
// Insert RescueDispatch first (relies on the unique index to dedupe). If the
// insert succeeds, fan out to push/email. If the insert fails with a
// duplicate-key error, this touchpoint was already delivered for this cycle
// — silent no-op.
async function dispatchTouchpoint({ user, touchpoint, context, dryRun = false }) {
  const payload = touchpoint.build(context);
  const cycleExpiry = user.subscriptionExpiry;

  if (dryRun) {
    return { ok: true, dryRun: true, payload };
  }

  let dispatchDoc;
  try {
    dispatchDoc = await RescueDispatch.create({
      user: user._id,
      cycleExpiry,
      touchpoint: touchpoint.code,
      phase: touchpoint.phase,
      channels: touchpoint.channels,
      contextSnapshot: context,
    });
  } catch (err) {
    if (err?.code === 11000) {
      return { ok: true, alreadyDispatched: true };
    }
    throw err;
  }

  const outcome = { push: null, email: null };

  // ── Push (via the smart notification queue — quiet hours + prefs free) ──
  if (touchpoint.channels.push && payload.push) {
    try {
      await enqueueNotificationDelivery({
        userId: user._id,
        notification: {
          type: touchpoint.notificationType,
          title: payload.push.title,
          body: payload.push.body,
          deepLink: "/pricing",
          dedupeKey: `rescue:${touchpoint.code}:${user._id}:${new Date(cycleExpiry).toISOString()}`,
          data: {
            touchpoint: touchpoint.code,
            cycleExpiry: new Date(cycleExpiry).toISOString(),
          },
        },
      });
      outcome.push = "sent";
    } catch (err) {
      outcome.push = "failed";
      logger.warn("[rescue] push enqueue failed", {
        userId: String(user._id),
        touchpoint: touchpoint.code,
        error: err.message,
      });
    }
  }

  // ── Email (direct via mailService) ──
  if (touchpoint.channels.email && payload.email) {
    try {
      await sendRescueEmail({
        to: user.email,
        userName: context.name,
        touchpoint: touchpoint.code,
        subject: payload.email.subject,
        intro: payload.email.intro,
        context,
      });
      outcome.email = "sent";
    } catch (err) {
      outcome.email = "failed";
      logger.warn("[rescue] email send failed", {
        userId: String(user._id),
        touchpoint: touchpoint.code,
        error: err.message,
      });
    }
  }

  await RescueDispatch.findByIdAndUpdate(dispatchDoc._id, { outcome }).catch(() => {});

  analytics.track("rescue_dispatched", {
    userId: user._id,
    source: "cron",
    properties: {
      touchpoint: touchpoint.code,
      phase: touchpoint.phase,
      pushOutcome: outcome.push,
      emailOutcome: outcome.email,
      cycleExpiry,
    },
  });

  return { ok: true, dispatched: true, outcome };
}

module.exports = {
  TOUCHPOINTS,
  TOUCHPOINTS_BY_CODE,
  windowForTouchpoint,
  statusFilterForPhase,
  pickActiveTouchpointForUser,
  dispatchTouchpoint,
};
