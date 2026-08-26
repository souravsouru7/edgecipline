const mongoose = require("mongoose");
const cloudinary = require("../config/cloudinary");
const ApiError = require("../utils/ApiError");
const { cancelOcrJob, createOcrJob, getOcrJobStatus } = require("./ocrJob.service");
const { OCRJob } = require("../models/OCRJob");
const { ocrQueue } = require("../queues/ocrQueue");
const userRepository = require("../repositories/user.repository");
const { logger } = require("../utils/logger");
const { normalizeTradeDate } = require("../utils/dateUtils");
const { isRedisReady } = require("../config/redis");
const { isPremium } = require("../utils/premium");

const BROKER_MAX_LENGTH = 50;
const ACTIVE_DUPLICATE_STATUSES = ["PENDING", "PROCESSING", "COMPLETED", "CONFIRMED"];

async function findDuplicateUploadJob(userId, imageHash) {
  if (!imageHash) return null;
  return OCRJob.findOne({
    user: userId,
    imageHash,
    status: { $in: ACTIVE_DUPLICATE_STATUSES },
  })
    .sort({ createdAt: -1 })
    .select("status")
    .lean();
}

// The job the caller is colliding with is the job they almost certainly want
// to see: a refresh or a dropped response mid-upload leaves the extraction
// running with nothing on screen, and re-uploading the same screenshot is the
// obvious thing to try next. Handing back the id lets the client reconnect to
// it instead of dead-ending on "check your trade log", where nothing was ever
// saved.
function buildDuplicateError(duplicateJob) {
  const stillProcessing =
    duplicateJob.status === "PENDING" || duplicateJob.status === "PROCESSING";

  return new ApiError(
    409,
    stillProcessing
      ? "This screenshot is already being processed. Reconnecting you to it now."
      : duplicateJob.status === "CONFIRMED"
      ? "You already saved this screenshot as a trade. Check your trade log before uploading it again."
      : "You already uploaded this exact screenshot. Reopening the extraction we already have.",
    "DUPLICATE_UPLOAD",
    {
      jobId: duplicateJob._id?.toString?.() || String(duplicateJob._id),
      jobStatus: duplicateJob.status,
      // CONFIRMED means a trade already exists; there is nothing to resume.
      resumable: duplicateJob.status !== "CONFIRMED",
    }
  );
}

async function cleanupFailedUpload({ jobId, uploadedImage, userId, error }) {
  if (!jobId && uploadedImage?.publicId) {
    await cloudinary.uploader.destroy(uploadedImage.publicId, {
      resource_type: "image",
    }).catch((cleanupError) => {
      logger.warn("Failed to delete orphan Cloudinary upload", {
        publicId: uploadedImage.publicId,
        error: cleanupError.message,
      });
    });
  }

  logger.error("Upload enqueue error", {
    userId,
    jobId,
    error: error.message,
    stack: error.stack,
  });
}

async function submitTradeUpload({ user, body, query, uploadedImage, file }) {
  let jobId = null;
  let claimedFreeUpload = false;

  try {
    if (!user) {
      throw new ApiError(401, "Not authorized, user missing", "AUTH_FAILED");
    }

    if (!uploadedImage?.imageUrl) {
      throw new ApiError(400, "Image file is required.", "VALIDATION_ERROR");
    }

    // Checked before the free-upload claim below so a duplicate never burns
    // a user's one-time free upload.
    const duplicateJob = await findDuplicateUploadJob(user._id, uploadedImage.imageHash);
    if (duplicateJob) {
      throw buildDuplicateError(duplicateJob);
    }

    // Uses the same premium definition as the rest of the app (paid
    // subscription OR active trial OR admin) -- a locally re-implemented
    // subscription-only check previously ignored trial status and blocked
    // trialing users from uploading past their one free upload.
    if (!isPremium(user)) {
      // Atomic claim before any work: prevents two concurrent requests from
      // both passing a stale `user.freeUploadUsed === false` check.
      claimedFreeUpload = await userRepository.claimFreeUpload(user._id);
      if (!claimedFreeUpload) {
        throw new ApiError(
          403,
          "Subscription required",
          "PAYMENT_REQUIRED",
          "You have used your free upload. Please subscribe for Rs 150 for 3 months to continue."
        );
      }
    }

    if (!isRedisReady()) {
      throw new ApiError(
        503,
        "OCR queue is temporarily unavailable. Please try again in a moment.",
        "OCR_QUEUE_UNAVAILABLE",
        null,
        true // safe, actionable wording — don't let the 5xx mask hide it
      );
    }

    const allowedMarketTypes = new Set(["Forex", "Indian_Market"]);
    const rawMarketType = String(body.marketType || query.marketType || "Forex").trim();
    if (!allowedMarketTypes.has(rawMarketType)) {
      throw new ApiError(400, "Invalid marketType. Allowed: Forex, Indian_Market", "VALIDATION_ERROR");
    }
    const marketType = rawMarketType;

    const tradeSubTypeRaw = String(body.tradeSubType || query.tradeSubType || "").trim().toUpperCase();
    const tradeSubType = marketType === "Indian_Market" && tradeSubTypeRaw === "EQUITY" ? "EQUITY" : "OPTION";

    const brokerOverrideRaw = String(body.broker || query.broker || "")
      .trim()
      .replace(/[^\w\s\-.()/]/g, "")
      .slice(0, BROKER_MAX_LENGTH);
    const brokerOverride =
      brokerOverrideRaw && brokerOverrideRaw.toUpperCase() !== "AUTO"
        ? brokerOverrideRaw
        : null;

    const requestedTradeDateRaw = String(body.tradeDate || query.tradeDate || "").trim();
    const requestedTradeDate = requestedTradeDateRaw
      ? normalizeTradeDate(requestedTradeDateRaw, { accountCreatedAt: user.createdAt })
      : new Date();

    logger.info("OCR image received for processing", {
      originalName: uploadedImage.originalName || file?.originalname,
      mimeType: uploadedImage.mimeType || file?.mimetype,
      bytes: uploadedImage.bytes || file?.size,
      marketType,
      userId: user._id,
    });

    const job = await createOcrJob({
      user,
      uploadedImage,
      marketType,
      tradeSubType,
      broker: brokerOverride,
      requestedTradeDate,
    });
    jobId = job.jobId;

    return {
      success: true,
      jobId,
      status: "PENDING",
    };
  } catch (error) {
    // If we claimed the free upload but never managed to enqueue the job,
    // release the claim so the user isn't billed-by-loss for our failure.
    if (claimedFreeUpload && !jobId) {
      try {
        await userRepository.releaseFreeUpload(user._id);
      } catch (releaseErr) {
        logger.error("Failed to release free upload claim after error", {
          userId: user._id,
          error: releaseErr.message,
        });
      }
    }
    await cleanupFailedUpload({
      jobId,
      uploadedImage,
      userId: user?._id?.toString(),
      error,
    });
    throw error;
  }
}

async function getUploadJobStatus(userId, jobId) {
  if (!mongoose.Types.ObjectId.isValid(jobId)) {
    throw new ApiError(404, "Job not found or unauthorized", "NOT_FOUND");
  }
  return getOcrJobStatus(userId, jobId);
}

async function cancelUploadJob(userId, jobId) {
  if (!mongoose.Types.ObjectId.isValid(jobId)) {
    throw new ApiError(404, "Job not found or unauthorized", "NOT_FOUND");
  }
  return cancelOcrJob(userId, jobId);
}

async function getUploadQueueHealth() {
  if (!isRedisReady()) {
    return {
      redisReady: false,
      queueReady: false,
      counts: null,
    };
  }

  const counts = await ocrQueue.getJobCounts(
    "waiting",
    "active",
    "delayed",
    "failed",
    "completed",
    "paused",
    "prioritized"
  );

  return {
    redisReady: true,
    queueReady: true,
    counts,
  };
}

module.exports = {
  cancelUploadJob,
  getUploadQueueHealth,
  getUploadJobStatus,
  submitTradeUpload,
};
