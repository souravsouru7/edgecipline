"use strict";

const RescueDispatch = require("../models/RescueDispatch");
const NotificationHistory = require("../models/NotificationHistory");
const { enqueueNotificationDelivery } = require("../queues/smartNotificationQueue");
const { sendFreeTierEmail } = require("./mailService");
const { windowForTouchpoint } = require("./subscriptionRescueService");
const { isFunnelEligible } = require("./freeTierFunnelService");
const analytics = require("./analyticsEventService");
const { logger } = require("../utils/logger");

// ─── Free-tier nudge funnel ──────────────────────────────────────────────────
//
// Same shape as subscriptionRescueService: a data table of touchpoints, each
// with a day offset from the anchor and a `build(ctx)` that renders the
// banner / push / email copy from the personalisation context. The anchor
// here is User.freeTier.lastFreeTradeAt (T0) rather than subscriptionExpiry,
// and every offset is positive — there is no "before" for a free user.
//
// Copy rules (also enforced by tests):
//   - never a fake deadline, never a discount claim (no offer exists yet)
//   - never "you'll lose your data" — the log stays readable on the free tier
//   - trade counts come from LIVE trades only; a deleted trade is never
//     described as if it were still there

const FUNNEL = "free_tier";
const PHASE = "free_tier";
const DEEP_LINK = "/settings";

// Every touchpoint after this many days from T0 is over; the banner endpoint
// returns null and the cron has no window to match.
const FUNNEL_END_DAYS = 21;

// Smallest safe guard in the absence of a cross-cron daily cap (there is
// none — each cron dedupes only its own type): a free-tier push is skipped
// when the account has already had this many pushes created today, so the
// nudge never becomes the fourth notification of a busy day.
const DAILY_PUSH_CEILING = 3;

function symbolOr(ctx, fallback) {
  return ctx?.primaryTrade?.symbol || fallback;
}

function tradesPhrase(ctx) {
  const n = ctx?.tradesLogged || 0;
  if (n === 0) return "your trade log";
  if (n === 1) return "your trade";
  return `your ${n} trades`;
}

const TOUCHPOINTS = [
  {
    code: "free_d_plus_1",
    daysOffset: 1,
    phase: PHASE,
    notificationType: "free_tier_d_plus_1",
    channels: { banner: true, push: true, email: false },
    tone: "dna_fading",
    build: (ctx) => ({
      banner: {
        headline: ctx.primaryTrade?.symbol
          ? `Your ${ctx.primaryTrade.symbol} trade is logged. There's a pattern worth checking 🔒`
          : "Your free trades are logged. There's a pattern worth checking 🔒",
        body: ctx.teaserInsight?.text || "Unlock Premium to keep logging and see what your trades are telling you.",
        ctaLabel: "Unlock Premium",
        metricLabel: "Trades logged",
        metricValue: String(ctx.tradesLogged || 0),
      },
      push: {
        title: `Your ${symbolOr(ctx, ctx.primaryMarketLabel)} trade is logged`,
        body: "There's a pattern worth checking — unlock Premium to see it.",
      },
    }),
  },
  {
    code: "free_d_plus_3",
    daysOffset: 3,
    phase: PHASE,
    notificationType: "free_tier_d_plus_3",
    channels: { banner: true, push: false, email: true },
    tone: "we_miss_you",
    build: (ctx) => ({
      banner: {
        headline: `${ctx.name}, ${tradesPhrase(ctx)} ${(ctx.tradesLogged || 0) >= 2 ? "are" : "is"} waiting to be read.`,
        body: "Premium adds unlimited trades, weekly AI reports and the coach — on top of everything you've logged.",
        ctaLabel: "See what Premium adds",
        metricLabel: "Free trades used",
        metricValue: `${ctx.freeTradeLimit} of ${ctx.freeTradeLimit}`,
      },
      email: {
        subject: `${ctx.name}, here's what your trades are telling you`,
        intro: ctx.tradesLogged > 0
          ? `You've filled your free ${ctx.primaryMarketLabel} trades. Here's the log so far, and what Premium reads out of it.`
          : `You've filled your free ${ctx.primaryMarketLabel} trades. Here's what Premium adds when you're ready to keep going.`,
      },
    }),
  },
  {
    code: "free_d_plus_7",
    daysOffset: 7,
    phase: PHASE,
    notificationType: "free_tier_d_plus_7",
    channels: { banner: true, push: true, email: true },
    tone: "celebrate",
    build: (ctx) => ({
      banner: {
        headline: ctx.disciplineStreak >= 3
          ? `Your ${ctx.disciplineStreak}-day discipline streak deserves the full picture.`
          : ctx.tradesLogged > 0
            ? `${ctx.tradesLogged} trade${ctx.tradesLogged === 1 ? "" : "s"} in. Premium turns them into a plan.`
            : "Ready to go past the free trades?",
        body: "Unlimited trades, weekly AI reports and the coach. Cancel anytime.",
        ctaLabel: "Unlock Premium",
        metricLabel: ctx.disciplineStreak >= 3 ? "Discipline streak" : "Trades logged",
        metricValue: ctx.disciplineStreak >= 3 ? `${ctx.disciplineStreak} days` : String(ctx.tradesLogged || 0),
      },
      push: {
        title: "Ready to go past the free trades?",
        body: ctx.teaserInsight?.text || "Unlimited trades, weekly reports and the coach are one tap away.",
      },
      email: {
        subject: ctx.disciplineStreak >= 3
          ? `${ctx.name}, your ${ctx.disciplineStreak}-day streak deserves the full picture`
          : "What Premium adds to your trade log",
        intro: "A week ago you filled your free trades. Everything you logged is still here — Premium is what turns it into a weekly plan.",
      },
    }),
  },
  {
    code: "free_d_plus_14",
    daysOffset: 14,
    phase: PHASE,
    notificationType: "free_tier_d_plus_14",
    channels: { banner: true, push: false, email: true },
    tone: "last_call",
    build: (ctx) => ({
      banner: {
        headline: "Last reminder about your free trades",
        body: "Your log stays right here whenever you're ready. Upgrade any time to keep adding to it.",
        ctaLabel: "Unlock Premium",
        metricLabel: "Trades logged",
        metricValue: String(ctx.tradesLogged || 0),
      },
      email: {
        subject: "One last note about your trade log",
        intro: "This is the last reminder we'll send about your free trades. Nothing changes on your account — your log stays readable, and Premium is there whenever you want to keep going.",
      },
    }),
  },
];

const TOUCHPOINTS_BY_CODE = Object.fromEntries(TOUCHPOINTS.map((t) => [t.code, t]));
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function isFreeTierTouchpoint(code) {
  return Boolean(TOUCHPOINTS_BY_CODE[code]);
}

// Which touchpoint's banner the user should see RIGHT NOW. Continuous like the
// rescue picker: between cron windows we keep showing the last touchpoint the
// user crossed, and nothing at all before D+1 (they have just seen the
// post-save sheet) or after FUNNEL_END_DAYS.
function pickActiveTouchpointForUser(user, now = Date.now()) {
  const anchor = user?.freeTier?.lastFreeTradeAt;
  if (!anchor) return null;
  const sinceDays = (now - new Date(anchor).getTime()) / ONE_DAY_MS;
  if (sinceDays < 1 || sinceDays >= FUNNEL_END_DAYS) return null;
  if (sinceDays >= 14) return TOUCHPOINTS_BY_CODE.free_d_plus_14;
  if (sinceDays >= 7) return TOUCHPOINTS_BY_CODE.free_d_plus_7;
  if (sinceDays >= 3) return TOUCHPOINTS_BY_CODE.free_d_plus_3;
  return TOUCHPOINTS_BY_CODE.free_d_plus_1;
}

// Mongo filter for accounts that may be in the funnel at all. The cron
// applies it per window; the dispatch re-checks with isFunnelEligible on the
// hydrated user so a purchase between query and send still wins.
function eligibleUserFilter() {
  return {
    role: { $ne: "admin" },
    accountStatus: { $ne: "disabled" },
    pendingDeletion: { $ne: true },
    subscriptionStatus: "inactive",
    subscriptionExpiry: null,
    playEntitlementExpiry: null,
    totalPaid: { $not: { $gt: 0 } },
  };
}

async function pushesCreatedToday(userId, now = new Date()) {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return NotificationHistory.countDocuments({
    user: userId,
    createdAt: { $gte: dayStart },
    status: { $nin: ["skipped", "failed"] },
  }).catch(() => 0);
}

function hasDeliverableEmail(user) {
  // The User model carries no separate "verified" flag: Google sign-ins are
  // verified by the provider at registration and local sign-ups own the
  // address they registered with. A blank address is the only skip case.
  return typeof user?.email === "string" && user.email.includes("@");
}

// Insert the RescueDispatch row first (the unique index dedupes), then fan
// out. Mirrors subscriptionRescueService.dispatchTouchpoint so operators read
// both funnels from one collection.
async function dispatchTouchpoint({ user, touchpoint, context, now = new Date(), dryRun = false }) {
  const anchor = user?.freeTier?.lastFreeTradeAt;
  if (!anchor) return { ok: false, skipped: true, reason: "no_anchor" };

  // Premium status is re-read from the hydrated user at send time, never
  // trusted from the query that found them.
  if (!isFunnelEligible(user)) {
    return { ok: true, skipped: true, reason: "ineligible" };
  }

  const payload = touchpoint.build(context);
  const cycleExpiry = new Date(anchor);

  if (dryRun) {
    return { ok: true, dryRun: true, payload };
  }

  let dispatchDoc;
  try {
    dispatchDoc = await RescueDispatch.create({
      user: user._id,
      funnel: FUNNEL,
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

  if (touchpoint.channels.push && payload.push) {
    try {
      const todayCount = await pushesCreatedToday(user._id, now);
      if (todayCount >= DAILY_PUSH_CEILING) {
        outcome.push = "skipped";
      } else {
        await enqueueNotificationDelivery({
          userId: user._id,
          notification: {
            type: touchpoint.notificationType,
            title: payload.push.title,
            body: payload.push.body,
            deepLink: DEEP_LINK,
            dedupeKey: `free_tier:${touchpoint.code}:${user._id}:${cycleExpiry.toISOString()}`,
            data: {
              funnel: FUNNEL,
              touchpoint: touchpoint.code,
              anchor: cycleExpiry.toISOString(),
            },
          },
        });
        outcome.push = "sent";
      }
    } catch (err) {
      outcome.push = "failed";
      logger.warn("[freeTier] push enqueue failed", {
        userId: String(user._id), touchpoint: touchpoint.code, error: err.message,
      });
    }
  }

  if (touchpoint.channels.email && payload.email) {
    if (!hasDeliverableEmail(user)) {
      outcome.email = "skipped";
    } else {
      try {
        await sendFreeTierEmail({
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
        logger.warn("[freeTier] email send failed", {
          userId: String(user._id), touchpoint: touchpoint.code, error: err.message,
        });
      }
    }
  }

  await RescueDispatch.findByIdAndUpdate(dispatchDoc._id, { outcome }).catch(() => {});

  analytics.track("free_nudge_sent", {
    userId: user._id,
    source: "cron",
    properties: {
      funnel: FUNNEL,
      touchpoint: touchpoint.code,
      market: context.primaryMarket,
      exhaustedMarkets: context.exhaustedMarkets,
      tradesLogged: context.tradesLogged,
      teaser: context.teaserInsight?.code || null,
      pushOutcome: outcome.push,
      emailOutcome: outcome.email,
      anchor: cycleExpiry,
    },
  });

  return { ok: true, dispatched: true, outcome };
}

module.exports = {
  FUNNEL,
  FUNNEL_END_DAYS,
  DAILY_PUSH_CEILING,
  TOUCHPOINTS,
  TOUCHPOINTS_BY_CODE,
  isFreeTierTouchpoint,
  windowForTouchpoint,
  pickActiveTouchpointForUser,
  eligibleUserFilter,
  hasDeliverableEmail,
  dispatchTouchpoint,
};
