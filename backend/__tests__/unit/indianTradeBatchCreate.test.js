jest.mock("../../models/IndianTrade", () => ({
  // The free-trade gate counts existing entries before every create.
  countDocuments: jest.fn().mockResolvedValue(0),
  insertMany: jest.fn(),
  find: jest.fn(),
  findOneAndUpdate: jest.fn(),
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
  getOcrConfirmationTrades: jest.fn().mockResolvedValue([]),
  claimOcrJobForConfirmation: jest.fn(),
  releaseOcrJobClaim: jest.fn().mockResolvedValue(undefined),
  extractConfirmationTrades: jest.fn((job) => job?.extractedData?.parsedTrades || []),
  markOcrJobConfirmed: jest.fn(),
}));

const IndianTrade = require("../../models/IndianTrade");
const mongoose = require("mongoose");
const { invalidateTradeCaches } = require("../../utils/cacheUtils");
const { evaluateSmartNotifications } = require("../../services/smartNotificationEvaluator");
const {
  getOcrConfirmationTrades,
  claimOcrJobForConfirmation,
  releaseOcrJobClaim,
  markOcrJobConfirmed,
} = require("../../services/ocrJob.service");
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
    jest.restoreAllMocks();
    jest.clearAllMocks();
    getOcrConfirmationTrades.mockResolvedValue([]);
    // claimOcrJobForConfirmation is the new atomic gate that replaced a plain
    // getOcrConfirmationTrades() read in the controller -- delegate to
    // whatever each test configures getOcrConfirmationTrades to resolve, so
    // existing test bodies below don't need to change.
    claimOcrJobForConfirmation.mockImplementation(async () => ({
      extractedData: { parsedTrades: await getOcrConfirmationTrades() },
    }));
    jest.spyOn(mongoose, "startSession").mockResolvedValue({
      withTransaction: async (work) => work(),
      endSession: jest.fn(),
    });
  });

  afterAll(() => jest.restoreAllMocks());

  it("batch inserts Indian OCR trades and invalidates once", async () => {
    getOcrConfirmationTrades.mockResolvedValue([
      { pair: "NIFTY 25000 CE", type: "BUY", pnl: 100 },
      { pair: "BANKNIFTY 52000 PE", type: "SELL", pnl: -50 },
    ]);
    IndianTrade.insertMany.mockResolvedValue([
      { _id: "ind-1", pair: "NIFTY 25000 CE" },
      { _id: "ind-2", pair: "BANKNIFTY 52000 PE" },
    ]);

    const req = createReq({
      ocrJobId: "ocr-ind-1",
      trades: [
        { pair: "NIFTY 25000 CE", type: "BUY", optionType: "CE", strikePrice: 25000, expiryDate: "2026-06-25", tradeDate: "2026-06-01", profit: 100 },
        { pair: "BANKNIFTY 52000 PE", type: "SELL", optionType: "PE", strikePrice: 52000, expiryDate: "2026-06-25", tradeDate: "2026-06-01", profit: -50 },
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
      session: expect.any(Object),
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      count: 2,
    }));
  });

  it("saves OCR-confirmed closed Indian positions from server P&L without deriving from prices", async () => {
    getOcrConfirmationTrades.mockResolvedValue([
      { symbol: "NIFTY", strike: 24200, optionType: "CE", quantity: 0, entryPrice: null, pnl: 1371.5 },
      { symbol: "NIFTY", strike: 24300, optionType: "PE", quantity: 0, entryPrice: null, pnl: 968.5 },
    ]);
    IndianTrade.insertMany.mockImplementation(async (docs) =>
      docs.map((doc, index) => ({ ...doc, _id: `ind-${index + 1}` }))
    );

    const req = createReq({
      ocrJobId: "ocr-ind-closed",
      trades: [
        {
          pair: "NIFTY 24200 CE",
          type: "BUY",
          optionType: "CE",
          strikePrice: 24200,
          expiryDate: "2026-07-31",
          tradeDate: "2026-07-19",
          quantity: 0,
          lotSize: 25,
          entryPrice: 157.17,
          exitPrice: 1.15,
          profit: 1371.5,
        },
        {
          pair: "NIFTY 24300 PE",
          type: "BUY",
          optionType: "PE",
          strikePrice: 24300,
          expiryDate: "2026-07-31",
          tradeDate: "2026-07-19",
          quantity: 0,
          lotSize: 25,
          entryPrice: 33,
          exitPrice: 133,
          profit: 968.5,
        },
      ],
    });

    await createTradesBatch(req, createRes(), jest.fn());

    const docs = IndianTrade.insertMany.mock.calls[0][0];
    expect(docs).toEqual([
      expect.objectContaining({
        pair: "NIFTY 24200 CE",
        optionType: "CE",
        quantity: 0,
        profit: 1371.5,
      }),
      expect.objectContaining({
        pair: "NIFTY 24300 PE",
        optionType: "PE",
        quantity: 0,
        profit: 968.5,
      }),
    ]);
  });

  it("strips protected fields from every Indian OCR-confirmed trade", async () => {
    getOcrConfirmationTrades.mockResolvedValue([
      { pair: "NIFTY 25000 CE", type: "BUY", pnl: 100 },
    ]);
    IndianTrade.insertMany.mockImplementation(async (docs) =>
      docs.map((doc, index) => ({ ...doc, _id: `ind-${index + 1}` }))
    );

    const req = createReq({
      ocrJobId: "ocr-ind-1",
      trades: [{
        pair: "NIFTY 25000 CE",
        type: "BUY",
        optionType: "CE",
        strikePrice: 25000,
        expiryDate: "2026-06-25",
        tradeDate: "2026-06-01",
        quantity: 0,
        lotSize: 25,
        profit: 100,
        notes: "allowed",
        user: "user-2",
        marketType: "Forex",
        createdAt: "2000-01-01",
        updatedAt: "2000-01-01",
        deletedAt: "2000-01-01",
        ocrJobId: "attacker-job",
        subscriptionStatus: "active",
        paymentStatus: "paid",
        tokenVersion: 0,
        role: "admin",
        processedAt: "2000-01-01",
        extractionConfidence: 100,
      }],
    });

    await createTradesBatch(req, createRes(), jest.fn());

    const [doc] = IndianTrade.insertMany.mock.calls[0][0];
    expect(doc).toEqual(expect.objectContaining({
      user: "user-1",
      pair: "NIFTY 25000 CE",
      notes: "allowed",
    }));
    for (const field of [
      "marketType", "createdAt", "updatedAt", "deletedAt", "ocrJobId",
      "subscriptionStatus", "paymentStatus", "tokenVersion", "role",
      "processedAt", "extractionConfidence",
    ]) {
      expect(doc).not.toHaveProperty(field);
    }
  });

  it("releases the OCR job claim if batch trade insertion fails after a successful claim", async () => {
    getOcrConfirmationTrades.mockResolvedValue([
      { pair: "NIFTY 25000 CE", type: "BUY", pnl: 100 },
    ]);
    const insertError = new Error("insertMany failed");
    IndianTrade.insertMany.mockRejectedValue(insertError);

    const req = createReq({
      ocrJobId: "ocr-ind-fail",
      trades: [{ pair: "NIFTY 25000 CE", type: "BUY", optionType: "CE", strikePrice: 25000, expiryDate: "2026-06-25", tradeDate: "2026-06-01", profit: 100 }],
    });
    const next = jest.fn();

    await createTradesBatch(req, createRes(), next);

    expect(next).toHaveBeenCalledWith(insertError);
    expect(claimOcrJobForConfirmation).toHaveBeenCalledWith("user-1", "ocr-ind-fail", "Indian_Market");
    expect(releaseOcrJobClaim).toHaveBeenCalledWith("user-1", "ocr-ind-fail");
    expect(markOcrJobConfirmed).not.toHaveBeenCalled();
  });

  it("allows an Indian edit while dropping protected fields", async () => {
    IndianTrade.findOneAndUpdate.mockResolvedValue({ _id: "ind-1", notes: "allowed" });
    const { updateTrade } = require("../../controllers/indianTradeController");
    const req = createReq({
      notes: "allowed",
      user: "user-2",
      marketType: "Forex",
      createdAt: "2000-01-01",
      updatedAt: "2000-01-01",
      deletedAt: "2000-01-01",
      ocrJobId: "attacker-job",
      subscriptionStatus: "active",
      paymentStatus: "paid",
      tokenVersion: 0,
      role: "admin",
      processedAt: "2000-01-01",
      extractionConfidence: 100,
    });
    req.params = { id: "ind-1" };
    const next = jest.fn();

    await updateTrade(req, createRes(), next);

    expect(next).not.toHaveBeenCalled();
    expect(IndianTrade.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: "ind-1", user: "user-1", deletedAt: null },
      { notes: "allowed" },
      { returnDocument: "after", runValidators: true }
    );
  });

  it("uses the indexed effective date for Indian cursor pagination", async () => {
    const cursor = "2026-06-20T12:00:00.000Z";
    const cursorId = "507f1f77bcf86cd799439012";
    const queryChain = {
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    };
    IndianTrade.find.mockReturnValue(queryChain);
    const { getTrades } = require("../../controllers/indianTradeController");
    const req = {
      query: { cursor, cursorId, limit: "25" },
      user: { _id: "507f1f77bcf86cd799439011" },
    };
    const res = createRes();
    const next = jest.fn();

    await getTrades(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(IndianTrade.find).toHaveBeenCalledWith(expect.objectContaining({
      deletedAt: null,
      $or: [
        { effectiveTradeDate: { $lt: new Date(cursor) } },
        {
          effectiveTradeDate: new Date(cursor),
          _id: { $lt: expect.anything() },
        },
      ],
    }));
    const query = IndianTrade.find.mock.calls[0][0];
    expect(query.user.toString()).toBe("507f1f77bcf86cd799439011");
    expect(query.$or[1]._id.$lt.toString()).toBe(cursorId);
    expect(queryChain.sort).toHaveBeenCalledWith({ effectiveTradeDate: -1, _id: -1 });
    expect(queryChain.limit).toHaveBeenCalledWith(26);
  });
});
