const asyncHandler = require("../utils/asyncHandler");
const analyticsSnapshotService = require("../services/analyticsSnapshotService");
const NotificationHistory = require("../models/NotificationHistory");
const { logger } = require("../utils/logger");

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
    avgSetupScore: fixed(performance.avgSetupScore ?? 0, 1),
  };
}

function emptySummary() {
  return buildSummary({});
}

async function loadDashboardAnalytics(userId) {
  try {
    const snapshot = await analyticsSnapshotService.getSnapshot({
      userId,
      market: "Forex",
      period: "weekly",
    });

    return {
      summary: buildSummary(snapshot.performance || snapshot.basicStats || {}),
      selfAwareness: snapshot.selfAwareness || null,
      psychologyCost: snapshot.psychologyCost || null,
      tradingDNA: snapshot.tradingDNA || null,
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
  const [analytics, notificationsSummary] = await Promise.all([
    loadDashboardAnalytics(req.user._id),
    loadNotificationsSummary(req.user._id),
  ]);

  res.json({
    profile: buildProfile(req.user),
    welcomeGuide: {
      hasSeenWelcomeGuide: Boolean(req.user.hasSeenWelcomeGuide),
      isOnboardingCompleted: Boolean(req.user.isOnboardingCompleted),
    },
    summary: analytics.summary,
    selfAwareness: analytics.selfAwareness,
    psychologyCost: analytics.psychologyCost,
    tradingDNA: analytics.tradingDNA,
    notificationsSummary,
    generatedAt,
    sourceTradeCount: analytics.sourceTradeCount,
    partialErrors: [analytics.error, notificationsSummary.error].filter(Boolean),
    cache: analytics.cache,
  });
});
