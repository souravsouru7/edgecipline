const asyncHandler = require("../utils/asyncHandler");
const analyticsSnapshotService = require("../services/analyticsSnapshotService");
const NotificationHistory = require("../models/NotificationHistory");
const User = require("../models/Users");
const SetupStrategy = require("../models/SetupStrategy");
const Trade = require("../models/Trade");
const IndianTrade = require("../models/IndianTrade");
const streakService = require("../services/streak.service");
const reflectionService = require("../services/reflectionService");
const { logger } = require("../utils/logger");
const { getTrialState, getPlanSource, isPremium } = require("../utils/premium");

async function loadStreakSnapshot(userId) {
  try {
    return await streakService.getStreakSnapshot(userId);
  } catch (error) {
    logger.error("Failed to load streak snapshot", { error: error.message });
    return null;
  }
}

async function loadReflectionSnapshot(userId) {
  try {
    const snapshot = await reflectionService.getSummarySnapshot(userId);
    const today = snapshot.today;
    return {
      today: {
        day:           today.day,
        completed:     today.completed,
        skipped:       today.skipped,
        hadTrades:     today.context?.hadTrades || false,
        tradeCount:    today.context?.tradeCount || 0,
        followedPlan:  today.reflection?.followedPlan || null,
        wouldRepeat:   today.reflection?.wouldRepeat || null,
        mood:          today.reflection?.mood ?? null,
        confidence:    today.reflection?.confidence ?? null,
      },
      weekly:        snapshot.weekly,
      latestInsight: snapshot.latestInsight,
      error: null,
    };
  } catch (error) {
    logger.warn("Dashboard reflection snapshot failed", {
      userId: userId?.toString?.() || userId,
      error: error.message,
    });
    return { today: null, weekly: null, latestInsight: null, error: "reflection_unavailable" };
  }
}

async function loadOnboardingProgress(userId) {
  try {
    const [setupCount, tradeCount, indianTradeCount] = await Promise.all([
      SetupStrategy.countDocuments({ user: userId }),
      Trade.countDocuments({ user: userId, deletedAt: null }),
      IndianTrade.countDocuments({ user: userId, deletedAt: null }).catch(() => 0),
    ]);
    return {
      setupCount,
      tradeCount: tradeCount + indianTradeCount,
    };
  } catch (error) {
    logger.warn("Onboarding progress load failed", {
      userId: userId?.toString?.() || userId,
      error: error.message,
    });
    return { setupCount: 0, tradeCount: 0 };
  }
}

const toNum = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const fixed = (value, digits = 2) => toNum(value).toFixed(digits);

function needsTermsAcceptance(user) {
  return (
    user?.termsAcceptance?.acceptedTerms !== true ||
    user?.termsAcceptance?.acceptedPrivacy !== true
  );
}

function buildProfile(user) {
  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
    requiresTermsAcceptance: needsTermsAcceptance(user) || undefined,
  };
}

function buildSummary(performance = {}) {
  return {
    totalTrades: performance.totalTrades || 0,
    totalProfit: fixed(performance.grossPnL),
    netProfit: fixed(performance.netPnL),
    netPnL: fixed(performance.netPnL),
    winRate: fixed(performance.winRate, 1),
    avgTrade: fixed(performance.avgPnL),
    avgWin: fixed(performance.avgWin),
    avgLoss: fixed(performance.avgLoss),
    totalCosts: fixed(performance.totalCosts),
    winningTrades: performance.winningTrades || performance.wins || 0,
    losingTrades: performance.losingTrades || performance.losses || 0,
    pnlReadyTrades: performance.pnlReadyTrades || performance.analyticsTradeCount || 0,
    tradesMissingPnl: performance.tradesMissingPnl || 0,
    avgSetupScore: fixed(performance.avgSetupScore ?? 0, 1),
  };
}

function emptySummary() {
  return buildSummary({});
}

function resolveDashboardMarket(value) {
  return value === "Indian_Market" ? "Indian_Market" : "Forex";
}

async function loadDashboardAnalytics(userId, market = "Forex") {
  try {
    const resolvedMarket = resolveDashboardMarket(market);
    const snapshot = await analyticsSnapshotService.getSnapshot({
      userId,
      market: resolvedMarket,
      period: "weekly",
    });

    return {
      summary: buildSummary(snapshot.performance || snapshot.basicStats || {}),
      selfAwareness: snapshot.selfAwareness || null,
      psychologyCost: snapshot.psychologyCost || null,
      tradingDNA: snapshot.tradingDNA || null,
      timeline: snapshot.timeline || null,
      cache: snapshot.cache || null,
      sourceTradeCount: snapshot.sourceTradeCount || 0,
      error: null,
    };
  } catch (error) {
    logger.warn("Dashboard analytics snapshot failed", {
      userId: userId?.toString?.() || userId,
      error: error.message,
    });
    return {
      summary: emptySummary(),
      selfAwareness: null,
      psychologyCost: null,
      tradingDNA: null,
      timeline: null,
      cache: null,
      sourceTradeCount: 0,
      error: "analytics_unavailable",
    };
  }
}

async function loadNotificationsSummary(userId) {
  try {
    const [unreadCount, latest] = await Promise.all([
      NotificationHistory.countDocuments({ user: userId, isRead: false }),
      NotificationHistory.find({ user: userId })
        .sort({ createdAt: -1 })
        .limit(3)
        .select("type title body deepLink isRead createdAt")
        .lean(),
    ]);

    return {
      unreadCount,
      latest,
      error: null,
    };
  } catch (error) {
    logger.warn("Dashboard notifications summary failed", {
      userId: userId?.toString?.() || userId,
      error: error.message,
    });
    return {
      unreadCount: 0,
      latest: [],
      error: "notifications_unavailable",
    };
  }
}

exports.getDashboardSnapshot = asyncHandler(async (req, res) => {
  const generatedAt = new Date().toISOString();
  let dashboardUser = req.user;
  try {
    const backfillService = require("../services/onboardingBackfillService");
    const result = await backfillService.backfillUserOnboarding(req.user._id);
    if (result?.changed) {
      dashboardUser = await User.findById(req.user._id).lean() || req.user;
    }
  } catch (error) {
    logger.warn("Dashboard onboarding backfill failed", {
      userId: req.user?._id?.toString?.() || req.user?._id,
      error: error.message,
    });
  }

  const [analytics, notificationsSummary, onboardingProgress, streaks, reflection] = await Promise.all([
    loadDashboardAnalytics(dashboardUser._id, req.query?.market),
    loadNotificationsSummary(dashboardUser._id),
    loadOnboardingProgress(dashboardUser._id),
    loadStreakSnapshot(dashboardUser._id),
    loadReflectionSnapshot(dashboardUser._id),
  ]);

  const o = dashboardUser.onboarding || {};
  const setupAdded = Boolean(o.setupAdded) || onboardingProgress.setupCount > 0;
  const tradeAdded = Boolean(o.tradeAdded) || onboardingProgress.tradeCount > 0;
  const journalSeen = Boolean(o.journalSeen);
  const laterOnboardingStepSeen =
    Boolean(o.marketSelected) ||
    Boolean(o.styleSelected) ||
    setupAdded ||
    tradeAdded ||
    Boolean(o.tradeSkipped) ||
    Boolean(o.firstInsightSeen) ||
    journalSeen;

  res.json({
    profile: buildProfile(dashboardUser),
    monetization: {
      isPremium: isPremium(dashboardUser),
      planSource: getPlanSource(dashboardUser),  // "admin"|"subscription"|"trial"|"free"
      trial: getTrialState(dashboardUser),       // null for legacy users
      subscription: {
        status:    dashboardUser.subscriptionStatus,
        plan:      dashboardUser.subscriptionPlan,
        expiresAt: dashboardUser.subscriptionExpiry || null,
      },
    },
    welcomeGuide: {
      hasSeenWelcomeGuide: Boolean(dashboardUser.hasSeenWelcomeGuide),
      isOnboardingCompleted: Boolean(dashboardUser.isOnboardingCompleted),
    },
    preferredMarket: dashboardUser.preferredMarket || null,
    onboarding: {
      welcomeSeen:        Boolean(o.welcomeSeen) || laterOnboardingStepSeen,
      marketSelected:     Boolean(o.marketSelected) || Boolean(dashboardUser.preferredMarket),
      styleSelected:      Boolean(o.styleSelected) || Boolean(dashboardUser.tradingStyle),
      setupAdded,
      tradeAdded,
      tradeSkipped:       Boolean(o.tradeSkipped),
      firstInsightSeen:   Boolean(o.firstInsightSeen),
      journalSeen,
      analyticsSeen:      Boolean(o.analyticsSeen),
      notificationsSeen:  Boolean(o.notificationsSeen),
      tourCompleted:      Boolean(o.tourCompleted) || Boolean(dashboardUser.isOnboardingCompleted && o.completedAt),
      checklistDismissed: Boolean(o.checklistDismissed),
      completedAt:        o.completedAt || null,
      setupCount:         onboardingProgress.setupCount,
      tradeCount:         onboardingProgress.tradeCount,
    },
    summary: analytics.summary,
    selfAwareness: analytics.selfAwareness,
    psychologyCost: analytics.psychologyCost,
    tradingDNA: analytics.tradingDNA,
    timeline: analytics.timeline,
    streaks,
    reflection,
    notificationsSummary,
    generatedAt,
    sourceTradeCount: analytics.sourceTradeCount,
    partialErrors: [analytics.error, notificationsSummary.error, reflection?.error].filter(Boolean),
    cache: analytics.cache,
  });
});
