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

  it("does not invent timing insights from a single trade", async () => {
    analyticsSnapshotService.getSnapshot.mockResolvedValue({
      generatedAt: "2026-06-28T00:00:00.000Z",
      sourceTradeCount: 1,
      performance: {
        totalTrades: 1,
        pnlReadyTrades: 1,
        grossPnL: 154.28,
        netPnL: 154.28,
        winningTrades: 1,
        losingTrades: 0,
        bestTrade: { profit: 154.28 },
        worstTrade: { profit: 154.28 },
      },
      basicStats: { totalTrades: 1 },
      trades: [
        { _id: "t1", profit: 154.28, tradeDate: "2026-07-19T10:00:00.000Z" },
      ],
      timeline: { buckets: [] },
      discipline: {},
      tradingDNA: {},
      selfAwareness: {},
      psychologyCost: {},
      patterns: {},
      cache: { hit: false },
    });

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
    const payload = res.json.mock.calls[0][0];
    expect(payload.timeAnalysis.bestDay).toBeNull();
    expect(payload.timeAnalysis.worstDay).toBeNull();
    expect(payload.timeAnalysis.bestHour).toBeNull();
    expect(payload.timeAnalysis.worstHour).toBeNull();
    expect(payload.timeAnalysis.byHour["10"].profit).toBe(154.28);
    expect(payload.performance.largestWin).toBe("154.28");
    expect(payload.performance.largestLoss).toBeNull();
    expect(payload.riskReward.avgRR).toBeNull();
    expect(payload.riskReward.actualRR).toBeNull();
    expect(payload.riskReward.bestRR).toBeNull();
    expect(payload.riskReward.tradesWithRR).toBe(0);
  });

  it("separates planned risk reward from actual win loss ratio", async () => {
    analyticsSnapshotService.getSnapshot.mockResolvedValue({
      generatedAt: "2026-06-28T00:00:00.000Z",
      sourceTradeCount: 2,
      performance: {
        totalTrades: 2,
        pnlReadyTrades: 2,
        grossPnL: 50,
        netPnL: 50,
        winningTrades: 1,
        losingTrades: 1,
        avgWin: 100,
        avgLoss: 50,
        bestTrade: { profit: 100 },
        worstTrade: { profit: -50 },
      },
      basicStats: { totalTrades: 2 },
      trades: [
        { _id: "t1", profit: 100, entryPrice: 100, stopLoss: 95, takeProfit: 110, tradeDate: "2026-07-19T10:00:00.000Z" },
        { _id: "t2", profit: -50, riskRewardRatio: "1:3", tradeDate: "2026-07-20T14:00:00.000Z" },
      ],
      timeline: { buckets: [] },
      discipline: {},
      tradingDNA: {},
      selfAwareness: {},
      psychologyCost: {},
      patterns: {},
      cache: { hit: false },
    });

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
    const payload = res.json.mock.calls[0][0];
    expect(payload.riskReward.avgRR).toBe("2.50");
    expect(payload.riskReward.plannedRR).toBe("2.50");
    expect(payload.riskReward.bestRR).toBe("3.00");
    expect(payload.riskReward.avgWinRR).toBe("2.00");
    expect(payload.riskReward.avgLossRR).toBe("3.00");
    expect(payload.riskReward.actualRR).toBe("2.00");
    expect(payload.riskReward.tradesWithRR).toBe(2);
    expect(payload.performance.largestWin).toBe("100.00");
    expect(payload.performance.largestLoss).toBe("-50.00");
  });

  it("returns a numeric hour field when timing hour insight is valid", async () => {
    analyticsSnapshotService.getSnapshot.mockResolvedValue({
      generatedAt: "2026-06-28T00:00:00.000Z",
      sourceTradeCount: 2,
      performance: { totalTrades: 2, grossPnL: 75, netPnL: 75 },
      basicStats: { totalTrades: 2 },
      trades: [
        { _id: "t1", profit: 125, tradeDate: "2026-07-19T10:00:00.000Z" },
        { _id: "t2", profit: -50, tradeDate: "2026-07-20T14:00:00.000Z" },
      ],
      timeline: { buckets: [] },
      discipline: {},
      tradingDNA: {},
      selfAwareness: {},
      psychologyCost: {},
      patterns: {},
      cache: { hit: false },
    });

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
    const payload = res.json.mock.calls[0][0];
    expect(payload.timeAnalysis.bestDay).toEqual(expect.objectContaining({ name: "Sunday", profit: 125 }));
    expect(payload.timeAnalysis.worstDay).toEqual(expect.objectContaining({ name: "Monday", profit: -50 }));
    expect(payload.timeAnalysis.bestHour).toEqual(expect.objectContaining({ hour: "10", profit: 125 }));
    expect(payload.timeAnalysis.worstHour).toEqual(expect.objectContaining({ hour: "14", profit: -50 }));
  });
});
