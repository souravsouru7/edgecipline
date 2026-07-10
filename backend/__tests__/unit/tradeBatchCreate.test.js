jest.mock("../../repositories/trade.repository", () => ({
  createTrades: jest.fn(),
  updateForexTradeByUser: jest.fn(),
}));

jest.mock("../../utils/cacheUtils", () => ({
  TRADE_CACHE_EVENTS: {
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
  markOcrJobConfirmed: jest.fn(),
}));

jest.mock("../../utils/cache", () => ({
  buildCacheKey: jest.fn((...parts) => parts.join(":")),
  getCache: jest.fn(),
  rememberCache: jest.fn(),
}));

jest.mock("../../models/Trade", () => ({}));

const tradeRepository = require("../../repositories/trade.repository");
const { invalidateTradeCaches } = require("../../utils/cacheUtils");
const { evaluateSmartNotifications } = require("../../services/smartNotificationEvaluator");
const { markOcrJobConfirmed } = require("../../services/ocrJob.service");
const tradeService = require("../../services/trade.service");

describe("tradeService.createTradesBatch", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  it("rejects empty batches before touching the database", async () => {
    await expect(
      tradeService.createTradesBatch("user-1", { trades: [] })
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(tradeRepository.createTrades).not.toHaveBeenCalled();
    expect(invalidateTradeCaches).not.toHaveBeenCalled();
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
