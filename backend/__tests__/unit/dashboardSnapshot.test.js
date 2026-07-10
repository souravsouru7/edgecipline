jest.mock("../../services/analyticsSnapshotService", () => ({
  getSnapshot: jest.fn(),
}));

jest.mock("../../models/NotificationHistory", () => ({
  countDocuments: jest.fn(),
  find: jest.fn(),
}));

jest.mock("../../models/Users", () => ({
  findById: jest.fn(),
}));

jest.mock("../../models/SetupStrategy", () => ({
  countDocuments: jest.fn(),
}));

jest.mock("../../models/Trade", () => ({
  countDocuments: jest.fn(),
}));

jest.mock("../../models/IndianTrade", () => ({
  countDocuments: jest.fn(),
}));

jest.mock("../../services/streak.service", () => ({
  getStreakSnapshot: jest.fn(),
}));

jest.mock("../../services/reflectionService", () => ({
  getTodayContext: jest.fn(),
  getWeeklySummary: jest.fn(),
}));

jest.mock("../../services/onboardingBackfillService", () => ({
  backfillUserOnboarding: jest.fn(),
}));

jest.mock("../../utils/logger", () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

const analyticsSnapshotService = require("../../services/analyticsSnapshotService");
const NotificationHistory = require("../../models/NotificationHistory");
const User = require("../../models/Users");
const SetupStrategy = require("../../models/SetupStrategy");
const Trade = require("../../models/Trade");
const IndianTrade = require("../../models/IndianTrade");
const streakService = require("../../services/streak.service");
const reflectionService = require("../../services/reflectionService");
const onboardingBackfillService = require("../../services/onboardingBackfillService");
const { getDashboardSnapshot } = require("../../controllers/dashboardController");

function createReq() {
  return {
    user: {
      _id: "user-1",
      name: "Test User",
      email: "test@example.com",
      role: "user",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      hasSeenWelcomeGuide: false,
      isOnboardingCompleted: false,
      termsAcceptance: {
        acceptedTerms: true,
        acceptedPrivacy: true,
      },
    },
  };
}

function createRes() {
  return {
    json: jest.fn(),
  };
}

function mockNotificationFind(latest = []) {
  NotificationHistory.find.mockReturnValue({
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(latest),
  });
}

describe("dashboard snapshot controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    NotificationHistory.countDocuments.mockResolvedValue(2);
    mockNotificationFind([{ title: "Risk alert", isRead: false }]);
    SetupStrategy.countDocuments.mockResolvedValue(0);
    Trade.countDocuments.mockResolvedValue(0);
    IndianTrade.countDocuments.mockResolvedValue(0);
    User.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });
    onboardingBackfillService.backfillUserOnboarding.mockResolvedValue({ changed: false });
    streakService.getStreakSnapshot.mockResolvedValue(null);
    reflectionService.getTodayContext.mockResolvedValue({
      day: "2026-01-01",
      completed: false,
      skipped: false,
      context: { hadTrades: false, tradeCount: 0 },
      reflection: null,
    });
    reflectionService.getWeeklySummary.mockResolvedValue({
      weekly: null,
      latestInsight: null,
    });
  });

  it("returns profile, welcome guide, analytics, notifications, and generatedAt in one response", async () => {
    analyticsSnapshotService.getSnapshot.mockResolvedValue({
      sourceTradeCount: 12,
      performance: {
        totalTrades: 12,
        grossPnL: 125.5,
        netPnL: 120,
        winRate: 58.33,
        avgPnL: 10,
        avgWin: 35,
        avgLoss: -18,
        totalCosts: 5.5,
        winningTrades: 7,
        losingTrades: 5,
        avgSetupScore: 76.4,
      },
      selfAwareness: { score: 70 },
      psychologyCost: { totalCost: -25 },
      tradingDNA: { archetype: "Disciplined" },
      cache: { hit: true, version: "4" },
    });

    const req = createReq();
    const res = createRes();
    const next = jest.fn();

    await getDashboardSnapshot(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(analyticsSnapshotService.getSnapshot).toHaveBeenCalledWith({
      userId: req.user._id,
      market: "Forex",
      period: "weekly",
    });
    expect(NotificationHistory.countDocuments).toHaveBeenCalledWith({ user: req.user._id, isRead: false });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      profile: expect.objectContaining({ email: "test@example.com" }),
      welcomeGuide: { hasSeenWelcomeGuide: false, isOnboardingCompleted: false },
      summary: expect.objectContaining({ totalTrades: 12, totalProfit: "125.50" }),
      selfAwareness: { score: 70 },
      psychologyCost: { totalCost: -25 },
      tradingDNA: { archetype: "Disciplined" },
      notificationsSummary: expect.objectContaining({ unreadCount: 2 }),
      sourceTradeCount: 12,
      partialErrors: [],
      cache: { hit: true, version: "4" },
    }));
    expect(res.json.mock.calls[0][0].generatedAt).toEqual(expect.any(String));
  });

  it("returns partial dashboard data when analytics snapshot generation fails", async () => {
    analyticsSnapshotService.getSnapshot.mockRejectedValue(new Error("analytics unavailable"));

    const res = createRes();
    const next = jest.fn();

    await getDashboardSnapshot(createReq(), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      summary: expect.objectContaining({ totalTrades: 0, totalProfit: "0.00" }),
      selfAwareness: null,
      psychologyCost: null,
      tradingDNA: null,
      notificationsSummary: expect.objectContaining({ unreadCount: 2 }),
      partialErrors: ["analytics_unavailable"],
    }));
  });

  it("derives onboarding progress from saved preferences and real setup/trade counts", async () => {
    analyticsSnapshotService.getSnapshot.mockResolvedValue({
      sourceTradeCount: 1,
      performance: { totalTrades: 1 },
    });
    SetupStrategy.countDocuments.mockResolvedValue(1);
    Trade.countDocuments.mockResolvedValue(1);

    const req = createReq();
    req.user.preferredMarket = "Forex";
    req.user.tradingStyle = "intraday";
    req.user.onboarding = {
      welcomeSeen: false,
      setupAdded: false,
      tradeAdded: false,
      firstInsightSeen: true,
      journalSeen: true,
    };
    const res = createRes();
    const next = jest.fn();

    await getDashboardSnapshot(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      onboarding: expect.objectContaining({
        welcomeSeen: true,
        marketSelected: true,
        styleSelected: true,
        setupAdded: true,
        tradeAdded: true,
        firstInsightSeen: true,
        journalSeen: true,
        setupCount: 1,
        tradeCount: 1,
      }),
    }));
  });

  it("uses lazy onboarding backfill on dashboard for already logged-in existing users", async () => {
    analyticsSnapshotService.getSnapshot.mockResolvedValue({
      sourceTradeCount: 1,
      performance: { totalTrades: 1 },
    });
    const req = createReq();
    const backfilledUser = {
      ...req.user,
      isOnboardingCompleted: true,
      hasSeenWelcomeGuide: true,
      onboarding: {
        welcomeSeen: true,
        marketSelected: true,
        styleSelected: true,
        setupAdded: true,
        tradeAdded: true,
        firstInsightSeen: true,
        completedAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    };
    onboardingBackfillService.backfillUserOnboarding.mockResolvedValue({ changed: true });
    User.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue(backfilledUser),
    });

    const res = createRes();
    const next = jest.fn();

    await getDashboardSnapshot(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(onboardingBackfillService.backfillUserOnboarding).toHaveBeenCalledWith(req.user._id);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      welcomeGuide: { hasSeenWelcomeGuide: true, isOnboardingCompleted: true },
      onboarding: expect.objectContaining({
        welcomeSeen: true,
        firstInsightSeen: true,
        tourCompleted: true,
        completedAt: backfilledUser.onboarding.completedAt,
      }),
    }));
  });
});
