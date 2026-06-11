jest.mock("../../models/IndianTrade", () => ({
  insertMany: jest.fn(),
}));

jest.mock("../../utils/cacheUtils", () => ({
  TRADE_CACHE_EVENTS: {
    BULK_IMPORT: "bulk_import",
    OCR_SAVE: "ocr_save",
  },
  invalidateTradeCaches: jest.fn(),
}));

jest.mock("../../services/smartNotificationEvaluator", () => ({
  evaluateSmartNotifications: jest.fn(),
}));

jest.mock("../../services/ocrJob.service", () => ({
  markOcrJobConfirmed: jest.fn(),
}));

const IndianTrade = require("../../models/IndianTrade");
const { invalidateTradeCaches } = require("../../utils/cacheUtils");
const { evaluateSmartNotifications } = require("../../services/smartNotificationEvaluator");
const { markOcrJobConfirmed } = require("../../services/ocrJob.service");
const { createTradesBatch } = require("../../controllers/indianTradeController");

function createReq(body) {
  return {
    body,
    user: {
      _id: "user-1",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  };
}

function createRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

describe("indianTradeController.createTradesBatch", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("batch inserts Indian OCR trades and invalidates once", async () => {
    IndianTrade.insertMany.mockResolvedValue([
      { _id: "ind-1", pair: "NIFTY 25000 CE" },
      { _id: "ind-2", pair: "BANKNIFTY 52000 PE" },
    ]);

    const req = createReq({
      ocrJobId: "ocr-ind-1",
      trades: [
        { pair: "NIFTY 25000 CE", type: "BUY", optionType: "CE", tradeDate: "2026-06-01", profit: 100 },
        { pair: "BANKNIFTY 52000 PE", type: "SELL", optionType: "PE", tradeDate: "2026-06-01", profit: -50 },
      ],
    });
    const res = createRes();
    const next = jest.fn();

    await createTradesBatch(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(IndianTrade.insertMany).toHaveBeenCalledTimes(1);
    expect(IndianTrade.insertMany.mock.calls[0][0]).toHaveLength(2);
    expect(invalidateTradeCaches).toHaveBeenCalledTimes(1);
    expect(invalidateTradeCaches).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      event: "ocr_save",
      market: "Indian_Market",
      count: 2,
      source: "ocr_batch_confirm",
    }));
    expect(evaluateSmartNotifications).toHaveBeenCalledTimes(1);
    expect(markOcrJobConfirmed).toHaveBeenCalledTimes(1);
    expect(markOcrJobConfirmed).toHaveBeenCalledWith("user-1", "ocr-ind-1", {
      tradeId: "ind-1",
      collection: "indian",
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      count: 2,
    }));
  });
});
