/**
 * Legacy ghost-trade safeguards:
 * - findForexTradesByUser still excludes historical multiTradeGhost documents.
 * - OCR review saves create confirmed trades with ocrJobId.
 * - OCR review saves never update/delete a pre-existing draft trade.
 */

jest.mock("../../config", () => ({
  appConfig: {
    ai: { geminiApiKey: null, openaiApiKey: null },
    redis: { url: null },
    cloudinary: {},
    server: { port: 3000, nodeEnv: "test" },
    email: {},
    security: { jwtSecret: "test" },
    features: {},
  },
}));

jest.mock("../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

describe("trade.repository.js - findForexTradesByUser", () => {
  const mockFind = jest.fn();
  const userId = "507f1f77bcf86cd799439011";
  let queryChain;

  beforeEach(() => {
    jest.resetModules();
    jest.mock("../../models/Trade", () => ({
      find: mockFind,
      create: jest.fn(),
    }));
    queryChain = {
      sort: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
    };
    mockFind.mockReturnValue(queryChain);
  });

  it("includes multiTradeGhost: { $ne: true } in the query", async () => {
    const repo = require("../../repositories/trade.repository");
    await repo.findForexTradesByUser(userId);

    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.objectContaining({
          toString: expect.any(Function),
        }),
        marketType: { $ne: "Indian_Market" },
        "parsedData.multiTradeGhost": { $ne: true },
      })
    );
    expect(mockFind.mock.calls[0][0].user.toString()).toBe(userId);
  });

  it("does not surface a ghost-flagged trade", async () => {
    const repo = require("../../repositories/trade.repository");
    const allTrades = [
      { _id: "t1", pair: "GBPUSD", profit: -46.8, parsedData: { multiTradeGhost: true } },
      { _id: "t2", pair: "GBPUSD", profit: -28.2 },
    ];

    mockFind.mockReturnValueOnce({
      sort: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(
        allTrades.filter((trade) => trade.parsedData?.multiTradeGhost !== true)
      ),
    });

    const result = await repo.findForexTradesByUser(userId);
    expect(result).toHaveLength(1);
    expect(result[0]._id).toBe("t2");
    expect(result[0].profit).toBe(-28.2);
  });

  it("uses persisted effectiveTradeDate for indexed filtering and pagination", async () => {
    const repo = require("../../repositories/trade.repository");
    const dateFrom = new Date("2026-06-01T00:00:00.000Z");

    await repo.findForexTradesByUser(userId, { page: 3, limit: 25, dateFrom });

    expect(mockFind).toHaveBeenCalledWith(expect.objectContaining({
      effectiveTradeDate: { $gte: dateFrom },
    }));
    expect(queryChain.sort).toHaveBeenCalledWith({ effectiveTradeDate: -1, _id: -1 });
    expect(queryChain.skip).toHaveBeenCalledWith(50);
    expect(queryChain.limit).toHaveBeenCalledWith(25);
  });
});

describe("saveAllTrades - confirmed trade creation", () => {
  it("saves reviewed trades with the OCR job id and never deletes a ghost trade", async () => {
    const deleteTrade = jest.fn();
    const createTradesBatch = jest.fn().mockResolvedValue({ trades: [{ _id: "new-trade" }] });
    const uploadedJobId = "507f1f77bcf86cd799439011";
    const marketType = "Forex";
    const trades = [
      { pair: "GBPUSDx", type: "SELL", quantity: 0.3, profit: -28.2, tradeDate: "2026-05-11" },
    ];
    const savedTrades = [false];
    const canSaveTrade = (trade) => Boolean(trade?.pair && trade?.profit != null);

    const saveAllTrades = async () => {
      const validTrades = trades.filter((trade, index) => !savedTrades[index] && canSaveTrade(trade));
      if (validTrades.length === 0) return;
      await createTradesBatch({ trades: validTrades, ocrJobId: uploadedJobId }, marketType);
    };

    await saveAllTrades();

    expect(deleteTrade).not.toHaveBeenCalled();
    expect(createTradesBatch).toHaveBeenCalledWith(
      { trades, ocrJobId: uploadedJobId },
      marketType
    );
  });

  it("does nothing when no reviewed trade is saveable", async () => {
    const deleteTrade = jest.fn();
    const createTradesBatch = jest.fn();
    const trades = [
      { pair: "", type: "SELL", quantity: 0.3, profit: null, tradeDate: "2026-05-11" },
    ];
    const savedTrades = [false];
    const canSaveTrade = (trade) => Boolean(trade?.pair && trade?.profit != null);

    const saveAllTrades = async () => {
      const validTrades = trades.filter((trade, index) => !savedTrades[index] && canSaveTrade(trade));
      if (validTrades.length > 0) {
        await createTradesBatch({ trades: validTrades, ocrJobId: "507f1f77bcf86cd799439011" }, "Forex");
      }
    };

    await expect(saveAllTrades()).resolves.not.toThrow();
    expect(deleteTrade).not.toHaveBeenCalled();
    expect(createTradesBatch).not.toHaveBeenCalled();
  });
});

describe("saveTradeMutation - OCR job confirmation", () => {
  const updateTrade = jest.fn();
  const createTrade = jest.fn().mockResolvedValue({ _id: "new-id" });
  const uploadedJobId = "507f1f77bcf86cd799439011";

  const buildPayload = (trade) => ({ pair: trade.pair, profit: trade.profit });

  const runMutation = async ({ trades, trade, idx = null }) => {
    const selectedTrade = idx !== null ? trades[idx] : trade;
    const tradeData = buildPayload(selectedTrade);
    return createTrade({ ...tradeData, ocrJobId: uploadedJobId }, "Forex");
  };

  beforeEach(() => {
    updateTrade.mockClear();
    createTrade.mockClear();
  });

  it("creates a fresh trade when user deleted one OCR result and one remains", async () => {
    const remainingTrade = { pair: "GBPUSDx", profit: -28.2, type: "SELL" };

    await runMutation({
      trades: [remainingTrade],
      trade: remainingTrade,
      idx: null,
    });

    expect(createTrade).toHaveBeenCalledWith({
      pair: "GBPUSDx",
      profit: -28.2,
      ocrJobId: uploadedJobId,
    }, "Forex");
    expect(updateTrade).not.toHaveBeenCalled();
  });

  it("creates fresh docs for both trades in genuine multi-trade mode", async () => {
    const firstTrade = { pair: "GBPUSDx", profit: -46.8, type: "BUY" };
    const secondTrade = { pair: "GBPUSDx", profit: -28.2, type: "SELL" };

    await runMutation({ trades: [firstTrade, secondTrade], trade: firstTrade, idx: 0 });
    await runMutation({ trades: [firstTrade, secondTrade], trade: secondTrade, idx: 1 });

    expect(createTrade).toHaveBeenCalledTimes(2);
    expect(updateTrade).not.toHaveBeenCalled();
  });

  it("creates a fresh trade for a normal single-trade upload", async () => {
    const trade = { pair: "EURUSD", profit: 50, type: "BUY" };

    await runMutation({
      trades: [],
      trade,
      idx: null,
    });

    expect(createTrade).toHaveBeenCalledWith({
      pair: "EURUSD",
      profit: 50,
      ocrJobId: uploadedJobId,
    }, "Forex");
    expect(updateTrade).not.toHaveBeenCalled();
  });
});
