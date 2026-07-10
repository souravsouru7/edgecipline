"use strict";

jest.mock("../../controllers/razorpayWebhookController", () => ({
  handleRazorpayWebhook: jest.fn(),
}));

jest.mock("../../admin/controllers/adminPaymentController", () => ({
  getAllPayments: jest.fn(),
  updatePaymentStatus: jest.fn(),
  addManualPayment: jest.fn(),
}));

jest.mock("../../admin/controllers/adminTradeController", () => ({
  getAllTrades: jest.fn(),
  getExtractionLogs: jest.fn(),
  getTradeDebug: jest.fn(),
}));

jest.mock("../../controllers/tradeController", () => ({
  createTrade: jest.fn(),
  createTradesBatch: jest.fn(),
  getTrades: jest.fn(),
  getTrade: jest.fn(),
  getTradeStatus: jest.fn(),
  updateTrade: jest.fn(),
  deleteTrade: jest.fn(),
  restoreTrade: jest.fn(),
}));

const {
  adminFinancialRateLimiter,
  webhookRateLimiter,
} = require("../../middleware/rateLimiter");
const { adminAuth } = require("../../middleware/adminAuth");
const webhookRoutes = require("../../routes/razorpayWebhookRoutes");
const adminPaymentRoutes = require("../../admin/routes/adminPaymentRoutes");
const adminTradeRoutes = require("../../admin/routes/adminTradeRoutes");
const userTradeRoutes = require("../../routes/tradeRoutes");

function handlersFor(router, method, path) {
  const layer = router.stack.find((item) =>
    item.route?.path === path && item.route?.methods?.[method]
  );
  return layer?.route?.stack.map((item) => item.handle) || [];
}

describe("security-sensitive route middleware", () => {
  test("Razorpay webhook is rate limited", () => {
    expect(handlersFor(webhookRoutes, "post", "/")).toContain(webhookRateLimiter);
  });

  test.each([
    ["patch", "/:id/status"],
    ["post", "/manual"],
  ])("admin payment %s %s is rate limited", (method, path) => {
    expect(handlersFor(adminPaymentRoutes, method, path))
      .toContain(adminFinancialRateLimiter);
  });

  test("trade debug exists only under the admin-authenticated router", () => {
    expect(handlersFor(userTradeRoutes, "get", "/debug")).toEqual([]);
    expect(handlersFor(adminTradeRoutes, "get", "/debug")).toContain(adminAuth);
  });
});
