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
    jest.doMock("../../config/redis", () => ({
      isRedisReady: jest.fn(() => true),
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

    expect(result).toMatchObject({ success: true, jobId: validJobId, status: "PENDING" });
    expect(OCRJob.create).toHaveBeenCalledTimes(1);
    expect(tradeRepository.createTrade).not.toHaveBeenCalled();
  });

  test("upload fails before creating OCRJob when Redis queue is unavailable", async () => {
    const destroy = jest.fn().mockResolvedValue(undefined);

    jest.doMock("../../models/OCRJob", () => ({
      OCRJob: {
        create: jest.fn(),
      },
    }));
    jest.doMock("../../queues/ocrQueue", () => ({
      enqueueOcrJob: jest.fn(),
      getOcrJobSnapshot: jest.fn(),
      ocrQueue: { getJob: jest.fn(), getJobCounts: jest.fn() },
    }));
    jest.doMock("../../repositories/user.repository", () => ({
      markFreeUploadUsed: jest.fn(),
    }));
    jest.doMock("../../config/cloudinary", () => ({
      uploader: { destroy },
    }));
    jest.doMock("../../config/redis", () => ({
      isRedisReady: jest.fn(() => false),
    }));
    jest.doMock("../../utils/logger", () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));

    const { OCRJob } = require("../../models/OCRJob");
    const { enqueueOcrJob } = require("../../queues/ocrQueue");
    const uploadService = require("../../services/upload.service");

    await expect(uploadService.submitTradeUpload({
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
    })).rejects.toMatchObject({
      statusCode: 503,
      errorCode: "OCR_QUEUE_UNAVAILABLE",
    });

    expect(OCRJob.create).not.toHaveBeenCalled();
    expect(enqueueOcrJob).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledWith("ocr/test", { resource_type: "image" });
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

  test("status polling reconciles failed BullMQ state to FAILED OCRJob", async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const jobDoc = {
      _id: { toString: () => validJobId },
      user: validUserId,
      status: "PROCESSING",
      queueJobId: validJobId,
      attemptsMade: 0,
      error: null,
      save,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      processingStartedAt: new Date("2026-01-01T00:00:01.000Z"),
      processedAt: null,
      cancelledAt: null,
      confirmedAt: null,
      expiresAt: new Date("2026-01-02T00:00:00.000Z"),
    };

    jest.doMock("../../models/OCRJob", () => ({
      OCRJob: {
        findOne: jest.fn().mockResolvedValue(jobDoc),
      },
    }));
    jest.doMock("../../queues/ocrQueue", () => ({
      enqueueOcrJob: jest.fn(),
      getOcrJobSnapshot: jest.fn().mockResolvedValue({
        state: "failed",
        attemptsMade: 1,
        failedReason: "Invalid OCR job id",
      }),
      ocrQueue: { getJob: jest.fn() },
    }));
    jest.doMock("../../config/cloudinary", () => ({
      uploader: { destroy: jest.fn() },
    }));
    jest.doMock("../../utils/logger", () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));

    const { getOcrJobStatus } = require("../../services/ocrJob.service");

    const result = await getOcrJobStatus(validUserId, validJobId);

    expect(result.status).toBe("FAILED");
    expect(result.error).toBe("Invalid OCR job id");
    expect(jobDoc.status).toBe("FAILED");
    expect(jobDoc.attemptsMade).toBe(1);
    expect(jobDoc.processedAt).toBeInstanceOf(Date);
    expect(save).toHaveBeenCalledTimes(1);
  });

  test("status polling requeues one legacy Trade not found OCR failure", async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const jobDoc = {
      _id: { toString: () => validJobId },
      user: validUserId,
      status: "PROCESSING",
      queueJobId: validJobId,
      queueJobName: "processOcrJob",
      attemptsMade: 3,
      error: null,
      uploadedImage: { imageUrl: "https://example.test/image.png", publicId: "ocr/active" },
      marketType: "Forex",
      broker: "",
      legacyDraftFailureRetryCount: 0,
      save,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      processingStartedAt: new Date("2026-01-01T00:00:01.000Z"),
      processedAt: null,
      cancelledAt: null,
      confirmedAt: null,
      expiresAt: new Date("2026-01-02T00:00:00.000Z"),
    };
    const remove = jest.fn().mockResolvedValue(undefined);
    const enqueueOcrJob = jest.fn().mockResolvedValue({
      id: validJobId,
      name: "processOcrJob",
      attemptsMade: 0,
    });
    const getOcrJobSnapshot = jest
      .fn()
      .mockResolvedValueOnce({
        jobId: validJobId,
        state: "failed",
        attemptsMade: 3,
        failedReason: "Trade not found",
      })
      .mockResolvedValueOnce({
        jobId: validJobId,
        state: "waiting",
        attemptsMade: 0,
      });

    jest.doMock("../../models/OCRJob", () => ({
      OCRJob: {
        findOne: jest.fn().mockResolvedValue(jobDoc),
      },
    }));
    jest.doMock("../../queues/ocrQueue", () => ({
      enqueueOcrJob,
      getOcrJobSnapshot,
      ocrQueue: {
        getJob: jest.fn().mockResolvedValue({
          getState: jest.fn().mockResolvedValue("failed"),
          remove,
        }),
      },
    }));
    jest.doMock("../../config/cloudinary", () => ({
      uploader: { destroy: jest.fn() },
    }));
    jest.doMock("../../utils/logger", () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));

    const { getOcrJobStatus } = require("../../services/ocrJob.service");

    const result = await getOcrJobStatus(validUserId, validJobId);

    expect(result.status).toBe("PROCESSING");
    expect(result.queueState).toBe("waiting");
    expect(remove).toHaveBeenCalledTimes(1);
    expect(enqueueOcrJob).toHaveBeenCalledWith({
      jobId: validJobId,
      imageUrl: "https://example.test/image.png",
      userId: validUserId,
      marketType: "Forex",
      broker: "",
    });
    expect(jobDoc.error).toBeNull();
    expect(jobDoc.processedAt).toBeNull();
    expect(jobDoc.attemptsMade).toBe(0);
    expect(jobDoc.legacyDraftFailureRetryCount).toBe(1);
    expect(save).toHaveBeenCalledTimes(1);
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

  test("processOcrJob passes OCR job id, not a draft trade id, to the processor", async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const jobDoc = {
      _id: { toString: () => validJobId },
      user: validUserId,
      status: "PROCESSING",
      queueJobId: validJobId,
      uploadedImage: { imageUrl: "https://example.test/image.png", publicId: "ocr/active" },
      marketType: "Forex",
      tradeSubType: "",
      broker: "",
      requestedTradeDate: new Date("2026-01-01T00:00:00.000Z"),
      save,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      expiresAt: new Date("2026-01-02T00:00:00.000Z"),
    };
    const processTradeUpload = jest.fn().mockResolvedValue({
      data: {
        extractionConfidence: 91,
        parsedTrade: { pair: "EURUSD" },
      },
    });

    jest.doMock("../../models/OCRJob", () => ({
      OCRJob: {
        findById: jest
          .fn()
          .mockResolvedValueOnce(jobDoc)
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
      processTradeUpload,
    }));
    jest.doMock("../../config/cloudinary", () => ({
      uploader: { destroy: jest.fn() },
    }));
    jest.doMock("../../utils/logger", () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));

    const { processOcrJob } = require("../../services/ocrJob.service");

    const result = await processOcrJob(validJobId, { queueJobId: validJobId, attempt: 1 });

    expect(result.status).toBe("COMPLETED");
    expect(processTradeUpload).toHaveBeenCalledWith(expect.objectContaining({
      ocrJobId: validJobId,
      imageUrl: "https://example.test/image.png",
      persistTrade: false,
      tradeRecord: expect.objectContaining({
        user: validUserId,
        marketType: "Forex",
      }),
    }));
    expect(processTradeUpload.mock.calls[0][0]).not.toHaveProperty("tradeId");
  });

  test("processOcrJob fails invalid queue ids without retryable trade lookup", async () => {
    jest.doMock("../../models/OCRJob", () => ({
      OCRJob: {
        findById: jest.fn(),
      },
    }));
    jest.doMock("../../queues/ocrQueue", () => ({
      enqueueOcrJob: jest.fn(),
      getOcrJobSnapshot: jest.fn(),
      ocrQueue: { getJob: jest.fn() },
    }));
    jest.doMock("../../services/tradeProcessingService", () => ({
      getFriendlyProcessingError: jest.fn((error) => error.message),
      processTradeUpload: jest.fn(),
    }));
    jest.doMock("../../config/cloudinary", () => ({
      uploader: { destroy: jest.fn() },
    }));
    jest.doMock("../../utils/logger", () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));

    const { processOcrJob } = require("../../services/ocrJob.service");
    const tradeProcessing = require("../../services/tradeProcessingService");

    await expect(processOcrJob("undefined", { queueJobId: "undefined", attempt: 1 }))
      .rejects
      .toMatchObject({
        code: "OCR_INVALID_PAYLOAD",
        nonRetryable: true,
      });
    expect(tradeProcessing.processTradeUpload).not.toHaveBeenCalled();
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
