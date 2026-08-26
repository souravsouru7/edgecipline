jest.mock("../../repositories/trade.repository", () => ({
  findForexTradeByUser: jest.fn(),
  updateForexTradeByUser: jest.fn(),
}));

jest.mock("../../services/tradeLifecycle.service", () => ({
  softDeleteTrade: jest.fn(),
}));

jest.mock("../../utils/cache", () => ({
  buildCacheKey: jest.fn((...parts) => parts.join(":")),
  getCache: jest.fn(),
  rememberCache: jest.fn((_key, _ttl, fn) => fn().then((data) => ({ data }))),
}));

jest.mock("../../utils/cacheUtils", () => ({
  TRADE_CACHE_EVENTS: {
    DELETE: "delete",
    EDIT: "edit",
  },
  getTradeCacheVersion: jest.fn().mockResolvedValue(1),
  invalidateTradeCaches: jest.fn(),
}));

jest.mock("../../models/Trade", () => ({
  findOne: jest.fn(),
}));

jest.mock("../../services/smartNotificationEvaluator", () => ({
  evaluateSmartNotifications: jest.fn(),
}));

jest.mock("../../services/missionProgressService", () => ({
  onTradeSaved: jest.fn(),
  onTradeDeleted: jest.fn(),
  onTradeUpdated: jest.fn(),
}));

jest.mock("../../services/streak.service", () => ({
  recordTradeAndRecompute: jest.fn(),
  recordTradeEvent: jest.fn(),
  recomputeStreaks: jest.fn(),
}));

jest.mock("../../services/onboardingService", () => ({
  markTradeLogged: jest.fn(),
}));

jest.mock("../../services/streakNotification.service", () => ({
  handleStreakEvents: jest.fn(),
}));

jest.mock("../../services/ocrJob.service", () => ({
  getOcrConfirmationTrades: jest.fn().mockResolvedValue([]),
  markOcrJobConfirmed: jest.fn(),
}));

jest.mock("../../utils/cloudinaryHelpers", () => ({
  destroyImages: jest.fn(),
}));

jest.mock("../../utils/logger", () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const Trade = require("../../models/Trade");
const tradeRepository = require("../../repositories/trade.repository");
const tradeLifecycleService = require("../../services/tradeLifecycle.service");
const { invalidateTradeCaches } = require("../../utils/cacheUtils");
const { evaluateSmartNotifications } = require("../../services/smartNotificationEvaluator");
const { onTradeSaved, onTradeDeleted } = require("../../services/missionProgressService");
const tradeService = require("../../services/trade.service");

describe("tradeService Forex ownership boundaries", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("denies User B viewing User A's Forex trade without revealing private data", async () => {
    tradeRepository.findForexTradeByUser.mockResolvedValueOnce(null);

    await expect(tradeService.getTrade("user-b", "trade-a"))
      .rejects.toMatchObject({
        statusCode: 404,
        errorCode: "NOT_FOUND",
        message: "Trade not found or unauthorized",
      });

    expect(tradeRepository.findForexTradeByUser).toHaveBeenCalledWith("trade-a", "user-b");
  });

  it("denies User B editing User A's Forex trade and does not run success side effects", async () => {
    Trade.findOne.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    });
    tradeRepository.updateForexTradeByUser.mockResolvedValueOnce(null);

    await expect(tradeService.updateTrade("user-b", "trade-a", {
      pair: "EURUSD",
      type: "BUY",
      entryPrice: 1.1,
      exitPrice: 1.2,
      profit: 100,
    }))
      .rejects.toMatchObject({
        statusCode: 404,
        errorCode: "NOT_FOUND",
        message: "Trade not found or unauthorized",
      });

    expect(Trade.findOne).toHaveBeenCalledWith({ _id: "trade-a", user: "user-b" });
    expect(tradeRepository.updateForexTradeByUser)
      .toHaveBeenCalledWith("trade-a", "user-b", expect.any(Object), expect.any(Object));
    expect(invalidateTradeCaches).not.toHaveBeenCalled();
    expect(evaluateSmartNotifications).not.toHaveBeenCalled();
    expect(onTradeSaved).not.toHaveBeenCalled();
  });

  it("denies User B deleting User A's Forex trade and leaves User A's data untouched", async () => {
    tradeLifecycleService.softDeleteTrade.mockResolvedValueOnce(null);

    await expect(tradeService.deleteTrade("user-b", "trade-a"))
      .rejects.toMatchObject({
        statusCode: 404,
        errorCode: "NOT_FOUND",
        message: "Trade not found or unauthorized",
      });

    expect(tradeLifecycleService.softDeleteTrade).toHaveBeenCalledWith(
      Trade,
      {
        tradeId: "trade-a",
        userId: "user-b",
        deletedBy: "user-b",
        deletedSource: "user",
        marketFilter: { marketType: { $ne: "Indian_Market" } },
        options: { lean: true },
      }
    );
    expect(invalidateTradeCaches).not.toHaveBeenCalled();
    expect(onTradeDeleted).not.toHaveBeenCalled();
  });
});
