jest.mock("../../models/IndianTrade", () => ({
  create: jest.fn(),
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
const { createTrade } = require("../../controllers/indianTradeController");

function createReq(body) {
  return {
    user: {
      _id: "user-1",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    },
    body,
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
});
