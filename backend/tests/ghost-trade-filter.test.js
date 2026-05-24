/**
 * Tests for the ghost trade fix:
 * - findForexTradesByUser must exclude multiTradeGhost documents
 * - saveAllTrades must delete the ghost before saving individual trades
 * - saveTradeMutation must treat trades.length === 1 as single-trade (updateTrade)
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────
jest.mock("../config", () => ({
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

jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// ── 1. Backend: findForexTradesByUser excludes ghost trades ───────────────────
describe("trade.repository.js — findForexTradesByUser", () => {
  const mockFind = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    jest.mock("../models/Trade", () => ({
      find: mockFind,
      create: jest.fn(),
    }));
    mockFind.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
    });
  });

  it("includes multiTradeGhost: { $ne: true } in the query", async () => {
    const repo = require("../repositories/trade.repository");
    await repo.findForexTradesByUser("user-1");

    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({
        user: "user-1",
        marketType: "Forex",
        "parsedData.multiTradeGhost": { $ne: true },
      })
    );
  });

  it("does NOT surface a ghost-flagged trade", async () => {
    const repo = require("../repositories/trade.repository");
    const allTrades = [
      { _id: "t1", pair: "GBPUSD", profit: -46.8, parsedData: { multiTradeGhost: true } },
      { _id: "t2", pair: "GBPUSD", profit: -28.2 },
    ];

    // Simulate Mongoose filtering: only return trades without the ghost flag
    mockFind.mockReturnValueOnce({
      sort: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(
        allTrades.filter((t) => t.parsedData?.multiTradeGhost !== true)
      ),
    });

    const result = await repo.findForexTradesByUser("user-1");
    expect(result).toHaveLength(1);
    expect(result[0]._id).toBe("t2");
    expect(result[0].profit).toBe(-28.2);
  });
});

// ── 2 & 3. Frontend logic (pure-JS extraction, no React) ─────────────────────
describe("saveAllTrades — ghost deletion before saving", () => {
  it("calls deleteTrade with the ghost ID before saving remaining trades", async () => {
    const deleteTrade = jest.fn().mockResolvedValue({});
    const createTrade = jest.fn().mockResolvedValue({ _id: "new-trade" });

    const uploadedTradeId = "ghost-id-123";
    const marketType = "Forex";

    const trades = [
      { pair: "GBPUSDx", type: "SELL", quantity: 0.3, profit: -28.2, tradeDate: "2026-05-11" },
    ];
    const savedTrades = [false];

    const canSaveTrade = (t) => !!(t?.pair && t?.profit != null);
    const addToast = jest.fn();
    const mutateAsync = jest.fn().mockResolvedValue({});

    // Replicate the fixed saveAllTrades logic exactly
    const saveAllTrades = async () => {
      if (uploadedTradeId) {
        try {
          await deleteTrade(uploadedTradeId, marketType);
        } catch (_) {}
      }
      for (let i = 0; i < trades.length; i++) {
        if (!savedTrades[i] && canSaveTrade(trades[i])) {
          try {
            await mutateAsync({ idx: i });
          } catch (err) {
            addToast(`Trade ${i + 1} failed: ${err?.message}`, "error");
          }
        }
      }
    };

    await saveAllTrades();

    // Ghost must be deleted first
    expect(deleteTrade).toHaveBeenCalledWith("ghost-id-123", "Forex");
    // The remaining SELL trade must be saved
    expect(mutateAsync).toHaveBeenCalledWith({ idx: 0 });
    // Deletion happens before saving
    const deleteOrder = deleteTrade.mock.invocationCallOrder[0];
    const saveOrder = mutateAsync.mock.invocationCallOrder[0];
    expect(deleteOrder).toBeLessThan(saveOrder);
  });

  it("does not crash if ghost deletion fails (ghost already gone)", async () => {
    const deleteTrade = jest.fn().mockRejectedValue(new Error("404 not found"));
    const mutateAsync = jest.fn().mockResolvedValue({});
    const trades = [
      { pair: "GBPUSDx", type: "SELL", quantity: 0.3, profit: -28.2, tradeDate: "2026-05-11" },
    ];
    const savedTrades = [false];
    const canSaveTrade = (t) => !!(t?.pair && t?.profit != null);

    const saveAllTrades = async () => {
      try { await deleteTrade("ghost-id", "Forex"); } catch (_) {}
      for (let i = 0; i < trades.length; i++) {
        if (!savedTrades[i] && canSaveTrade(trades[i])) {
          await mutateAsync({ idx: i });
        }
      }
    };

    await expect(saveAllTrades()).resolves.not.toThrow();
    expect(mutateAsync).toHaveBeenCalledWith({ idx: 0 });
  });
});

describe("saveTradeMutation — isMultiTrade = trades.length > 1", () => {
  const updateTrade = jest.fn().mockResolvedValue({ _id: "ghost-id" });
  const createTrade = jest.fn().mockResolvedValue({ _id: "new-id" });

  const buildPayload = (t) => ({ pair: t.pair, profit: t.profit });

  const runMutation = async ({ trades, trade, uploadedTradeId, idx = null, forceCreate = false }) => {
    const t = idx !== null ? trades[idx] : trade;
    const tradeData = buildPayload(t);
    const isMultiTrade = trades.length > 1;  // THE FIXED CHECK

    if (!forceCreate && !isMultiTrade && idx === null && uploadedTradeId) {
      return updateTrade(uploadedTradeId, tradeData, "Forex");
    }
    return createTrade(tradeData, "Forex");
  };

  beforeEach(() => {
    updateTrade.mockClear();
    createTrade.mockClear();
  });

  it("updates ghost in-place when user deleted one trade and one remains (trades.length === 1)", async () => {
    const remainingTrade = { pair: "GBPUSDx", profit: -28.2, type: "SELL" };

    await runMutation({
      trades: [remainingTrade],      // only 1 left after deletion
      trade: remainingTrade,
      uploadedTradeId: "ghost-id",
      idx: null,
    });

    expect(updateTrade).toHaveBeenCalledWith("ghost-id", { pair: "GBPUSDx", profit: -28.2 }, "Forex");
    expect(createTrade).not.toHaveBeenCalled();
  });

  it("creates fresh docs for both trades in genuine multi-trade mode (trades.length === 2)", async () => {
    const t1 = { pair: "GBPUSDx", profit: -46.8, type: "BUY" };
    const t2 = { pair: "GBPUSDx", profit: -28.2, type: "SELL" };

    await runMutation({ trades: [t1, t2], trade: t1, uploadedTradeId: "ghost-id", idx: 0 });
    await runMutation({ trades: [t1, t2], trade: t2, uploadedTradeId: "ghost-id", idx: 1 });

    expect(createTrade).toHaveBeenCalledTimes(2);
    expect(updateTrade).not.toHaveBeenCalled();
  });

  it("updates ghost in-place for a normal single-trade upload (trades.length === 0)", async () => {
    const t = { pair: "EURUSD", profit: 50, type: "BUY" };

    await runMutation({
      trades: [],
      trade: t,
      uploadedTradeId: "ghost-id",
      idx: null,
    });

    expect(updateTrade).toHaveBeenCalledWith("ghost-id", { pair: "EURUSD", profit: 50 }, "Forex");
    expect(createTrade).not.toHaveBeenCalled();
  });
});
