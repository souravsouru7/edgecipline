const mongoose = require("mongoose");
const cloudinary = require("../config/cloudinary");
const ApiError = require("../utils/ApiError");
const { cancelOcrJob, createOcrJob, getOcrJobStatus } = require("./ocrJob.service");
const userRepository = require("../repositories/user.repository");
const { logger } = require("../utils/logger");
const { normalizeTradeDate } = require("../utils/dateUtils");

const BROKER_MAX_LENGTH = 50;

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

  try {
    if (!user) {
      throw new ApiError(401, "Not authorized, user missing", "AUTH_FAILED");
    }

    const now = new Date();
    const isSubscribed =
      user.subscriptionStatus === "active" &&
      user.subscriptionExpiry &&
      new Date(user.subscriptionExpiry) > now;

    if (!isSubscribed && user.freeUploadUsed) {
      throw new ApiError(
        403,
        "Subscription required",
        "PAYMENT_REQUIRED",
        "You have used your free upload. Please subscribe for Rs 150 for 3 months to continue."
      );
    }

    if (!uploadedImage?.imageUrl) {
      throw new ApiError(400, "Image file is required.", "VALIDATION_ERROR");
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

    if (!isSubscribed) {
      try {
        await userRepository.markFreeUploadUsed(user._id);
      } catch (flagErr) {
        logger.error("Failed to mark free upload used; OCR job still processing", {
          userId: user._id,
          jobId,
          error: flagErr.message,
        });
      }
    }

    return {
      success: true,
      jobId,
      status: "PROCESSING",
    };
  } catch (error) {
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

module.exports = {
  cancelUploadJob,
  getUploadJobStatus,
  submitTradeUpload,
};
