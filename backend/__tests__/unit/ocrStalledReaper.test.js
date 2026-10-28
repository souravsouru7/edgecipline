const validJobId = "507f1f77bcf86cd799439011";
const validUserId = "507f1f77bcf86cd799439012";

const MINUTES = 60 * 1000;

function buildJob({ status = "PENDING", ageMinutes = 20, queueJobId = validJobId } = {}) {
  const createdAt = new Date(Date.now() - ageMinutes * MINUTES);
  return {
    _id: { toString: () => validJobId },
    user: validUserId,
    status,
    queueJobId,
    marketType: "Forex",
    createdAt,
    processingStartedAt: status === "PROCESSING" ? createdAt : null,
    uploadedImage: { imageUrl: "https://example.test/i.png", publicId: "ocr/test" },
  };
}

// Shared doubles. Each test re-mocks only what it needs to vary.
function mockCommon({ queueSnapshot, findResult, findOneAndUpdateResult }) {
  const findOneAndUpdate = jest.fn().mockResolvedValue(findOneAndUpdateResult ?? null);
  const enqueueNotificationDelivery = jest.fn().mockResolvedValue({ id: "n1" });
  const enqueueOcrJob = jest.fn().mockResolvedValue({ id: validJobId, name: "processOcrJob" });

  jest.doMock("../../models/OCRJob", () => ({
    OCRJob: {
      find: jest.fn(() => ({
        sort: jest.fn(() => ({
          limit: jest.fn().mockResolvedValue(findResult),
        })),
      })),
      findOneAndUpdate,
      findById: jest.fn().mockResolvedValue(null),
      exists: jest.fn().mockResolvedValue(null),
      updateOne: jest.fn().mockResolvedValue({}),
    },
  }));
  jest.doMock("../../queues/ocrQueue", () => ({
    enqueueOcrJob,
    getOcrJobSnapshot: jest.fn().mockResolvedValue(queueSnapshot),
    ocrQueue: { getJob: jest.fn() },
  }));
  jest.doMock("../../queues/smartNotificationQueue", () => ({
    enqueueNotificationDelivery,
  }));
  jest.doMock("../../models/Users", () => ({
    findById: jest.fn(() => ({ select: jest.fn(() => ({ lean: jest.fn().mockResolvedValue(null) })) })),
  }));
  jest.doMock("../../config/cloudinary", () => ({
    uploader: { destroy: jest.fn().mockResolvedValue(undefined) },
  }));
  jest.doMock("../../utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  }));

  return { findOneAndUpdate, enqueueNotificationDelivery, enqueueOcrJob };
}

describe("OCR stalled-job reaper", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  // The case the status endpoint structurally cannot catch: the BullMQ job
  // exists, so the missing-queue-job recovery never fires, but nothing is
  // consuming it. Before the reaper this polled forever.
  test("fails a job left waiting with no consumer, and notifies the user", async () => {
    const job = buildJob({ status: "PENDING", ageMinutes: 20 });
    const { findOneAndUpdate, enqueueNotificationDelivery } = mockCommon({
      queueSnapshot: { state: "waiting", attemptsMade: 0, failedReason: null },
      findResult: [job],
      findOneAndUpdateResult: { ...job, status: "FAILED" },
    });

    const { reapStalledOcrJobs } = require("../../services/ocrJob.service");
    const stats = await reapStalledOcrJobs();

    expect(stats.failedWaiting).toBe(1);
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: { $in: ["PENDING", "PROCESSING"] } }),
      expect.objectContaining({
        $set: expect.objectContaining({ status: "FAILED" }),
      }),
      expect.anything()
    );
    // Same dedupeKey the worker uses, so a reap and a late worker failure
    // cannot both notify for one job.
    expect(enqueueNotificationDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        notification: expect.objectContaining({
          type: "ocr_failed",
          dedupeKey: `ocr-failed:${validJobId}`,
        }),
      })
    );
  });

  test("leaves a recently-queued job alone", async () => {
    const job = buildJob({ status: "PENDING", ageMinutes: 3 });
    const { findOneAndUpdate } = mockCommon({
      queueSnapshot: { state: "waiting", attemptsMade: 0 },
      findResult: [job],
    });

    const { reapStalledOcrJobs } = require("../../services/ocrJob.service");
    const stats = await reapStalledOcrJobs();

    expect(stats.failedWaiting).toBe(0);
    expect(stats.skipped).toBe(1);
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  // An active job may legitimately run to PROCESSING_TIMEOUT_MS, and BullMQ's
  // stalled handling owns a dead worker. Truncating real work here would be
  // worse than the stall.
  test("does not touch an active job inside the total-processing budget", async () => {
    const job = buildJob({ status: "PROCESSING", ageMinutes: 9 });
    const { findOneAndUpdate } = mockCommon({
      queueSnapshot: { state: "active", attemptsMade: 1 },
      findResult: [job],
    });

    const { reapStalledOcrJobs } = require("../../services/ocrJob.service");
    const stats = await reapStalledOcrJobs();

    expect(stats.failedProcessing).toBe(0);
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("fails an active job that outlived the total-processing budget", async () => {
    const job = buildJob({ status: "PROCESSING", ageMinutes: 45 });
    const { findOneAndUpdate } = mockCommon({
      queueSnapshot: { state: "active", attemptsMade: 3 },
      findResult: [job],
      findOneAndUpdateResult: { ...job, status: "FAILED" },
    });

    const { reapStalledOcrJobs } = require("../../services/ocrJob.service");
    const stats = await reapStalledOcrJobs();

    expect(stats.failedProcessing).toBe(1);
    expect(findOneAndUpdate).toHaveBeenCalled();
  });

  test("reconciles a job the queue already failed", async () => {
    const job = buildJob({ status: "PROCESSING", ageMinutes: 20 });
    const { findOneAndUpdate } = mockCommon({
      queueSnapshot: { state: "failed", attemptsMade: 3, failedReason: "boom" },
      findResult: [job],
      findOneAndUpdateResult: { ...job, status: "FAILED" },
    });

    const { reapStalledOcrJobs } = require("../../services/ocrJob.service");
    const stats = await reapStalledOcrJobs();

    expect(stats.reconciled).toBe(1);
    expect(findOneAndUpdate).toHaveBeenCalled();
  });

  // Racing a worker that just completed: the status-guarded update matches
  // nothing and the reaper must not notify or double-count.
  test("losing the race with a finishing worker is a no-op", async () => {
    const job = buildJob({ status: "PROCESSING", ageMinutes: 20 });
    const { enqueueNotificationDelivery } = mockCommon({
      queueSnapshot: { state: "failed", attemptsMade: 3, failedReason: "boom" },
      findResult: [job],
      findOneAndUpdateResult: null, // guard matched nothing
    });

    const { reapStalledOcrJobs } = require("../../services/ocrJob.service");
    await reapStalledOcrJobs();

    expect(enqueueNotificationDelivery).not.toHaveBeenCalled();
  });

  test("one failing row does not abort the sweep", async () => {
    const bad = buildJob({ status: "PENDING", ageMinutes: 20 });
    const good = buildJob({ status: "PENDING", ageMinutes: 20 });
    mockCommon({
      queueSnapshot: { state: "waiting", attemptsMade: 0 },
      findResult: [bad, good],
      findOneAndUpdateResult: { ...good, status: "FAILED" },
    });

    const { getOcrJobSnapshot } = require("../../queues/ocrQueue");
    getOcrJobSnapshot
      .mockRejectedValueOnce(new Error("redis gone"))
      .mockResolvedValueOnce({ state: "waiting", attemptsMade: 0 });

    const { reapStalledOcrJobs } = require("../../services/ocrJob.service");
    const stats = await reapStalledOcrJobs();

    expect(stats.scanned).toBe(2);
    expect(stats.failedWaiting).toBe(1);
  });
});
