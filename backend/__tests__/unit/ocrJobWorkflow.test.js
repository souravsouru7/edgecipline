const validJobId = "507f1f77bcf86cd799439011";
const validUserId = "507f1f77bcf86cd799439012";

describe("OCR job workflow", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test("upload creates an OCRJob and never creates a Trade", async () => {
    const savedJob = {
      _id: { toString: () => validJobId },
      status: "PENDING",
      save: jest.fn().mockResolvedValue(undefined),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      processingStartedAt: null,
      processedAt: null,
      cancelledAt: null,
      confirmedAt: null,
      expiresAt: new Date("2026-01-02T00:00:00.000Z"),
    };

    jest.doMock("../../models/OCRJob", () => ({
      OCRJob: {
        create: jest.fn().mockResolvedValue(savedJob),
      },
    }));
    jest.doMock("../../queues/ocrQueue", () => ({
      enqueueOcrJob: jest.fn().mockResolvedValue({ id: validJobId, name: "processOcrJob", attemptsMade: 0 }),
      getOcrJobSnapshot: jest.fn().mockResolvedValue({ state: "waiting", attemptsMade: 0 }),
      ocrQueue: { getJob: jest.fn() },
    }));
    jest.doMock("../../repositories/user.repository", () => ({
      markFreeUploadUsed: jest.fn().mockResolvedValue(undefined),
    }));
    jest.doMock("../../repositories/trade.repository", () => ({
      createTrade: jest.fn(),
    }));
    jest.doMock("../../config/cloudinary", () => ({
      uploader: { destroy: jest.fn().mockResolvedValue(undefined) },
    }));
    jest.doMock("../../utils/logger", () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));

    const tradeRepository = require("../../repositories/trade.repository");
    const { OCRJob } = require("../../models/OCRJob");
    const uploadService = require("../../services/upload.service");

    const result = await uploadService.submitTradeUpload({
      user: {
        _id: validUserId,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        subscriptionStatus: "active",
        subscriptionExpiry: new Date("2027-01-01T00:00:00.000Z"),
        freeUploadUsed: false,
      },
      body: { marketType: "Forex", tradeDate: "2026-01-01" },
      query: {},
      uploadedImage: {
        imageUrl: "https://example.test/image.png",
        publicId: "ocr/test",
        originalName: "image.png",
        mimeType: "image/png",
        bytes: 1234,
      },
      file: { originalname: "image.png", mimetype: "image/png", size: 1234 },
    });

    expect(result).toMatchObject({ success: true, jobId: validJobId, status: "PROCESSING" });
    expect(OCRJob.create).toHaveBeenCalledTimes(1);
    expect(tradeRepository.createTrade).not.toHaveBeenCalled();
  });

  test("cancel marks the OCRJob cancelled without deleting a Trade", async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const jobDoc = {
      _id: validJobId,
      user: validUserId,
      status: "PROCESSING",
      queueJobId: validJobId,
      uploadedImage: { publicId: "ocr/test" },
      save,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      expiresAt: new Date("2026-01-02T00:00:00.000Z"),
    };
    const remove = jest.fn().mockResolvedValue(undefined);

    jest.doMock("../../models/OCRJob", () => ({
      OCRJob: {
        findOne: jest.fn().mockResolvedValue(jobDoc),
      },
    }));
    jest.doMock("../../queues/ocrQueue", () => ({
      enqueueOcrJob: jest.fn(),
      getOcrJobSnapshot: jest.fn(),
      ocrQueue: {
        getJob: jest.fn().mockResolvedValue({
          getState: jest.fn().mockResolvedValue("waiting"),
          remove,
        }),
      },
    }));
    jest.doMock("../../config/cloudinary", () => ({
      uploader: { destroy: jest.fn().mockResolvedValue(undefined) },
    }));
    jest.doMock("../../utils/logger", () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));
    jest.doMock("../../repositories/trade.repository", () => ({
      deleteForexTradeByUser: jest.fn(),
    }));

    const tradeRepository = require("../../repositories/trade.repository");
    const { cancelOcrJob } = require("../../services/ocrJob.service");

    const result = await cancelOcrJob(validUserId, validJobId);

    expect(result.status).toBe("CANCELLED");
    expect(jobDoc.status).toBe("CANCELLED");
    expect(jobDoc.extractedData).toBeNull();
    expect(jobDoc.extractionConfidence).toBe(0);
    expect(jobDoc.cancelledAt).toBeInstanceOf(Date);
    expect(save).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(tradeRepository.deleteForexTradeByUser).not.toHaveBeenCalled();
  });

  test("cancel completed OCRJob clears stale extraction data and deletes Cloudinary image", async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const destroy = jest.fn().mockResolvedValue(undefined);
    const jobDoc = {
      _id: validJobId,
      user: validUserId,
      status: "COMPLETED",
      queueJobId: validJobId,
      uploadedImage: { publicId: "ocr/completed" },
      extractedData: { parsedTrade: { pair: "EURUSD" } },
      extractionConfidence: 88,
      save,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      expiresAt: new Date("2026-01-02T00:00:00.000Z"),
    };

    jest.doMock("../../models/OCRJob", () => ({
      OCRJob: {
        findOne: jest.fn().mockResolvedValue(jobDoc),
        findById: jest.fn().mockResolvedValue(jobDoc),
      },
    }));
    jest.doMock("../../queues/ocrQueue", () => ({
      enqueueOcrJob: jest.fn(),
      getOcrJobSnapshot: jest.fn(),
      ocrQueue: {
        getJob: jest.fn().mockResolvedValue({
          getState: jest.fn().mockResolvedValue("completed"),
          remove: jest.fn(),
        }),
      },
    }));
    jest.doMock("../../config/cloudinary", () => ({
      uploader: { destroy },
    }));
    jest.doMock("../../utils/logger", () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));

    const { cancelOcrJob } = require("../../services/ocrJob.service");

    const result = await cancelOcrJob(validUserId, validJobId);

    expect(result.status).toBe("CANCELLED");
    expect(jobDoc.extractedData).toBeNull();
    expect(jobDoc.extractionConfidence).toBe(0);
    expect(destroy).toHaveBeenCalledWith("ocr/completed", { resource_type: "image" });
  });

  test("double cancel is idempotent", async () => {
    const save = jest.fn();
    const destroy = jest.fn();
    const jobDoc = {
      _id: validJobId,
      user: validUserId,
      status: "CANCELLED",
      uploadedImage: { publicId: "ocr/already-cancelled" },
      save,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      cancelledAt: new Date("2026-01-01T00:01:00.000Z"),
      expiresAt: new Date("2026-01-02T00:00:00.000Z"),
    };

    jest.doMock("../../models/OCRJob", () => ({
      OCRJob: {
        findOne: jest.fn().mockResolvedValue(jobDoc),
      },
    }));
    jest.doMock("../../queues/ocrQueue", () => ({
      enqueueOcrJob: jest.fn(),
      getOcrJobSnapshot: jest.fn(),
      ocrQueue: { getJob: jest.fn() },
    }));
    jest.doMock("../../config/cloudinary", () => ({
      uploader: { destroy },
    }));
    jest.doMock("../../utils/logger", () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));

    const { cancelOcrJob } = require("../../services/ocrJob.service");

    const result = await cancelOcrJob(validUserId, validJobId);

    expect(result.status).toBe("CANCELLED");
    expect(save).not.toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
  });

  test("cancel rejects unauthorized OCRJob ownership", async () => {
    jest.doMock("../../models/OCRJob", () => ({
      OCRJob: {
        findOne: jest.fn().mockResolvedValue(null),
      },
    }));
    jest.doMock("../../queues/ocrQueue", () => ({
      enqueueOcrJob: jest.fn(),
      getOcrJobSnapshot: jest.fn(),
      ocrQueue: { getJob: jest.fn() },
    }));
    jest.doMock("../../config/cloudinary", () => ({
      uploader: { destroy: jest.fn() },
    }));
    jest.doMock("../../utils/logger", () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));

    const { cancelOcrJob } = require("../../services/ocrJob.service");

    await expect(cancelOcrJob(validUserId, validJobId)).rejects.toMatchObject({
      statusCode: 404,
      errorCode: "NOT_FOUND",
    });
  });

  test("processing cancellation exits as CANCELLED without writing extraction results", async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const jobDoc = {
      _id: { toString: () => validJobId },
      user: validUserId,
      status: "PROCESSING",
      queueJobId: validJobId,
      uploadedImage: { imageUrl: "https://example.test/image.png", publicId: "ocr/active" },
      tradeSubType: "",
      broker: "",
      save,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      expiresAt: new Date("2026-01-02T00:00:00.000Z"),
    };
    const select = jest.fn().mockResolvedValue({ status: "CANCELLED" });

    jest.doMock("../../models/OCRJob", () => ({
      OCRJob: {
        findById: jest
          .fn()
          .mockResolvedValueOnce(jobDoc)
          .mockReturnValueOnce({ select })
          .mockResolvedValueOnce(jobDoc),
      },
    }));
    jest.doMock("../../queues/ocrQueue", () => ({
      enqueueOcrJob: jest.fn(),
      getOcrJobSnapshot: jest.fn(),
      ocrQueue: { getJob: jest.fn() },
    }));
    jest.doMock("../../services/tradeProcessingService", () => ({
      getFriendlyProcessingError: jest.fn((error) => error.message),
      processTradeUpload: jest.fn(async ({ checkCancellation }) => {
        if (await checkCancellation("before-ai")) {
          const error = new Error("OCR job cancelled");
          error.code = "OCR_JOB_CANCELLED";
          throw error;
        }
        return { data: { extractionConfidence: 90, parsedTrade: { pair: "EURUSD" } } };
      }),
    }));
    jest.doMock("../../config/cloudinary", () => ({
      uploader: { destroy: jest.fn() },
    }));
    jest.doMock("../../utils/logger", () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));

    const { processOcrJob } = require("../../services/ocrJob.service");

    const result = await processOcrJob(validJobId, { queueJobId: validJobId, attempt: 1 });

    expect(result.status).toBe("CANCELLED");
    expect(jobDoc.status).toBe("CANCELLED");
    expect(jobDoc.extractedData).toBeNull();
    expect(jobDoc.extractionConfidence).toBe(0);
  });

  test("saving a real Forex trade confirms the completed OCRJob", async () => {
    const createdTrade = { _id: "507f1f77bcf86cd799439013", user: validUserId, marketType: "Forex" };
    const markOcrJobConfirmed = jest.fn().mockResolvedValue(undefined);

    jest.doMock("../../repositories/trade.repository", () => ({
      createTrade: jest.fn().mockResolvedValue(createdTrade),
    }));
    jest.doMock("../../utils/cacheUtils", () => ({
      clearUserCache: jest.fn().mockResolvedValue(undefined),
      getTradeCacheVersion: jest.fn(),
      invalidateTradeCaches: jest.fn().mockResolvedValue(1),
      TRADE_CACHE_EVENTS: {
        CREATE: "create",
        DELETE: "delete",
        EDIT: "edit",
        IMPORT: "import",
        OCR_SAVE: "ocr_save",
        RESTORE: "restore",
      },
    }));
    jest.doMock("../../utils/cache", () => ({
      buildCacheKey: jest.fn(),
      getCache: jest.fn(),
      rememberCache: jest.fn(),
    }));
    jest.doMock("../../services/smartNotificationEvaluator", () => ({
      evaluateSmartNotifications: jest.fn().mockResolvedValue(undefined),
    }));
    jest.doMock("../../services/ocrJob.service", () => ({
      markOcrJobConfirmed,
    }));

    const tradeService = require("../../services/trade.service");

    await tradeService.createTrade(validUserId, {
      ocrJobId: validJobId,
      pair: "EURUSD",
      type: "BUY",
      tradeDate: "2026-01-01",
    });

    expect(markOcrJobConfirmed).toHaveBeenCalledWith(validUserId, validJobId, {
      tradeId: createdTrade._id,
      collection: "forex",
    });
  });
});
