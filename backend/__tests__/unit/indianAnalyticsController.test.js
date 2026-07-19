jest.mock("../../models/IndianTrade", () => ({
  find: jest.fn(),
}));

jest.mock("../../services/analyticsSnapshotService", () => ({
  getPerformanceSnapshot: jest.fn(),
  getPnlBreakdownSnapshot: jest.fn(),
  getTradeDistributionSnapshot: jest.fn(),
  getTradeQualitySnapshot: jest.fn(),
  getSnapshot: jest.fn(),
}));

const IndianTrade = require("../../models/IndianTrade");
const analyticsSnapshotService = require("../../services/analyticsSnapshotService");
const {
  getSummary,
  getPerformanceMetrics,
} = require("../../controllers/indianAnalyticsController");

const userId = "507f1f77bcf86cd799439099";

function makeQuery(result) {
  const query = {
    select: jest.fn(() => query),
    lean: jest.fn(() => query),
    sort: jest.fn(() => query),
    limit: jest.fn(() => Promise.resolve(result)),
  };
  return query;
}

function makeResponse() {
  return { json: jest.fn(), status: jest.fn(() => ({ json: jest.fn() })) };
}

describe("indianAnalyticsController", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    analyticsSnapshotService.getPerformanceSnapshot.mockResolvedValue({
      performance: {
        totalTrades: 0,
        grossPnL: 0,
        netPnL: 0,
        winRate: 0,
        avgPnL: 0,
        avgWin: 0,
        avgLoss: 0,
        totalCosts: 0,
        winningTrades: 0,
        losingTrades: 0,
        avgSetupScore: null,
      },
    });
    IndianTrade.find.mockReturnValue(makeQuery([]));
  });

  test("does not default dashboard summary totals to options only", async () => {
    const req = { user: { _id: userId }, query: {} };
    const res = makeResponse();
    const next = jest.fn();

    await getSummary(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(analyticsSnapshotService.getPerformanceSnapshot).toHaveBeenCalledWith({
      userId,
      market: "Indian_Market",
      instrumentType: undefined,
    });
  });

  test("keeps explicit Indian analytics instrument filters", async () => {
    const req = { user: { _id: userId }, query: { instrumentType: "equity" } };
    const res = makeResponse();
    const next = jest.fn();

    await getSummary(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(analyticsSnapshotService.getPerformanceSnapshot).toHaveBeenCalledWith({
      userId,
      market: "Indian_Market",
      instrumentType: "EQUITY",
    });
  });

  test("does not filter direct metrics calls when dashboard omits instrument type", async () => {
    const req = { user: { _id: userId }, query: {} };
    const res = makeResponse();
    const next = jest.fn();

    await getPerformanceMetrics(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(IndianTrade.find).toHaveBeenCalledWith({
      user: userId,
      deletedAt: null,
    });
  });
});
