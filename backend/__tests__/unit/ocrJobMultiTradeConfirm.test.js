// A screenshot can hold several trades. Saving one must not lock the others
// out, deleting a saved trade must free its slot, and a screenshot can never
// produce more trades than it held.
const jobId = "507f1f77bcf86cd799439011";
const userId = "507f1f77bcf86cd799439012";

function makeJob(overrides = {}) {
  return {
    _id: { toString: () => jobId },
    user: userId,
    marketType: "Forex",
    status: "CONFIRMED",
    confirmedTradeId: null,
    extractedData: { parsedTrades: [{ pair: "EURUSD" }, { pair: "USDJPY" }] },
    ...overrides,
  };
}

function setup({ job, liveStamped = 0, liveLegacy = 0, claimSucceeds = false }) {
  jest.resetModules();
  const updateOne = jest.fn().mockResolvedValue({});
  const lean = jest.fn().mockResolvedValue(job);
  const OCRJob = {
    findOne: jest.fn((query) => {
      // getOcrJobForUser awaits findOne directly; the upload guard chains.
      const chain = { sort: () => chain, select: () => chain, lean };
      return Object.assign(Promise.resolve(job), chain);
    }),
    findOneAndUpdate: jest.fn().mockResolvedValue(claimSucceeds ? { ...job, status: "CONFIRMED" } : null),
    updateOne,
  };
  const countDocuments = jest.fn((query) =>
    Promise.resolve(query.ocrJobId === jobId ? liveStamped : liveLegacy));
  jest.doMock("../../models/OCRJob", () => ({ OCRJob }));
  jest.doMock("../../models/Trade", () => ({ countDocuments }));
  jest.doMock("../../models/IndianTrade", () => ({ countDocuments }));
  jest.doMock("../../queues/ocrQueue", () => ({
    enqueueOcrJob: jest.fn(), getOcrJobSnapshot: jest.fn(), ocrQueue: { getJob: jest.fn() },
  }));
  jest.doMock("../../services/tradeProcessingService", () => ({
    processTradeUpload: jest.fn(), getFriendlyProcessingError: jest.fn(),
  }));
  jest.doMock("../../config/cloudinary", () => ({ uploader: { destroy: jest.fn() } }));
  jest.doMock("../../config/redis", () => ({ isRedisReady: jest.fn(() => true) }));
  jest.doMock("../../utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  }));
  return { OCRJob, updateOne, countDocuments };
}

describe("multi-trade screenshot confirmation", () => {
  test("first save claims the job atomically", async () => {
    setup({ job: makeJob({ status: "COMPLETED" }), claimSucceeds: true });
    const { claimOcrJobForConfirmation } = require("../../services/ocrJob.service");
    await expect(claimOcrJobForConfirmation(userId, jobId, "Forex")).resolves.toBeTruthy();
  });

  test("second trade of a 2-trade screenshot can be saved after the first", async () => {
    setup({ job: makeJob(), liveStamped: 1 });
    const { claimOcrJobForConfirmation } = require("../../services/ocrJob.service");
    await expect(claimOcrJobForConfirmation(userId, jobId, "Forex")).resolves.toBeTruthy();
  });

  test("a third save from a 2-trade screenshot is rejected", async () => {
    setup({ job: makeJob(), liveStamped: 2 });
    const { claimOcrJobForConfirmation } = require("../../services/ocrJob.service");
    await expect(claimOcrJobForConfirmation(userId, jobId, "Forex"))
      .rejects.toMatchObject({ errorCode: "OCR_JOB_ALREADY_CONFIRMED" });
  });

  test("a batch larger than the remaining trades is rejected", async () => {
    setup({ job: makeJob(), liveStamped: 1 });
    const { claimOcrJobForConfirmation } = require("../../services/ocrJob.service");
    await expect(claimOcrJobForConfirmation(userId, jobId, "Forex", 2))
      .rejects.toMatchObject({ errorCode: "OCR_JOB_ALREADY_CONFIRMED" });
  });

  test("a single-trade screenshot still blocks a second save", async () => {
    setup({
      job: makeJob({ extractedData: { parsedTrade: { pair: "EURUSD" } }, confirmedTradeId: "t1" }),
      liveLegacy: 1,
    });
    const { claimOcrJobForConfirmation } = require("../../services/ocrJob.service");
    await expect(claimOcrJobForConfirmation(userId, jobId, "Forex"))
      .rejects.toMatchObject({ errorCode: "OCR_JOB_ALREADY_CONFIRMED" });
  });

  test("a deleted legacy trade frees the screenshot again", async () => {
    // confirmedTradeId points at a trade that is now soft-deleted -> 0 live.
    setup({ job: makeJob({ confirmedTradeId: "t1" }), liveLegacy: 0 });
    const { claimOcrJobForConfirmation } = require("../../services/ocrJob.service");
    await expect(claimOcrJobForConfirmation(userId, jobId, "Forex", 2)).resolves.toBeTruthy();
  });

  test("re-upload of a confirmed screenshot with unsaved trades reopens it", async () => {
    const { updateOne } = setup({ job: makeJob(), liveStamped: 1 });
    const uploadService = require("../../services/upload.service");
    await expect(uploadService.submitTradeUpload({
      user: { _id: userId, createdAt: new Date("2026-01-01") },
      body: { marketType: "Forex" },
      query: {},
      uploadedImage: { imageUrl: "https://example.test/a.png", imageHash: "abc" },
    })).rejects.toMatchObject({
      errorCode: "DUPLICATE_UPLOAD",
      details: expect.objectContaining({ resumable: true, jobStatus: "COMPLETED" }),
    });
    expect(updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ status: "CONFIRMED" }),
      { $set: { status: "COMPLETED" } }
    );
  });

  test("re-upload of a fully saved screenshot is still blocked", async () => {
    setup({ job: makeJob(), liveStamped: 2 });
    const uploadService = require("../../services/upload.service");
    await expect(uploadService.submitTradeUpload({
      user: { _id: userId, createdAt: new Date("2026-01-01") },
      body: { marketType: "Forex" },
      query: {},
      uploadedImage: { imageUrl: "https://example.test/a.png", imageHash: "abc" },
    })).rejects.toMatchObject({
      errorCode: "DUPLICATE_UPLOAD",
      details: expect.objectContaining({ resumable: false }),
    });
  });
});
