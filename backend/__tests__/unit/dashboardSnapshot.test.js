jest.mock("../../services/analyticsSnapshotService", () => ({
  getSnapshot: jest.fn(),
}));

jest.mock("../../models/NotificationHistory", () => ({
  countDocuments: jest.fn(),
  find: jest.fn(),
}));

jest.mock("../../utils/logger", () => ({
  logger: {
    warn: jest.fn(),
  },
}));

const analyticsSnapshotService = require("../../services/analyticsSnapshotService");
const NotificationHistory = require("../../models/NotificationHistory");
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
});
