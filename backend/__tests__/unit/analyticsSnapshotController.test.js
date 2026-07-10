jest.mock("../../services/analyticsSnapshotService", () => ({
  getSnapshot: jest.fn(),
  getPerformanceSnapshot: jest.fn(),
  getTimelineSnapshot: jest.fn(),
  getTradeDistributionSnapshot: jest.fn(),
  getTradeQualitySnapshot: jest.fn(),
  getPnlBreakdownSnapshot: jest.fn(),
  getDisciplineSummarySnapshot: jest.fn(),
}));

jest.mock("../../utils/aiCoachFeed", () => ({
  generateCoachFeed: jest.fn(() => ({ insights: [] })),
}));

const analyticsSnapshotService = require("../../services/analyticsSnapshotService");
const { getAnalyticsSnapshot } = require("../../controllers/analyticsSnapshotController");

describe("analyticsSnapshotController", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    analyticsSnapshotService.getSnapshot.mockResolvedValue({
      generatedAt: "2026-06-28T00:00:00.000Z",
      sourceTradeCount: 0,
      performance: { totalTrades: 0 },
      basicStats: { totalTrades: 0 },
      trades: [],
      timeline: { buckets: [] },
      discipline: {},
      tradingDNA: {},
      selfAwareness: {},
      psychologyCost: {},
      patterns: {},
      cache: { hit: false },
    });
    analyticsSnapshotService.getTradeDistributionSnapshot.mockResolvedValue({
      distribution: {},
      cache: { hit: false },
    });
    analyticsSnapshotService.getTradeQualitySnapshot.mockResolvedValue({
      quality: {},
      cache: { hit: false },
    });
    analyticsSnapshotService.getPnlBreakdownSnapshot.mockResolvedValue({
      daily: [],
      weekly: [],
      monthly: [],
      cache: { hit: false },
    });
    analyticsSnapshotService.getDisciplineSummarySnapshot.mockResolvedValue({
      disciplineSummary: {},
      cache: { hit: false },
    });
  });

  it("reuses snapshot performance and timeline instead of running duplicate aggregates", async () => {
    const req = {
      user: { _id: "507f1f77bcf86cd799439011" },
      query: {},
      baseUrl: "/api",
      isIndianMarket: false,
    };
    const res = { json: jest.fn() };
    const next = jest.fn();

    await getAnalyticsSnapshot(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(analyticsSnapshotService.getSnapshot).toHaveBeenCalledTimes(1);
    expect(analyticsSnapshotService.getPerformanceSnapshot).not.toHaveBeenCalled();
    expect(analyticsSnapshotService.getTimelineSnapshot).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      timeline: { buckets: [] },
      cache: expect.objectContaining({
        performance: { hit: false },
        timeline: { hit: false },
      }),
    }));
  });
});
