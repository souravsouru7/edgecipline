const mongoose = require("mongoose");
const cloudinary = require("../config/cloudinary");
const ApiError = require("../utils/ApiError");
const { enqueueOcrJob, getOcrJobSnapshot } = require("../queues/ocrQueue");
const { clearUserCache } = require("../utils/cacheUtils");
const tradeRepository = require("../repositories/trade.repository");
const userRepository = require("../repositories/user.repository");
const { logger } = require("../utils/logger");
const { normalizeTradeDate } = require("../utils/dateUtils");

const BROKER_MAX_LENGTH = 50;

async function cleanupFailedUpload({ tradeId, uploadedImage, userId, error }) {
  if (!tradeId && uploadedImage?.publicId) {
    await cloudinary.uploader.destroy(uploadedImage.publicId, {
      resource_type: "image",
    }).catch((cleanupError) => {
      logger.warn("Failed to delete orphan Cloudinary upload", {
        publicId: uploadedImage.publicId,
        error: cleanupError.message,
      });
    });
  }

  if (tradeId) {
    await tradeRepository.updateTradeById(tradeId, {
      status: "failed",
      error: error.message,
      processedAt: new Date(),
    }).catch((err) => logger.error("cleanupFailedUpload DB error", { error: err.message, tradeId }));
  }

  logger.error("Upload enqueue error", {
    userId,
    tradeId,
    error: error.message,
    stack: error.stack,
  });
}

async function submitTradeUpload({ user, body, query, uploadedImage, file }) {
  let tradeId = null;

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

    const ALLOWED_MARKET_TYPES = new Set(["Forex", "Indian_Market"]);
    const rawMarketType = String(body.marketType || query.marketType || "Forex").trim();
    if (!ALLOWED_MARKET_TYPES.has(rawMarketType)) {
      throw new ApiError(400, "Invalid marketType. Allowed: Forex, Indian_Market", "VALIDATION_ERROR");
    }
    const marketType = rawMarketType;

    const tradeSubTypeRaw = String(body.tradeSubType || query.tradeSubType || "").trim().toUpperCase();
    const tradeSubType = (marketType === "Indian_Market" && tradeSubTypeRaw === "EQUITY") ? "EQUITY" : "OPTION";

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

    logger.info("File received for processing", {
      originalName: uploadedImage.originalName || file?.originalname,
      mimeType: uploadedImage.mimeType || file?.mimetype,
      bytes: uploadedImage.bytes || file?.size,
      marketType,
      userId: user._id,
    });

    let trade;
    try {
      trade = await tradeRepository.createTrade({
        user: user._id,
        screenshot: uploadedImage.imageUrl,
        imageUrl: uploadedImage.imageUrl,
        marketType,
        tradeSubType,
        broker: brokerOverride || "",
        tradeDate: requestedTradeDate,
        status: "pending",
        queuedAt: new Date(),
        error: null,
      });
    } catch (createError) {
      if (uploadedImage?.publicId) {
        await cloudinary.uploader.destroy(uploadedImage.publicId, { resource_type: "image" }).catch(() => {});
      }
      throw createError;
    }

    tradeId = trade._id.toString();

    const job = await enqueueOcrJob({
      tradeId,
      imageUrl: uploadedImage.imageUrl,
      userId: user._id,
      marketType,
      broker: brokerOverride,
    });

    await tradeRepository.updateTradeById(tradeId, {
      ocrJobId: job.id,
      ocrJobName: job.name,
      status: "processing",
      processingStartedAt: new Date(),
      ocrAttempts: job.attemptsMade,
    });

    if (!isSubscribed) {
      try {
        await userRepository.markFreeUploadUsed(user._id);
      } catch (flagErr) {
        // Non-fatal: job is already queued and will process normally.
        // Log so the free upload count can be corrected manually if needed.
        logger.error("Failed to mark free upload used — job still processing", {
          userId: user._id,
          tradeId,
          error: flagErr.message,
        });
      }
    }

    await clearUserCache(user._id);

    return {
      success: true,
      jobId: tradeId,
      status: "processing",
    };
  } catch (error) {
    await cleanupFailedUpload({
      tradeId,
      uploadedImage,
      userId: user?._id?.toString(),
      error,
    });
    throw error;
  }
}

async function getUploadJobStatus(userId, tradeId) {
  if (!mongoose.Types.ObjectId.isValid(tradeId)) {
    throw new ApiError(404, "Job not found or unauthorized", "NOT_FOUND");
  }

  const trade = await tradeRepository.findTradeByIdAndUser(tradeId, userId);
  if (!trade) {
    throw new ApiError(404, "Job not found or unauthorized", "NOT_FOUND");
  }

  const queueState = await getOcrJobSnapshot(trade.ocrJobId || trade._id.toString());

  // Only expose safe fields — never return rawOCRText, aiRawResponse, parsedData, etc.
  const tradeData = trade.status === "completed" ? {
    _id: trade._id,
    pair: trade.pair,
    type: trade.type,
    entryPrice: trade.entryPrice,
    exitPrice: trade.exitPrice,
    stopLoss: trade.stopLoss,
    takeProfit: trade.takeProfit,
    profit: trade.profit,
    commission: trade.commission,
    swap: trade.swap,
    lotSize: trade.lotSize,
    strategy: trade.strategy,
    session: trade.session,
    marketType: trade.marketType,
    broker: trade.broker,
    imageUrl: trade.imageUrl,
    extractionConfidence: trade.extractionConfidence,
    needsReview: trade.needsReview,
    createdAt: trade.createdAt,
    tradeDate: trade.tradeDate,
  } : null;

  return {
    jobId: trade.ocrJobId || trade._id.toString(),
    status: trade.status,
    queueState: queueState?.state || null,
    attemptsMade: queueState?.attemptsMade ?? trade.ocrAttempts ?? 0,
    error: trade.error || queueState?.failedReason || null,
    queuedAt: trade.queuedAt,
    processingStartedAt: trade.processingStartedAt,
    processedAt: trade.processedAt,
    data: tradeData,
  };
}

module.exports = {
  getUploadJobStatus,
  submitTradeUpload,
};
