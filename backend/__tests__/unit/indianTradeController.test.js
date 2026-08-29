jest.mock("../../models/IndianTrade", () => ({
  // The free-trade gate counts existing entries before every create.
  countDocuments: jest.fn().mockResolvedValue(0),
  create: jest.fn(),
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
}));

jest.mock("../../services/tradeLifecycle.service", () => ({
  softDeleteTrade: jest.fn(),
}));

jest.mock("../../utils/cacheUtils", () => ({
  TRADE_CACHE_EVENTS: {
    CREATE: "create",
    OCR_SAVE: "ocr_save",
    BULK_IMPORT: "bulk_import",
  },
  invalidateTradeCaches: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../services/smartNotificationEvaluator", () => ({
  evaluateSmartNotifications: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../services/streak.service", () => ({
  recordTradeAndRecompute: jest.fn().mockResolvedValue({ events: [] }),
  recordTradeEvent: jest.fn().mockResolvedValue(undefined),
  recomputeStreaks: jest.fn().mockResolvedValue({ events: [] }),
}));

jest.mock("../../services/onboardingService", () => ({
  markTradeLogged: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../services/streakNotification.service", () => ({
  handleStreakEvents: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../services/ocrJob.service", () => ({
  getOcrConfirmationTrades: jest.fn().mockResolvedValue([]),
  claimOcrJobForConfirmation: jest.fn().mockResolvedValue({ extractedData: {} }),
  releaseOcrJobClaim: jest.fn().mockResolvedValue(undefined),
  extractConfirmationTrades: jest.fn(() => []),
  markOcrJobConfirmed: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../utils/cloudinaryHelpers", () => ({
  destroyImages: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../utils/logger", () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const IndianTrade = require("../../models/IndianTrade");
const tradeLifecycleService = require("../../services/tradeLifecycle.service");
const {
  createTrade,
  getTrade,
  updateTrade,
  deleteTrade,
} = require("../../controllers/indianTradeController");

function createReq(body, params = {}) {
  return {
    user: {
      _id: "user-1",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    },
    body,
    params,
  };
}

function createRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

describe("indian trade controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects option trades that do not have a positive lot quantity", async () => {
    const req = createReq({
      pair: "NIFTY 24100 PE",
      type: "BUY",
      optionType: "PE",
      strikePrice: 24100,
      expiryDate: "2026-07-31",
      tradeDate: "2026-07-13",
      quantity: 0,
      lotSize: 25,
      entryPrice: 100,
      exitPrice: 120,
      profit: 500,
    });
    const res = createRes();
    const next = jest.fn();

    await createTrade(req, res, next);

    expect(IndianTrade.create).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 400,
      errorCode: "VALIDATION_ERROR",
      message: "Quantity must be greater than 0",
    }));
  });

  it("derives and saves Indian option profit when prices, quantity, and lot size are valid", async () => {
    IndianTrade.create.mockImplementation(async (doc) => ({ _id: "trade-1", ...doc }));
    const req = createReq({
      pair: "NIFTY 24100 PE",
      type: "BUY",
      optionType: "PE",
      strikePrice: 24100,
      expiryDate: "2026-07-31",
      tradeDate: "2026-07-13",
      quantity: 1,
      lotSize: 25,
      entryPrice: 100,
      exitPrice: 120,
      mood: 3,
      confidence: "Medium",
      emotionalTags: ["Calm"],
      tradeQuality: "Great",
    });
    const res = createRes();
    const next = jest.fn();

    await createTrade(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(IndianTrade.create).toHaveBeenCalledWith(expect.objectContaining({
      quantity: 1,
      lotSize: 25,
      entryPrice: 100,
      exitPrice: 120,
      profit: 500,
      instrumentType: "OPTION",
    }));
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ profit: 500 }));
  });

  it("scopes Indian trade reads to the authenticated user", async () => {
    IndianTrade.findOne.mockResolvedValue(null);
    const req = createReq({}, { id: "trade-a" });
    const res = createRes();
    const next = jest.fn();

    await getTrade(req, res, next);

    expect(IndianTrade.findOne).toHaveBeenCalledWith({
      _id: "trade-a",
      user: "user-1",
      deletedAt: null,
    });
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 404,
      errorCode: "NOT_FOUND",
    }));
  });

  it("scopes Indian trade updates to the authenticated user", async () => {
    IndianTrade.findOneAndUpdate.mockResolvedValue(null);
    const req = createReq({ notes: "changed" }, { id: "trade-a" });
    const res = createRes();
    const next = jest.fn();

    await updateTrade(req, res, next);

    expect(IndianTrade.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: "trade-a",
        user: "user-1",
        deletedAt: null,
      },
      expect.objectContaining({ notes: "changed" }),
      { returnDocument: "after", runValidators: true }
    );
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 404,
      errorCode: "NOT_FOUND",
    }));
  });

  it("scopes Indian trade deletes to the authenticated user", async () => {
    tradeLifecycleService.softDeleteTrade.mockResolvedValue(null);
    const req = createReq({}, { id: "trade-a" });
    const res = createRes();
    const next = jest.fn();

    await deleteTrade(req, res, next);

    expect(tradeLifecycleService.softDeleteTrade).toHaveBeenCalledWith(
      IndianTrade,
      expect.objectContaining({
        tradeId: "trade-a",
        userId: "user-1",
        deletedBy: "user-1",
        deletedSource: "user",
      })
    );
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 404,
      errorCode: "NOT_FOUND",
    }));
  });
});
