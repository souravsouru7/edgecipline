const mongoose = require("mongoose");
const cloudinary = require("../config/cloudinary");
const ApiError = require("../utils/ApiError");
const { OCRJob } = require("../models/OCRJob");
const { enqueueOcrJob, getOcrJobSnapshot, ocrQueue } = require("../queues/ocrQueue");
const { processTradeUpload, getFriendlyProcessingError } = require("./tradeProcessingService");
const { logger } = require("../utils/logger");

const DEFAULT_TTL_HOURS = Number(process.env.OCR_JOB_TTL_HOURS || 24);

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

  const queueJob = await enqueueOcrJob({
    jobId: job._id.toString(),
    imageUrl: uploadedImage.imageUrl,
    userId: user._id,
    marketType,
    broker,
  });

  job.queueJobId = queueJob.id;
  job.queueJobName = queueJob.name;
  job.status = "PROCESSING";
  job.processingStartedAt = new Date();
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
  const job = await OCRJob.findById(jobId);
  if (!job) {
    throw new Error("OCR job not found");
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
    const result = await processTradeUpload({
      tradeId: job._id.toString(),
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
      latest.status = "FAILED";
      latest.error = getFriendlyProcessingError(error);
      latest.processedAt = new Date();
      latest.attemptsMade = attempt;
      await latest.save();
    }
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
  processOcrJob,
};
