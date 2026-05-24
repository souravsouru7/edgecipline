const express = require("express");
const request = require("supertest");

const mockUser = {
  _id: "user-123",
  subscriptionStatus: "active",
  subscriptionExpiry: new Date(Date.now() + 86400000),
  freeUploadUsed: false,
};

let mockStoredUploadTrade;
let mockIndianTrades;

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
      imageUrl: "https://cdn.example.com/indian-trade.png",
      publicId: "trades/indian-test-upload",
      originalName: "indian-trade.png",
      mimeType: "image/png",
      bytes: 2048,
    };
    next();
  },
}));

jest.mock("../queues/ocrQueue", () => ({
  enqueueOcrJob: jest.fn().mockResolvedValue({
    id: "indian-ocr-job-1",
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
  setCache: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../config/redis", () => ({
  isRedisReady: jest.fn(() => false),
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
    mockStoredUploadTrade = {
      ...data,
      _id: "507f1f77bcf86cd799439022",
      createdAt: new Date("2026-05-03T12:00:00.000Z"),
    };
    return mockStoredUploadTrade;
  }),
  updateTradeById: jest.fn(async (_id, update) => {
    mockStoredUploadTrade = { ...mockStoredUploadTrade, ...update };
    return mockStoredUploadTrade;
  }),
  findTradeByIdAndUser: jest.fn(async (tradeId, userId) => {
    if (tradeId !== mockStoredUploadTrade?._id || userId !== mockUser._id) return null;
    return mockStoredUploadTrade;
  }),
}));

jest.mock("../models/IndianTrade", () => ({
  create: jest.fn(async (data) => {
    const trade = {
      ...data,
      _id: "507f1f77bcf86cd799439033",
      createdAt: new Date("2026-05-03T12:02:00.000Z"),
    };
    mockIndianTrades.push(trade);
    return trade;
  }),
  find: jest.fn(() => ({
    select: jest.fn(() => ({
      sort: jest.fn(() => ({
        lean: jest.fn().mockResolvedValue(mockIndianTrades),
      })),
    })),
  })),
}));

const uploadRoutes = require("../routes/uploadRoutes");
const indianMarketRoutes = require("../routes/indianMarketRoutes");
const { errorHandler } = require("../middleware/errorHandler");

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/api/upload", uploadRoutes);
  app.use("/api/indian/trades", indianMarketRoutes);
  app.use(errorHandler);
  return app;
};

describe("Indian market upload to journal flow", () => {
  beforeEach(() => {
    mockStoredUploadTrade = null;
    mockIndianTrades = [];
    jest.clearAllMocks();
  });

  it("uploads an Indian image, saves reviewed data, and shows it in the Indian journal list", async () => {
    const app = buildApp();

    const uploadRes = await request(app)
      .post("/api/upload")
      .set("Authorization", "Bearer test-token")
      .field("marketType", "Indian_Market")
      .field("tradeSubType", "OPTION");

    expect(uploadRes.status).toBe(202);

    mockStoredUploadTrade = {
      ...mockStoredUploadTrade,
      status: "completed",
      pair: "NIFTY 26000 CE",
      underlying: "NIFTY",
      type: "BUY",
      optionType: "CE",
      entryPrice: 120,
      exitPrice: 150,
      profit: 2250,
      marketType: "Indian_Market",
      tradeSubType: "OPTION",
      processedAt: new Date("2026-05-03T12:01:00.000Z"),
    };

    const statusRes = await request(app)
      .get("/api/upload/job-status/507f1f77bcf86cd799439022")
      .set("Authorization", "Bearer test-token");

    expect(statusRes.status).toBe(200);
    expect(statusRes.body).toMatchObject({
      status: "completed",
      data: {
        pair: "NIFTY 26000 CE",
        marketType: "Indian_Market",
        profit: 2250,
      },
    });

    const saveRes = await request(app)
      .post("/api/indian/trades")
      .set("Authorization", "Bearer test-token")
      .send({
        pair: "NIFTY 26000 CE",
        type: "BUY",
        underlying: "NIFTY",
        optionType: "CE",
        quantity: 75,
        strikePrice: 26000,
        entryPrice: 120,
        exitPrice: 150,
        profit: 2250,
        tradeDate: "2026-05-03",
        screenshot: "https://cdn.example.com/indian-trade.png",
      });

    expect(saveRes.status).toBe(201);

    const journalRes = await request(app)
      .get("/api/indian/trades")
      .set("Authorization", "Bearer test-token");

    expect(journalRes.status).toBe(200);
    expect(journalRes.body).toHaveLength(1);
    expect(journalRes.body[0]).toMatchObject({
      pair: "NIFTY 26000 CE",
      type: "BUY",
      optionType: "CE",
      profit: 2250,
      screenshot: "https://cdn.example.com/indian-trade.png",
    });
  });
});
