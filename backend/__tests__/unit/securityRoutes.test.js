"use strict";

jest.mock("../../controllers/razorpayWebhookController", () => ({
  handleRazorpayWebhook: jest.fn(),
}));

jest.mock("../../admin/controllers/adminPaymentController", () => ({
  getAllPayments: jest.fn(),
  updatePaymentStatus: jest.fn(),
  addManualPayment: jest.fn(),
}));

jest.mock("../../controllers/feedbackController", () => ({
  getAllFeedback: jest.fn(),
  updateFeedbackStatus: jest.fn(),
  deleteFeedback: jest.fn(),
}));

jest.mock("../../admin/controllers/adminTradeController", () => ({
  getAllTrades: jest.fn(),
  getExtractionLogs: jest.fn(),
  getTradeDebug: jest.fn(),
}));

jest.mock("../../controllers/tradeController", () => ({
  // Route registration throws "handler must be a function" if any export the
  // router references is missing from this mock.
  getTradeQuota: jest.fn(),
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
const adminFeedbackRoutes = require("../../admin/routes/adminFeedbackRoutes");
const adminTradeRoutes = require("../../admin/routes/adminTradeRoutes");
const userTradeRoutes = require("../../routes/tradeRoutes");
const weeklyReportRoutes = require("../../routes/weeklyReportRoutes");

function handlersFor(router, method, path) {
  const layer = router.stack.find((item) =>
    item.route?.path === path && item.route?.methods?.[method]
  );
  return layer?.route?.stack.map((item) => item.handle) || [];
}

function expectInvalidId(handler) {
  const next = jest.fn();
  handler({ params: { id: "not-an-object-id" } }, {}, next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({
    statusCode: 400,
    errorCode: "INVALID_ID",
  }));
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

  test.each([
    ["patch", "/:id/status"],
  ])("admin payment %s %s validates malformed ObjectIds", (method, path) => {
    expectInvalidId(handlersFor(adminPaymentRoutes, method, path)[2]);
  });

  test.each([
    ["get", "/"],
    ["patch", "/:id"],
    ["delete", "/:id"],
  ])("admin feedback %s %s is admin-authenticated", (method, path) => {
    expect(handlersFor(adminFeedbackRoutes, method, path)).toContain(adminAuth);
  });

  test.each([
    ["patch", "/:id"],
    ["delete", "/:id"],
  ])("admin feedback %s %s validates malformed ObjectIds", (method, path) => {
    expectInvalidId(handlersFor(adminFeedbackRoutes, method, path)[1]);
  });

  test("weekly report detail validates malformed ObjectIds before controller access", () => {
    expectInvalidId(handlersFor(weeklyReportRoutes, "get", "/weekly/:id")[1]);
  });

  test("trade debug exists only under the admin-authenticated router", () => {
    expect(handlersFor(userTradeRoutes, "get", "/debug")).toEqual([]);
    expect(handlersFor(adminTradeRoutes, "get", "/debug")).toContain(adminAuth);
  });
});
