const express = require("express");
const request = require("supertest");

const mockUser = {
  _id: "user-123",
  subscriptionStatus: "active",
  subscriptionExpiry: new Date(Date.now() + 86400000),
  freeUploadUsed: false,
};

let mockStoredTrade;

jest.mock("../middleware/authMiddleware", () => ({
  protect: (req, _res, next) => {
    req.user = mockUser;
    next();
  },
}));

jest.mock("../middleware/rateLimiter", () => ({
  uploadRateLimiter: (_req, _res, next) => next(),
  statusRateLimiter: (_req, _res, next) => next(),
}));

jest.mock("../middleware/upload.middleware", () => ({
  uploadTradeImage: (req, _res, next) => {
    req.body = req.body || {};
    req.uploadedImage = {
      imageUrl: "https://cdn.example.com/trade.png",
      publicId: "trades/test-upload",
      originalName: "trade.png",
      mimeType: "image/png",
      bytes: 2048,
    };
    next();
  },
}));

jest.mock("../queues/ocrQueue", () => ({
  enqueueOcrJob: jest.fn().mockResolvedValue({
    id: "ocr-job-1",
    name: "process-trade-image",
    attemptsMade: 0,
  }),
  getOcrJobSnapshot: jest.fn().mockResolvedValue({
    state: "completed",
    attemptsMade: 1,
    failedReason: null,
  }),
}));

jest.mock("../repositories/user.repository", () => ({
  markFreeUploadUsed: jest.fn(),
}));

jest.mock("../utils/cacheUtils", () => ({
  clearUserCache: jest.fn(),
}));

jest.mock("../utils/cache", () => ({
  buildCacheKey: jest.fn((...parts) => parts.join(":")),
  getCache: jest.fn().mockResolvedValue(null),
  rememberCache: jest.fn(async (_key, _ttl, loader) => ({ data: await loader() })),
}));

jest.mock("../utils/logger", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock("../config/cloudinary", () => ({
  uploader: {
    destroy: jest.fn().mockResolvedValue({ result: "ok" }),
  },
}));

jest.mock("../repositories/trade.repository", () => ({
  createTrade: jest.fn(async (data) => {
    mockStoredTrade = {
      ...data,
      _id: "507f1f77bcf86cd799439011",
      createdAt: new Date("2026-05-03T12:00:00.000Z"),
    };
    return mockStoredTrade;
  }),
  updateTradeById: jest.fn(async (_id, update) => {
    mockStoredTrade = { ...mockStoredTrade, ...update };
    return mockStoredTrade;
  }),
  findTradeByIdAndUser: jest.fn(async (tradeId, userId) => {
    if (tradeId !== mockStoredTrade?._id || userId !== mockUser._id) return null;
    return mockStoredTrade;
  }),
  findForexTradesByUser: jest.fn(async (userId) => {
    if (userId !== mockUser._id || mockStoredTrade?.status !== "completed") return [];
    return [mockStoredTrade];
  }),
}));

const uploadRoutes = require("../routes/uploadRoutes");
const tradeRoutes = require("../routes/tradeRoutes");
const { errorHandler } = require("../middleware/errorHandler");

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/api/upload", uploadRoutes);
  app.use("/api/trades", tradeRoutes);
  app.use(errorHandler);
  return app;
};

describe("upload image to journal flow", () => {
  beforeEach(() => {
    mockStoredTrade = null;
    jest.clearAllMocks();
  });

  it("uploads an image, exposes completed parsed data, and shows it in the journal list", async () => {
    const app = buildApp();

    const uploadRes = await request(app)
      .post("/api/upload")
      .set("Authorization", "Bearer test-token")
      .field("marketType", "Forex");

    expect(uploadRes.status).toBe(202);
    expect(uploadRes.body).toEqual({
      success: true,
      jobId: "507f1f77bcf86cd799439011",
      status: "processing",
    });

    mockStoredTrade = {
      ...mockStoredTrade,
      status: "completed",
      pair: "EURUSD",
      type: "BUY",
      entryPrice: 1.085,
      exitPrice: 1.092,
      profit: 70,
      lotSize: 0.1,
      strategy: "Breakout",
      session: "London",
      extractionConfidence: 0.94,
      needsReview: false,
      processedAt: new Date("2026-05-03T12:01:00.000Z"),
    };

    const statusRes = await request(app)
      .get("/api/upload/job-status/507f1f77bcf86cd799439011")
      .set("Authorization", "Bearer test-token");

    expect(statusRes.status).toBe(200);
    expect(statusRes.body).toMatchObject({
      status: "completed",
      data: {
        pair: "EURUSD",
        type: "BUY",
        profit: 70,
        imageUrl: "https://cdn.example.com/trade.png",
      },
    });

    const journalRes = await request(app)
      .get("/api/trades")
      .set("Authorization", "Bearer test-token");

    expect(journalRes.status).toBe(200);
    expect(journalRes.body).toHaveLength(1);
    expect(journalRes.body[0]).toMatchObject({
      pair: "EURUSD",
      symbol: "EURUSD",
      type: "BUY",
      pnl: 70,
      status: "completed",
      imageUrl: "https://cdn.example.com/trade.png",
    });
  });
});
