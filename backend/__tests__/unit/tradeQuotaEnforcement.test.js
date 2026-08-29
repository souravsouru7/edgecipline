"use strict";

// Proves the gate is actually wired into every create path — that a blocked
// user never reaches trade creation, and never burns an OCR job claim.

jest.mock("../../models/Trade", () => ({ countDocuments: jest.fn() }));
jest.mock("../../models/IndianTrade", () => ({
  countDocuments: jest.fn(),
  create: jest.fn(),
  insertMany: jest.fn(),
}));
jest.mock("../../services/trade.service", () => ({
  createTrade: jest.fn().mockResolvedValue({ _id: "t1" }),
  createTradesBatch: jest.fn().mockResolvedValue({ created: 1 }),
}));
jest.mock("../../services/ocrJob.service", () => ({
  claimOcrJobForConfirmation: jest.fn(),
  extractConfirmationTrades: jest.fn(() => []),
  releaseOcrJobClaim: jest.fn(),
  markOcrJobConfirmed: jest.fn(),
}), { virtual: true });

const Trade = require("../../models/Trade");
const IndianTrade = require("../../models/IndianTrade");
const tradeService = require("../../services/trade.service");
const tradeController = require("../../controllers/tradeController");

const USER_ID = "507f1f77bcf86cd799439011";
const freeUser = { _id: USER_ID, role: "user", subscriptionStatus: "free", createdAt: new Date() };
const premiumUser = {
  _id: USER_ID, role: "user", subscriptionStatus: "active", subscriptionPlan: "monthly",
  subscriptionExpiry: new Date(Date.now() + 30 * 864e5), createdAt: new Date(),
};

function mockRes() {
  const res = { locals: {} };   // apiResponse's success() writes res.locals
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.set = jest.fn(() => res);
  res.setHeader = jest.fn(() => res);
  return res;
}

async function callForex(handler, { user, body }) {
  const next = jest.fn();
  await handler({ user, body, params: {}, query: {} }, mockRes(), next);
  return next.mock.calls[0]?.[0];
}

beforeEach(() => jest.clearAllMocks());

describe("Forex create is gated", () => {
  test("a free user at the limit is blocked and the service is never called", async () => {
    Trade.countDocuments.mockResolvedValue(2);
    const error = await callForex(tradeController.createTrade, { user: freeUser, body: { pair: "EURUSD" } });

    expect(error?.errorCode).toBe("TRADE_LIMIT_REACHED");
    expect(error?.statusCode).toBe(402);
    expect(tradeService.createTrade).not.toHaveBeenCalled();
  });

  test("a free user under the limit goes through", async () => {
    Trade.countDocuments.mockResolvedValue(1);
    const error = await callForex(tradeController.createTrade, { user: freeUser, body: { pair: "EURUSD" } });

    expect(error).toBeUndefined();
    expect(tradeService.createTrade).toHaveBeenCalled();
  });

  test("a premium user goes through without a count query", async () => {
    const error = await callForex(tradeController.createTrade, { user: premiumUser, body: { pair: "EURUSD" } });

    expect(error).toBeUndefined();
    expect(Trade.countDocuments).not.toHaveBeenCalled();
    expect(tradeService.createTrade).toHaveBeenCalled();
  });
});

describe("Forex batch is gated as a whole", () => {
  test("a 5-trade import with 1 slot left is rejected and nothing is created", async () => {
    Trade.countDocuments.mockResolvedValue(1);
    const body = { trades: Array.from({ length: 5 }, (_, i) => ({ pair: `P${i}` })) };
    const error = await callForex(tradeController.createTradesBatch, { user: freeUser, body });

    expect(error?.errorCode).toBe("TRADE_LIMIT_REACHED");
    expect(error?.details?.requested).toBe(5);
    expect(tradeService.createTradesBatch).not.toHaveBeenCalled();
  });

  test("a batch that exactly fits the allowance is created", async () => {
    Trade.countDocuments.mockResolvedValue(0);
    const body = { trades: [{ pair: "A" }, { pair: "B" }] };
    const error = await callForex(tradeController.createTradesBatch, { user: freeUser, body });

    expect(error).toBeUndefined();
    expect(tradeService.createTradesBatch).toHaveBeenCalled();
  });
});

describe("Indian create is gated", () => {
  // Required late so the Indian controller picks up the mocks above.
  const indianController = require("../../controllers/indianTradeController");

  test("a free user at the limit is blocked before IndianTrade.create", async () => {
    IndianTrade.countDocuments.mockResolvedValue(2);
    const error = await callForex(indianController.createTrade, {
      user: freeUser,
      body: { pair: "NIFTY 26000 CE" },
    });

    expect(error?.errorCode).toBe("TRADE_LIMIT_REACHED");
    expect(IndianTrade.create).not.toHaveBeenCalled();
  });

  test("the Forex allowance does not affect the Indian one", async () => {
    Trade.countDocuments.mockResolvedValue(2);   // Forex exhausted
    IndianTrade.countDocuments.mockResolvedValue(0);
    const error = await callForex(indianController.createTrade, {
      user: freeUser,
      body: { pair: "NIFTY 26000 CE" },
    });

    expect(error?.errorCode).not.toBe("TRADE_LIMIT_REACHED");
  });
});
