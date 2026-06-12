const mongoose = require("mongoose");
const cloudinary = require("../config/cloudinary");
const ApiError = require("../utils/ApiError");
const { OCRJob } = require("../models/OCRJob");
const { enqueueOcrJob, getOcrJobSnapshot, ocrQueue } = require("../queues/ocrQueue");
const { processTradeUpload, getFriendlyProcessingError } = require("./tradeProcessingService");
const { logger } = require("../utils/logger");
const { appConfig } = require("../config");

const DEFAULT_TTL_HOURS = Number(process.env.OCR_JOB_TTL_HOURS || 24);
const STALE_PENDING_MS = Number(process.env.OCR_STALE_PENDING_MS || 5 * 60 * 1000);
const STALE_PROCESSING_MS = Number(process.env.OCR_STALE_PROCESSING_MS || 12 * 60 * 1000);

function getExpiryDate() {
  return new Date(Date.now() + DEFAULT_TTL_HOURS * 60 * 60 * 1000);
}

function assertObjectId(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(404, "OCR job not found or unauthorized", "NOT_FOUND");
  }
}

function serializeJob(job, queueState = null) {
  return {
    jobId: job._id.toString(),
    status: job.status,
    queueState: queueState?.state || null,
    attemptsMade: queueState?.attemptsMade ?? job.attemptsMade ?? 0,
    error: job.error || queueState?.failedReason || null,
    queuedAt: job.createdAt,
    processingStartedAt: job.processingStartedAt,
    processedAt: job.processedAt,
    cancelledAt: job.cancelledAt,
    confirmedAt: job.confirmedAt,
    expiresAt: job.expiresAt,
    data: job.status === "COMPLETED" || job.status === "CONFIRMED" ? job.extractedData : null,
  };
}

function isCancellationError(error) {
  return error?.code === "OCR_JOB_CANCELLED";
}

function createNonRetryableOcrError(message, code = "OCR_NON_RETRYABLE") {
  const error = new Error(message);
  error.code = code;
  error.nonRetryable = true;
  return error;
}

function isNonRetryableOcrError(error) {
  return Boolean(error?.nonRetryable) ||
    [
      "OCR_INVALID_PAYLOAD",
      "OCR_JOB_NOT_FOUND",
      "OCR_JOB_CANCELLED",
      "NOT_A_TRADE_IMAGE",
      "WRONG_MARKET_TYPE",
    ].includes(error?.code);
}

function isLegacyDraftTradeFailure(queueState, job) {
  const reason = String(queueState?.failedReason || job?.error || "").toLowerCase();
  return reason.includes("trade not found") && (job?.legacyDraftFailureRetryCount || 0) < 1;
}

async function removeQueueJob(queueJobId, jobId) {
  const queueJob = await ocrQueue.getJob(queueJobId);
  if (!queueJob) return;
  const state = await queueJob.getState();
  if (state === "failed" || state === "completed") {
    await queueJob.remove().catch((error) => {
      logger.warn("Failed to remove stale OCR queue job before requeue", {
        jobId,
        queueJobId,
        state,
        error: error.message,
      });
    });
  }
}

async function requeueLegacyDraftFailure(job, queueState) {
  const jobId = job._id.toString();
  const queueJobId = job.queueJobId || queueState?.jobId || jobId;
  await removeQueueJob(queueJobId, jobId);

  const queueJob = await enqueueOcrJob({
    jobId,
    imageUrl: job.uploadedImage?.imageUrl,
    userId: job.user,
    marketType: job.marketType,
    broker: job.broker,
  });

  job.status = "PROCESSING";
  job.queueJobId = queueJob.id;
  job.queueJobName = queueJob.name;
  job.error = null;
  job.processedAt = null;
  job.processingStartedAt = new Date();
  job.attemptsMade = 0;
  job.legacyDraftFailureRetryCount = (job.legacyDraftFailureRetryCount || 0) + 1;
  await job.save();

  logger.warn("Requeued OCR job after legacy draft-trade failure", {
    jobId,
    previousQueueJobId: queueJobId,
    queueJobId: queueJob.id,
    legacyDraftFailureRetryCount: job.legacyDraftFailureRetryCount,
  });

  return serializeJob(job, await getOcrJobSnapshot(queueJob.id));
}

async function createOcrJob({ user, uploadedImage, marketType, tradeSubType, broker, requestedTradeDate }) {
  const job = await OCRJob.create({
    user: user._id,
    marketType,
    tradeSubType: marketType === "Indian_Market" ? tradeSubType || "OPTION" : "",
    broker: broker || "",
    uploadedImage: {
      imageUrl: uploadedImage.imageUrl,
      publicId: uploadedImage.publicId || "",
      originalName: uploadedImage.originalName || "",
      mimeType: uploadedImage.mimeType || "",
      bytes: uploadedImage.bytes || 0,
    },
    requestedTradeDate: requestedTradeDate || null,
    status: "PENDING",
    expiresAt: getExpiryDate(),
  });

  logger.info("OCR job created", {
    jobId: job._id.toString(),
    userId: user._id?.toString?.() || user._id,
    marketType,
    tradeSubType: job.tradeSubType,
    imageUrl: Boolean(uploadedImage.imageUrl),
  });

  let queueJob;
  try {
    queueJob = await enqueueOcrJob({
      jobId: job._id.toString(),
      imageUrl: uploadedImage.imageUrl,
      userId: user._id,
      marketType,
      broker,
    });
  } catch (error) {
    job.status = "FAILED";
    job.error = error.message;
    job.processedAt = new Date();
    await job.save();
    throw error;
  }

  job.queueJobId = queueJob.id;
  job.queueJobName = queueJob.name;
  job.attemptsMade = queueJob.attemptsMade || 0;
  await job.save();

  return serializeJob(job, await getOcrJobSnapshot(queueJob.id));
}

async function getOcrJobForUser(userId, jobId) {
  assertObjectId(jobId);
  const job = await OCRJob.findOne({ _id: jobId, user: userId });
  if (!job) {
    throw new ApiError(404, "OCR job not found or unauthorized", "NOT_FOUND");
  }
  return job;
}

async function getOcrJobStatus(userId, jobId) {
  const job = await getOcrJobForUser(userId, jobId);
  const queueState = job.queueJobId ? await getOcrJobSnapshot(job.queueJobId) : null;

  if (
    !queueState &&
    (job.status === "PENDING" || job.status === "PROCESSING")
  ) {
    const ageMs = Date.now() - new Date(job.processingStartedAt || job.createdAt).getTime();
    const staleMs = job.status === "PROCESSING" ? STALE_PROCESSING_MS : STALE_PENDING_MS;
    if (ageMs >= staleMs) {
      const previousStatus = job.status;
      job.status = "FAILED";
      job.error = "OCR queue job was lost before completion. Please upload the screenshot again.";
      job.processedAt = new Date();
      await job.save();
      logger.error("OCR job failed because BullMQ job is missing", {
        jobId,
        queueJobId: job.queueJobId,
        userId: userId?.toString?.() || userId,
        previousStatus,
        ageMs,
      });
      return serializeJob(job, null);
    }
  }

  if (queueState?.state === "failed" && isLegacyDraftTradeFailure(queueState, job)) {
    return requeueLegacyDraftFailure(job, queueState);
  }
  if (
    queueState?.state === "failed" &&
    (job.status === "PENDING" || job.status === "PROCESSING")
  ) {
    job.status = "FAILED";
    job.error = job.error || queueState.failedReason || "OCR processing failed";
    job.processedAt = job.processedAt || new Date();
    job.attemptsMade = Math.max(job.attemptsMade || 0, queueState.attemptsMade || 0);
    await job.save();
    logger.error("OCR job status reconciled from failed queue state", {
      jobId,
      queueJobId: job.queueJobId,
      userId: userId?.toString?.() || userId,
      attemptsMade: job.attemptsMade,
      error: job.error,
    });
  }

  if (
    job.status === "PENDING" &&
    queueState &&
    ["active"].includes(queueState.state)
  ) {
    job.status = "PROCESSING";
    job.processingStartedAt = job.processingStartedAt || new Date(queueState.processedOn || Date.now());
    job.attemptsMade = Math.max(job.attemptsMade || 0, queueState.attemptsMade || 0);
    await job.save();
  }

  if (
    job.status === "PROCESSING" &&
    job.processingStartedAt &&
    Date.now() - new Date(job.processingStartedAt).getTime() >= STALE_PROCESSING_MS &&
    (!queueState || ["stalled", "unknown"].includes(queueState.state))
  ) {
    job.status = "FAILED";
    job.error = "OCR processing timed out. Please upload the screenshot again.";
    job.processedAt = new Date();
    await job.save();
    logger.error("OCR job failed because processing became stale", {
      jobId,
      queueJobId: job.queueJobId,
      queueState: queueState?.state || null,
      userId: userId?.toString?.() || userId,
    });
  }

  return serializeJob(job, queueState);
}

async function cancelOcrJob(userId, jobId) {
  const job = await getOcrJobForUser(userId, jobId);
  if (job.status === "CONFIRMED") {
    throw new ApiError(409, "Confirmed OCR jobs cannot be cancelled", "OCR_JOB_CONFIRMED");
  }
  if (job.status !== "CANCELLED") {
    const queueId = job.queueJobId || job._id.toString();
    const queueJob = await ocrQueue.getJob(queueId);
    if (queueJob) {
      const state = await queueJob.getState();
      if (state === "delayed" || state === "waiting" || state === "prioritized") {
        await queueJob.remove().catch((error) => {
          logger.warn("Failed to remove queued OCR job during cancel", { jobId, error: error.message });
        });
      }
    }

    job.status = "CANCELLED";
    job.cancelledAt = new Date();
    job.error = null;
    job.extractedData = null;
    job.extractionConfidence = 0;
    await job.save();

    await deleteUploadedImageForJob(job);
  }

  return serializeJob(job);
}

async function isOcrJobCancelled(jobId, stage = "") {
  const latest = await OCRJob.findById(jobId).select("status");
  const cancelled = !latest || latest.status === "CANCELLED";
  if (cancelled) {
    logger.info("OCR processing cancelled", { jobId, stage });
  }
  return cancelled;
}

async function processOcrJob(jobId, { attempt = 1, queueJobId = "" } = {}) {
  if (!mongoose.Types.ObjectId.isValid(jobId)) {
    logger.error("OCR worker rejected invalid job id", {
      jobId,
      queueJobId,
      attempt,
    });
    throw createNonRetryableOcrError("Invalid OCR job id", "OCR_INVALID_PAYLOAD");
  }

  const job = await OCRJob.findById(jobId);
  if (!job) {
    logger.error("OCR worker could not find OCRJob document", {
      jobId,
      queueJobId,
      attempt,
    });
    throw createNonRetryableOcrError("OCR job not found", "OCR_JOB_NOT_FOUND");
  }
  if (job.status === "CANCELLED" || job.status === "CONFIRMED") {
    return serializeJob(job);
  }

  job.status = "PROCESSING";
  job.processingStartedAt = job.processingStartedAt || new Date();
  job.attemptsMade = attempt;
  job.queueJobId = queueJobId || job.queueJobId || job._id.toString();
  job.error = null;
  await job.save();

  try {
    logger.info("OCR processing started", {
      jobId: job._id.toString(),
      queueJobId: queueJobId || job.queueJobId || job._id.toString(),
      userId: job.user?.toString?.() || job.user,
      marketType: job.marketType,
      imageUrl: Boolean(job.uploadedImage?.imageUrl),
      attempt,
    });

    const result = await processTradeUpload({
      ocrJobId: job._id.toString(),
      imageUrl: job.uploadedImage.imageUrl,
      jobId: queueJobId || job.queueJobId,
      attempt,
      persistTrade: false,
      tradeRecord: {
        _id: job._id,
        user: job.user,
        marketType: job.marketType,
        tradeSubType: job.tradeSubType,
        broker: job.broker,
        tradeDate: job.requestedTradeDate,
        uploadedImage: job.uploadedImage,
      },
      checkCancellation: (stage) => isOcrJobCancelled(jobId, stage),
    });

    const latest = await OCRJob.findById(jobId);
    if (!latest || latest.status === "CANCELLED") {
      return latest ? serializeJob(latest) : result;
    }

    latest.status = "COMPLETED";
    latest.extractedData = result.data;
    latest.extractionConfidence = result.data?.extractionConfidence || 0;
    latest.processedAt = new Date();
    latest.error = null;
    latest.attemptsMade = attempt;
    await latest.save();
    logger.info("OCR processing completed", {
      jobId,
      queueJobId,
      userId: latest.user?.toString?.() || latest.user,
      marketType: latest.marketType,
      extractionConfidence: latest.extractionConfidence,
      attempt,
    });
    return serializeJob(latest);
  } catch (error) {
    const latest = await OCRJob.findById(jobId);
    if (isCancellationError(error)) {
      if (latest && latest.status !== "CANCELLED") {
        latest.status = "CANCELLED";
        latest.cancelledAt = latest.cancelledAt || new Date();
        latest.error = null;
        latest.extractedData = null;
        latest.extractionConfidence = 0;
        latest.attemptsMade = attempt;
        await latest.save();
      }
      return latest ? serializeJob(latest) : { jobId, status: "CANCELLED" };
    }
    if (latest && latest.status !== "CANCELLED") {
      const terminalFailure = isNonRetryableOcrError(error) || attempt >= appConfig.ocrQueue.attempts;
      latest.status = terminalFailure ? "FAILED" : "PROCESSING";
      latest.error = terminalFailure ? getFriendlyProcessingError(error) : null;
      latest.processedAt = terminalFailure ? new Date() : null;
      latest.attemptsMade = attempt;
      await latest.save();
    }
    logger.error("OCR processing failed", {
      jobId,
      queueJobId,
      userId: latest?.user?.toString?.() || latest?.user,
      marketType: latest?.marketType,
      error: error.message,
      code: error.code,
      nonRetryable: isNonRetryableOcrError(error),
      attempt,
    });
    throw error;
  }
}

async function markOcrJobConfirmed(userId, jobId, { tradeId, collection }) {
  if (!jobId) return null;
  const job = await getOcrJobForUser(userId, jobId);
  if (job.status !== "COMPLETED" && job.status !== "CONFIRMED") {
    throw new ApiError(409, "OCR job is not ready to confirm", "OCR_JOB_NOT_COMPLETED");
  }

  job.status = "CONFIRMED";
  job.confirmedAt = new Date();
  job.confirmedTradeId = tradeId;
  job.confirmedTradeCollection = collection || "";
  await job.save();
  return serializeJob(job);
}

async function deleteUploadedImageForJob(jobOrId) {
  const job = typeof jobOrId === "object" && jobOrId !== null
    ? jobOrId
    : await OCRJob.findById(jobOrId);
  const publicId = job?.uploadedImage?.publicId;
  if (!publicId) return;
  await cloudinary.uploader.destroy(publicId, { resource_type: "image" }).catch((error) => {
    logger.warn("Failed to delete OCR upload from Cloudinary", { jobId: job?._id?.toString?.() || jobOrId, error: error.message });
  });
}

module.exports = {
  cancelOcrJob,
  createOcrJob,
  deleteUploadedImageForJob,
  getOcrJobStatus,
  markOcrJobConfirmed,
  isNonRetryableOcrError,
  processOcrJob,
};
