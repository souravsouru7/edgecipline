jest.mock("../../repositories/trade.repository", () => ({
  createTrade: jest.fn(),
  createTrades: jest.fn(),
  updateForexTradeByUser: jest.fn(),
}));

jest.mock("../../utils/cacheUtils", () => ({
  TRADE_CACHE_EVENTS: {
    CREATE: "create",
    BULK_IMPORT: "bulk_import",
    OCR_SAVE: "ocr_save",
    EDIT: "edit",
  },
  getTradeCacheVersion: jest.fn(),
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

jest.mock("../../utils/cache", () => ({
  buildCacheKey: jest.fn((...parts) => parts.join(":")),
  getCache: jest.fn(),
  rememberCache: jest.fn(),
}));

jest.mock("../../models/Trade", () => ({
  findOne: jest.fn(),
}));

const tradeRepository = require("../../repositories/trade.repository");
const Trade = require("../../models/Trade");
const { invalidateTradeCaches } = require("../../utils/cacheUtils");
const { evaluateSmartNotifications } = require("../../services/smartNotificationEvaluator");
const {
  getOcrConfirmationTrades,
  claimOcrJobForConfirmation,
  releaseOcrJobClaim,
  markOcrJobConfirmed,
} = require("../../services/ocrJob.service");
const tradeService = require("../../services/trade.service");

function noDuplicateTrade() {
  Trade.findOne.mockReturnValue({
    sort: jest.fn().mockResolvedValue(null),
  });
}

describe("tradeService.createTrade", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    noDuplicateTrade();
    tradeRepository.createTrade.mockImplementation(async (doc) => ({ _id: "trade-1", ...doc }));
  });

  it("saves a manual Forex trade only when P&L can be derived from positive price and size fields", async () => {
    const trade = await tradeService.createTrade("user-1", {
      pair: "EURUSD",
      type: "BUY",
      tradeDate: "2026-06-01",
      entryPrice: 1.1,
      exitPrice: 1.101,
      lotSize: 0.1,
    }, { accountCreatedAt: new Date("2026-01-01T00:00:00.000Z") });

    expect(tradeRepository.createTrade).toHaveBeenCalledWith(expect.objectContaining({
      user: "user-1",
      pair: "EURUSD",
      type: "BUY",
      entryPrice: 1.1,
      exitPrice: 1.101,
      lotSize: 0.1,
      profit: 10,
      status: "completed",
      error: null,
    }));
    expect(trade.profit).toBe(10);
  });

  it("rejects a manual Forex trade with a missing exit price instead of saving a misleading completed trade", async () => {
    await expect(tradeService.createTrade("user-1", {
      pair: "EURUSD",
      type: "BUY",
      tradeDate: "2026-06-01",
      entryPrice: 1.1,
      lotSize: 0.1,
    }, { accountCreatedAt: new Date("2026-01-01T00:00:00.000Z") }))
      .rejects.toMatchObject({
        statusCode: 400,
        errorCode: "VALIDATION_ERROR",
        message: "Exit price is required",
      });

    expect(tradeRepository.createTrade).not.toHaveBeenCalled();
  });

  it("rejects manual Forex instruments whose P&L cannot be derived safely", async () => {
    await expect(tradeService.createTrade("user-1", {
      pair: "EURJPY",
      type: "BUY",
      tradeDate: "2026-06-01",
      entryPrice: 160,
      exitPrice: 161,
      lotSize: 0.1,
    }, { accountCreatedAt: new Date("2026-01-01T00:00:00.000Z") }))
      .rejects.toMatchObject({
        statusCode: 400,
        errorCode: "VALIDATION_ERROR",
        message: "P&L cannot be derived for this Forex instrument",
      });

    expect(tradeRepository.createTrade).not.toHaveBeenCalled();
  });

  it("deduplicates a retry of the same manual Forex trade", async () => {
    let existing = null;
    Trade.findOne.mockReturnValue({
      sort: jest.fn().mockImplementation(async () => existing),
    });
    tradeRepository.createTrade.mockImplementation(async (doc) => {
      existing = { _id: "trade-1", createdAt: new Date(), ...doc };
      return existing;
    });
    const payload = {
      pair: "EURUSD",
      type: "BUY",
      tradeDate: "2026-06-01",
      entryPrice: 1.1,
      exitPrice: 1.101,
      lotSize: 0.1,
    };

    const first = await tradeService.createTrade("user-1", payload, {
      accountCreatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const second = await tradeService.createTrade("user-1", payload, {
      accountCreatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(tradeRepository.createTrade).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });
});

describe("tradeService.createTradesBatch", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getOcrConfirmationTrades.mockResolvedValue([]);
    // claimOcrJobForConfirmation is the new atomic gate that replaced a plain
    // getOcrConfirmationTrades() read in the service -- delegate to whatever
    // each test configures getOcrConfirmationTrades to resolve, so existing
    // test bodies below don't need to change.
    claimOcrJobForConfirmation.mockImplementation(async () => ({
      extractedData: { parsedTrades: await getOcrConfirmationTrades() },
    }));
  });

  it("creates all OCR trades in one repository call and invalidates caches once", async () => {
    tradeRepository.createTrades.mockResolvedValue([
      { _id: "trade-1", pair: "EURUSD" },
      { _id: "trade-2", pair: "GBPUSD" },
      { _id: "trade-3", pair: "USDJPY" },
    ]);

    const result = await tradeService.createTradesBatch(
      "user-1",
      {
        ocrJobId: "ocr-1",
        trades: [
          { pair: "EURUSD", type: "BUY", tradeDate: "2026-06-01", entryPrice: 1, exitPrice: 2, profit: 10 },
          { pair: "GBPUSD", type: "SELL", tradeDate: "2026-06-02", entryPrice: 2, exitPrice: 1, profit: 5 },
          { pair: "USDJPY", type: "BUY", tradeDate: "2026-06-03", entryPrice: 3, exitPrice: 4, profit: 8 },
        ],
      },
      { accountCreatedAt: new Date("2026-01-01T00:00:00.000Z") }
    );

    expect(result).toMatchObject({ success: true, count: 3 });
    expect(tradeRepository.createTrades).toHaveBeenCalledTimes(1);
    expect(tradeRepository.createTrades.mock.calls[0][0]).toHaveLength(3);
    expect(invalidateTradeCaches).toHaveBeenCalledTimes(1);
    expect(invalidateTradeCaches).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      event: "ocr_save",
      market: "Forex",
      count: 3,
      source: "ocr_batch_confirm",
    }));
    expect(evaluateSmartNotifications).toHaveBeenCalledTimes(1);
    expect(evaluateSmartNotifications).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      trade: { _id: "trade-3", pair: "USDJPY" },
      marketType: "Forex",
      collection: "forex",
    }));
    expect(markOcrJobConfirmed).toHaveBeenCalledTimes(1);
    expect(markOcrJobConfirmed).toHaveBeenCalledWith("user-1", "ocr-1", {
      tradeId: "trade-1",
      collection: "forex",
    });
  });

  it("releases the OCR job claim if batch trade creation fails after a successful claim", async () => {
    const createError = new Error("createTrades failed");
    tradeRepository.createTrades.mockRejectedValue(createError);

    await expect(tradeService.createTradesBatch(
      "user-1",
      {
        ocrJobId: "ocr-fail-1",
        trades: [{ pair: "EURUSD", type: "BUY", tradeDate: "2026-06-01", entryPrice: 1, exitPrice: 2, profit: 10 }],
      },
      { accountCreatedAt: new Date("2026-01-01T00:00:00.000Z") }
    )).rejects.toThrow("createTrades failed");

    expect(claimOcrJobForConfirmation).toHaveBeenCalledWith("user-1", "ocr-fail-1", "Forex");
    expect(releaseOcrJobClaim).toHaveBeenCalledWith("user-1", "ocr-fail-1");
    expect(markOcrJobConfirmed).not.toHaveBeenCalled();
  });

  it("rejects empty batches before touching the database", async () => {
    await expect(
      tradeService.createTradesBatch("user-1", { trades: [] })
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(tradeRepository.createTrades).not.toHaveBeenCalled();
    expect(invalidateTradeCaches).not.toHaveBeenCalled();
  });

  it("rejects a non-OCR Forex batch trade with a missing exit price", async () => {
    await expect(tradeService.createTradesBatch(
      "user-1",
      {
        trades: [{
          pair: "EURUSD",
          type: "BUY",
          tradeDate: "2026-06-01",
          entryPrice: 1.1,
          lotSize: 0.1,
        }],
      },
      { accountCreatedAt: new Date("2026-01-01T00:00:00.000Z") }
    )).rejects.toMatchObject({
      statusCode: 400,
      errorCode: "VALIDATION_ERROR",
      message: "Exit price is required",
    });

    expect(tradeRepository.createTrades).not.toHaveBeenCalled();
  });

  it("rejects a non-OCR Forex batch trade whose P&L cannot be derived safely", async () => {
    await expect(tradeService.createTradesBatch(
      "user-1",
      {
        trades: [{
          pair: "EURJPY",
          type: "BUY",
          tradeDate: "2026-06-01",
          entryPrice: 160,
          exitPrice: 161,
          lotSize: 0.1,
        }],
      },
      { accountCreatedAt: new Date("2026-01-01T00:00:00.000Z") }
    )).rejects.toMatchObject({
      statusCode: 400,
      errorCode: "VALIDATION_ERROR",
      message: "P&L cannot be derived for this Forex instrument",
    });

    expect(tradeRepository.createTrades).not.toHaveBeenCalled();
  });

  it("strips protected fields from OCR-confirmed batch trades", async () => {
    tradeRepository.createTrades.mockImplementation(async (docs) =>
      docs.map((doc, index) => ({ ...doc, _id: `trade-${index + 1}` }))
    );

    await tradeService.createTradesBatch("user-1", {
      ocrJobId: "ocr-1",
      trades: [{
        pair: "EURUSD",
        type: "BUY",
        tradeDate: "2026-06-01",
        notes: "allowed",
        user: "attacker-user",
        marketType: "Indian_Market",
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
    }, { accountCreatedAt: new Date("2026-01-01") });

    const [doc] = tradeRepository.createTrades.mock.calls[0][0];
    expect(doc).toEqual(expect.objectContaining({
      user: "user-1",
      pair: "EURUSD",
      notes: "allowed",
      status: "completed",
      processedAt: expect.any(Date),
    }));
    expect(doc).not.toHaveProperty("marketType");
    expect(doc).not.toHaveProperty("createdAt");
    expect(doc).not.toHaveProperty("updatedAt");
    expect(doc).not.toHaveProperty("deletedAt");
    expect(doc).not.toHaveProperty("ocrJobId");
    expect(doc).not.toHaveProperty("role");
    expect(doc).not.toHaveProperty("extractionConfidence");
  });

  it("uses broker OCR P&L for index CFDs instead of deriving with Forex contract size", async () => {
    getOcrConfirmationTrades.mockResolvedValueOnce([
      { pair: "NAS100.x", type: "BUY", profit: -50.78 },
    ]);
    tradeRepository.createTrades.mockImplementation(async (docs) =>
      docs.map((doc, index) => ({ ...doc, _id: `trade-${index + 1}` }))
    );

    await tradeService.createTradesBatch("user-1", {
      ocrJobId: "ocr-1",
      trades: [{
        pair: "NAS100.x",
        type: "BUY",
        tradeDate: "2026-07-20",
        entryPrice: 28663.62,
        exitPrice: 28612.84,
        lotSize: 0.1,
        profit: -50.78,
      }],
    }, { accountCreatedAt: new Date("2026-01-01") });

    const [doc] = tradeRepository.createTrades.mock.calls[0][0];
    expect(doc.profit).toBe(-50.78);
  });

  it("allows a Forex edit but never forwards protected fields", async () => {
    tradeRepository.updateForexTradeByUser.mockResolvedValue({ _id: "trade-1", notes: "allowed" });

    await tradeService.updateTrade("user-1", "trade-1", {
      notes: "allowed",
      user: "user-2",
      marketType: "Indian_Market",
      createdAt: "2000-01-01",
      deletedAt: "2000-01-01",
      ocrJobId: "attacker-job",
      processedAt: "2000-01-01",
      extractionConfidence: 100,
      role: "admin",
      tokenVersion: 0,
    });

    expect(tradeRepository.updateForexTradeByUser).toHaveBeenCalledWith(
      "trade-1",
      "user-1",
      { notes: "allowed" }
    );
  });

  it("rejects a Forex update containing only protected fields", async () => {
    await expect(tradeService.updateTrade("user-1", "trade-1", {
      user: "user-2",
      role: "admin",
      processedAt: "2000-01-01",
    })).rejects.toMatchObject({ statusCode: 400 });

    expect(tradeRepository.updateForexTradeByUser).not.toHaveBeenCalled();
  });
});
