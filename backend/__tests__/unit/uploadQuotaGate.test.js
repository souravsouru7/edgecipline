"use strict";

// The upload screen used to run on a second, unrelated counter: a one-shot
// `User.freeUploadUsed` boolean, global across markets, while the quota pill on
// the very same screen rendered the per-market FREE_TRADE_LIMIT. The two
// disagreed in both directions. These tests pin the surviving rule: AI upload
// and manual entry share one per-market allowance.

jest.mock("../../models/Trade", () => ({ countDocuments: jest.fn() }));
jest.mock("../../models/IndianTrade", () => ({ countDocuments: jest.fn() }));

jest.mock("../../models/OCRJob", () => ({
  OCRJob: {
    findOne: jest.fn(() => ({
      sort: () => ({ select: () => ({ lean: async () => null }) }),
    })),
  },
}));

jest.mock("../../services/ocrJob.service", () => ({
  cancelOcrJob: jest.fn(),
  createOcrJob: jest.fn(async () => ({ jobId: "507f1f77bcf86cd799439011" })),
  getOcrJobStatus: jest.fn(),
}));

jest.mock("../../services/freeTierFunnelService", () => ({
  recordBlocked: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../config/cloudinary", () => ({
  uploader: { destroy: jest.fn().mockResolvedValue({ result: "ok" }) },
}));

jest.mock("../../queues/ocrQueue", () => ({
  ocrQueue: { add: jest.fn(), getJob: jest.fn(), getJobCounts: jest.fn() },
}));

jest.mock("../../config/redis", () => ({ isRedisReady: jest.fn(() => true) }));

jest.mock("../../utils/logger", () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const Trade = require("../../models/Trade");
const IndianTrade = require("../../models/IndianTrade");
const ocrJobService = require("../../services/ocrJob.service");
const uploadService = require("../../services/upload.service");

const freeUser = () => ({
  _id: "507f1f77bcf86cd799439012",
  role: "user",
  subscriptionStatus: "free",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
});

const uploadedImage = {
  imageUrl: "https://cdn.example.com/trade.png",
  publicId: "trades/test-upload",
  originalName: "trade.png",
  mimeType: "image/png",
  bytes: 2048,
};

const submit = (marketType) =>
  uploadService.submitTradeUpload({
    user: freeUser(),
    body: { marketType },
    query: {},
    uploadedImage,
    file: null,
  });

beforeEach(() => {
  jest.clearAllMocks();
  Trade.countDocuments.mockResolvedValue(0);
  IndianTrade.countDocuments.mockResolvedValue(0);
});

describe("upload is gated by the per-market trade quota", () => {
  it("lets a free user with 1 of 2 Forex trades used upload a screenshot", async () => {
    Trade.countDocuments.mockResolvedValue(1);

    await expect(submit("Forex")).resolves.toMatchObject({
      success: true,
      status: "PENDING",
    });
    expect(ocrJobService.createOcrJob).toHaveBeenCalledTimes(1);
  });

  it("refuses the same user at 2 of 2 with 402 TRADE_LIMIT_REACHED", async () => {
    Trade.countDocuments.mockResolvedValue(2);

    const error = await submit("Forex").catch((err) => err);

    expect(error.statusCode).toBe(402);
    expect(error.errorCode).toBe("TRADE_LIMIT_REACHED");
    // The body the upgrade card and the quota pill both read.
    expect(error.details.quota).toMatchObject({
      market: "Forex",
      limit: 2,
      used: 2,
      remaining: 0,
      exhausted: true,
    });
    expect(ocrJobService.createOcrJob).not.toHaveBeenCalled();
  });

  it("scopes the allowance to the market being uploaded into", async () => {
    // Forex exhausted, Indian untouched — the Indian upload must still pass.
    Trade.countDocuments.mockResolvedValue(2);
    IndianTrade.countDocuments.mockResolvedValue(0);

    await expect(submit("Indian_Market")).resolves.toMatchObject({ success: true });
    expect(ocrJobService.createOcrJob).toHaveBeenCalledWith(
      expect.objectContaining({ marketType: "Indian_Market" })
    );
  });

  it("consumes nothing at upload time — the charge stays at trade insert", async () => {
    Trade.countDocuments.mockResolvedValue(1);

    await submit("Forex");
    await submit("Forex");

    // Two uploads, no write to any allowance: the gate only reads the lifetime
    // trade count, so createOcrJob → confirm-trade cannot double-charge.
    expect(ocrJobService.createOcrJob).toHaveBeenCalledTimes(2);
    expect(Trade.countDocuments).toHaveBeenCalledTimes(2);
  });
});
