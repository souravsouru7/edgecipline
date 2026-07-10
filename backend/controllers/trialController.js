"use strict";

const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const User = require("../models/Users");
const Trade = require("../models/Trade");
const IndianTrade = require("../models/IndianTrade");
const NotificationHistory = require("../models/NotificationHistory");
const WeeklyReport = require("../models/WeeklyReport");
const {
  isPremium,
  getTrialState,
  getPlanSource,
  buildTrialStart,
  TRIAL_DAYS,
} = require("../utils/premium");
const { invalidateAuthCache } = require("../services/authCacheService");
const analytics = require("../services/analyticsEventService");
const { logger } = require("../utils/logger");

// In-memory dedupe so we only emit `trial_expired` once per user per process
// lifecycle, even if /status is polled every 60s. Re-emits after restart are
// fine — downstream analytics can dedupe by (userId, event) at query time.
const EXPIRED_EVENT_SENT = new Set();
// Cap memory in case of long-lived processes + millions of expired users.
const EXPIRED_EVENT_CAP = 50000;

// GET /api/trial/status
// Lightweight call for the countdown banner / app shell. Returns enough state
// to decide: show banner? show paywall? open upgrade flow?
exports.getStatus = asyncHandler(async (req, res) => {
  const user = req.user;
  const trial = getTrialState(user);

  // Lazy `trial_expired` emission — fires the first time we observe a user
  // whose trial.endsAt has crossed. Without a cron this is our only signal
  // for users who churn without ever opening the paywall.
  if (trial?.expired) {
    const uidKey = String(user._id);
    if (!EXPIRED_EVENT_SENT.has(uidKey)) {
      if (EXPIRED_EVENT_SENT.size >= EXPIRED_EVENT_CAP) EXPIRED_EVENT_SENT.clear();
      EXPIRED_EVENT_SENT.add(uidKey);
      analytics.track("trial_expired", {
        userId: user._id,
        properties: {
          endsAt: trial.endsAt,
          extendedBy: user.trial?.extendedBy || 0,
          neverPaid: user.subscriptionStatus !== "active",
        },
      });
    }
  }

  res.json({
    isPremium: isPremium(user),
    planSource: getPlanSource(user),
    trial,
    subscription: {
      status: user.subscriptionStatus,
      plan: user.subscriptionPlan,
      expiresAt: user.subscriptionExpiry || null,
    },
    config: {
      trialDays: TRIAL_DAYS,
      priceMonthlyInr: 50,
      planPriceInr: 150,
      planMonths: 3,
    },
  });
});

// GET /api/trial/paywall-context
// Personalized data for the SmartPaywall. Heavier than /status; only call when
// the paywall is about to render. All queries are user-scoped and capped.
exports.getPaywallContext = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const [
    forexTradeCount,
    indianTradeCount,
    bestSetupAgg,
    aiInsightsCount,
    weeklyReportsCount,
  ] = await Promise.all([
    Trade.countDocuments({ user: userId, deletedAt: null }).catch(() => 0),
    IndianTrade.countDocuments({ user: userId, deletedAt: null }).catch(() => 0),
    Trade.aggregate([
      { $match: { user: userId, deletedAt: null, strategy: { $nin: [null, ""] } } },
      {
        $group: {
          _id: "$strategy",
          trades: { $sum: 1 },
          wins:   { $sum: { $cond: [{ $gt: ["$pnl", 0] }, 1, 0] } },
        },
      },
      { $match: { trades: { $gte: 3 } } },
      { $addFields: { winRate: { $divide: ["$wins", "$trades"] } } },
      { $sort: { winRate: -1, trades: -1 } },
      { $limit: 1 },
    ]).catch(() => []),
    NotificationHistory.countDocuments({
      user: userId,
      type: { $in: ["ai_insight", "coach_insight", "weekly_insight", "tradingDNA", "selfAwareness"] },
    }).catch(() => 0),
    WeeklyReport.countDocuments({ user: userId }).catch(() => 0),
  ]);

  const tradesLogged = forexTradeCount + indianTradeCount;
  const bestSetup = bestSetupAgg[0]
    ? {
        name: bestSetupAgg[0]._id,
        trades: bestSetupAgg[0].trades,
        winRate: Math.round((bestSetupAgg[0].winRate || 0) * 100),
      }
    : null;

  // Discipline score: prefer journal streak, fall back to rule streak.
  const streaks = req.user.streaks || {};
  const disciplineScore = Math.max(
    Number(streaks?.journal?.current) || 0,
    Number(streaks?.rule?.current) || 0,
  );

  const trial = getTrialState(req.user);

  // Fire-and-forget — knowing the paywall was seen is the top-of-funnel metric
  // for our conversion analytics.
  analytics.track("paywall_viewed", {
    userId,
    properties: {
      tradesLogged,
      hasBestSetup: Boolean(bestSetup),
      disciplineScore,
      planSource: getPlanSource(req.user),
      trialExpired: Boolean(trial?.used && !trial?.active),
    },
  });

  res.json({
    headline:
      trial?.used && !trial?.active
        ? "Your 7-day Premium trial has ended"
        : "Unlock your full edge",
    subheadline:
      tradesLogged > 0
        ? `You've already built ${tradesLogged} trades of evidence. Keep the momentum going.`
        : "Start logging trades and unlock pattern-level insights about your edge.",
    metrics: {
      disciplineScore,
      tradesLogged,
      bestSetup,                            // { name, trades, winRate } | null
      aiInsightsGenerated: aiInsightsCount,
      weeklyReports: weeklyReportsCount,
    },
    cta: {
      label: "Continue improving",
      priceLabel: "₹50/month",
      orderableLabel: "₹150 for 3 months",
      planType: "3_months",
    },
    trialEnded: Boolean(trial?.used && !trial?.active),
  });
});

// POST /api/trial/event
// Lightweight beacon for client-side analytics (e.g. paywall_cta_clicked).
// Whitelisted events only — never accept arbitrary strings from a browser.
const CLIENT_EVENT_ALLOWLIST = new Set([
  "paywall_cta_clicked",
  "paywall_dismissed",
  "trial_banner_clicked",
  "trial_extension_requested",
]);

exports.recordEvent = asyncHandler(async (req, res) => {
  const { event, properties } = req.body || {};
  if (typeof event !== "string" || !CLIENT_EVENT_ALLOWLIST.has(event)) {
    throw new ApiError(400, "Unknown analytics event", "VALIDATION_ERROR");
  }
  analytics.track(event, {
    userId: req.user._id,
    source: "client",
    properties: properties && typeof properties === "object" ? properties : {},
  });
  res.json({ ok: true });
});

// POST /api/admin/trials/:userId/extend  { days: number, reason?: string }
// Admin-only. Extends an existing trial OR grants a fresh one when none has
// been used (handy for promo grants to legacy users).
exports.adminExtendTrial = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const days = Math.floor(Number(req.body?.days));
  const reason = String(req.body?.reason || "").slice(0, 200);

  if (!Number.isFinite(days) || days <= 0 || days > 90) {
    throw new ApiError(400, "days must be between 1 and 90", "VALIDATION_ERROR");
  }

  const user = await User.findById(userId);
  if (!user) throw new ApiError(404, "User not found", "NOT_FOUND");

  const now = new Date();
  const additionMs = days * 24 * 60 * 60 * 1000;

  if (!user.trial?.startedAt) {
    // First-time grant for a legacy account that never had a trial.
    const fresh = buildTrialStart({ source: "manual_grant", now });
    user.trial = { ...fresh.trial, extendedBy: 0 };
  } else {
    const currentEnd = user.trial.endsAt
      ? new Date(user.trial.endsAt).getTime()
      : now.getTime();
    const base = Math.max(currentEnd, now.getTime());
    user.trial.endsAt = new Date(base + additionMs);
    user.trial.used = true;
    user.trial.extendedBy = (user.trial.extendedBy || 0) + days;
    if (!user.trial.source) user.trial.source = "manual_grant";
  }

  await user.save();
  await invalidateAuthCache(user._id).catch(() => {});

  analytics.track("trial_extended", {
    userId: user._id,
    source: "admin",
    properties: {
      days,
      reason,
      adminId: req.user?._id ? String(req.user._id) : null,
      newEndsAt: user.trial.endsAt,
    },
  });

  logger.info("[trial] admin extend", {
    adminId: String(req.user._id),
    userId: String(user._id),
    days,
    reason,
  });

  res.json({
    success: true,
    trial: getTrialState(user),
  });
});
