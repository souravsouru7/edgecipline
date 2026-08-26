const mongoose = require("mongoose");
const cloudinary = require("../config/cloudinary");
const ApiError = require("../utils/ApiError");
const { OCRJob } = require("../models/OCRJob");
const { enqueueOcrJob, getOcrJobSnapshot, ocrQueue } = require("../queues/ocrQueue");
const { processTradeUpload, getFriendlyProcessingError } = require("./tradeProcessingService");
const { logger } = require("../utils/logger");
const { appConfig } = require("../config");
const User = require("../models/Users");
const userRepository = require("../repositories/user.repository");
const { isPremium } = require("../utils/premium");

const QUEUE_UNAVAILABLE_MESSAGE =
  "The extraction queue is temporarily unavailable. Please upload the screenshot again in a moment.";

const DEFAULT_TTL_HOURS = Number(process.env.OCR_JOB_TTL_HOURS || 24);
const STALE_PENDING_MS = Number(process.env.OCR_STALE_PENDING_MS || 5 * 60 * 1000);
const STALE_PROCESSING_MS = Number(process.env.OCR_STALE_PROCESSING_MS || 12 * 60 * 1000);
const TERMINAL_STATUSES = new Set(["COMPLETED", "CONFIRMED", "FAILED", "CANCELLED"]);

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
      "IMAGE_QUALITY_TOO_LOW",
    ].includes(error?.code);
}

function isPresentNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

// The pipeline always returns a `data` envelope, even when every extracted
// field came back null -- so a truthy `data` is not evidence that anything was
// read. Without this the job is stored as COMPLETED and the client cheerfully
// announces "1 trade extracted" over a blank form. A partially extracted trade
// (symbol but no P&L, say) still counts as usable: that is what the review
// screen is for.
function hasUsableTradeData(data) {
  const rows = Array.isArray(data?.parsedTrades) && data.parsedTrades.length > 0
    ? data.parsedTrades
    : [data?.parsedTrade].filter(Boolean);

  return rows.some((row) => {
    const fields = { ...(row?.data || {}), ...row };
    // stockSymbol is the Indian equity shape; pair/underlying cover forex and F&O.
    const symbol = String(
      fields.pair || fields.symbol || fields.stockSymbol || fields.underlying || ""
    ).trim();
    if (symbol) return true;
    return ["entryPrice", "exitPrice", "profit", "pnl", "quantity", "lotSize", "sharesQty", "strikePrice"]
      .some((key) => isPresentNumber(fields[key]));
  });
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
    imageHash: uploadedImage.imageHash || "",
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
    // The raw failure here is a Redis/BullMQ internal (Lua script text, OOM
    // codes). It is useful in the logs and meaningless -- and leaky -- in an
    // API response, so the job carries a retryable message instead.
    job.status = "FAILED";
    job.error = QUEUE_UNAVAILABLE_MESSAGE;
    job.processedAt = new Date();
    await job.save();

    logger.error("Failed to enqueue OCR job", {
      jobId: job._id.toString(),
      userId: user._id?.toString?.() || user._id,
      error: error.message,
    });

    throw new ApiError(503, QUEUE_UNAVAILABLE_MESSAGE, "OCR_QUEUE_UNAVAILABLE", null, true);
  }

  job.queueJobId = queueJob.id;
  job.queueJobName = queueJob.name;
  job.attemptsMade = queueJob.attemptsMade || 0;
  await job.save();

  return serializeJob(job, await getOcrJobSnapshot(queueJob.id));
}

// A free-tier user gets exactly one upload. Spending it on a screenshot the
// pipeline itself refuses (poor quality, wrong market, unreadable) leaves them
// permanently blocked having received nothing, so the claim goes back when the
// job ends in a terminal failure and the account has never had a successful
// extraction. Best-effort: never let this break the failure path itself.
async function restoreFreeUploadAfterFailure(job) {
  if (!job?.user) return;
  try {
    const user = await User.findById(job.user)
      .select("role subscriptionStatus subscriptionPlan subscriptionExpiry trial freeUploadUsed")
      .lean();
    if (!user || !user.freeUploadUsed || isPremium(user)) return;

    const hadSuccess = await OCRJob.exists({
      user: job.user,
      status: { $in: ["COMPLETED", "CONFIRMED"] },
    });
    if (hadSuccess) return;

    await userRepository.releaseFreeUpload(job.user);
    logger.info("Free upload restored after failed extraction", {
      jobId: job._id?.toString?.(),
      userId: job.user?.toString?.() || job.user,
    });
  } catch (error) {
    logger.warn("Failed to restore free upload after failed extraction", {
      jobId: job._id?.toString?.(),
      error: error.message,
    });
  }
}

async function getOcrJobForUser(userId, jobId) {
  assertObjectId(jobId);
  const job = await OCRJob.findOne({ _id: jobId, user: userId });
  if (!job) {
    throw new ApiError(404, "OCR job not found or unauthorized", "NOT_FOUND");
  }
  return job;
}

function extractConfirmationTrades(job) {
  const data = job?.extractedData || {};
  if (Array.isArray(data.parsedTrades) && data.parsedTrades.length > 0) {
    return data.parsedTrades;
  }
  return data.parsedTrade ? [data.parsedTrade] : [];
}

async function getOcrConfirmationTrades(userId, jobId, expectedMarketType) {
  const job = await getOcrJobForUser(userId, jobId);
  if (job.status !== "COMPLETED" && job.status !== "CONFIRMED") {
    throw new ApiError(409, "OCR job is not ready to confirm", "OCR_JOB_NOT_COMPLETED");
  }
  if (expectedMarketType && job.marketType !== expectedMarketType) {
    throw new ApiError(409, "OCR job market does not match the trade", "OCR_JOB_MARKET_MISMATCH");
  }

  return extractConfirmationTrades(job);
}

// Atomically transitions a completed OCR job to CONFIRMED *before* the
// caller creates the actual Trade document(s). This is the single-writer
// gate: two concurrent confirm attempts on the same completed screenshot
// (e.g. the same tab double-submitting, or two open tabs both confirming)
// can't both win this update -- the loser is rejected here, before it ever
// creates a duplicate Trade, instead of both silently succeeding and
// leaving two Trade documents behind with the OCRJob only remembering
// whichever one happened to write last.
async function claimOcrJobForConfirmation(userId, jobId, expectedMarketType) {
  if (!jobId) return null;
  assertObjectId(jobId);
  const existing = await getOcrJobForUser(userId, jobId);
  if (expectedMarketType && existing.marketType !== expectedMarketType) {
    throw new ApiError(409, "OCR job market does not match the trade", "OCR_JOB_MARKET_MISMATCH");
  }
  if (existing.status !== "COMPLETED" && existing.status !== "CONFIRMED") {
    throw new ApiError(409, "OCR job is not ready to confirm", "OCR_JOB_NOT_COMPLETED");
  }

  const claimed = await OCRJob.findOneAndUpdate(
    { _id: jobId, user: userId, status: "COMPLETED" },
    { $set: { status: "CONFIRMED", confirmedAt: new Date() } },
    { new: true }
  );
  if (!claimed) {
    throw new ApiError(
      409,
      "This screenshot has already been confirmed and saved as a trade.",
      "OCR_JOB_ALREADY_CONFIRMED"
    );
  }
  return claimed;
}

// If Trade creation fails after claimOcrJobForConfirmation() already
// succeeded (e.g. a validation error on the trade payload), the job would
// otherwise be stuck "confirmed" with no trade behind it -- release the
// claim back to COMPLETED so the user can retry. The confirmedTradeId
// guard skips the release if some other path already finalized it.
async function releaseOcrJobClaim(userId, jobId) {
  if (!jobId) return;
  try {
    await OCRJob.updateOne(
      { _id: jobId, user: userId, status: "CONFIRMED", confirmedTradeId: null },
      { $set: { status: "COMPLETED" }, $unset: { confirmedAt: "" } }
    );
  } catch (error) {
    logger.warn("Failed to release OCR job claim after trade-creation failure", {
      jobId,
      userId: userId?.toString?.() || userId,
      error: error.message,
    });
  }
}

async function recoverMissingQueueJob(job, userId) {
  const jobId = job._id.toString();
  const recoveryAttempts = Number(job.queueRecoveryAttempts || 0);
  if (recoveryAttempts >= appConfig.ocrQueue.maxRecoveryAttempts) {
    const failed = await OCRJob.findOneAndUpdate(
      { _id: job._id, user: userId, status: { $in: ["PENDING", "PROCESSING"] } },
      {
        $set: {
          status: "FAILED",
          error: "OCR queue recovery was exhausted. Please upload the screenshot again.",
          processedAt: new Date(),
          expiresAt: getExpiryDate(),
        },
      },
      { new: true }
    );
    const latest = failed || await OCRJob.findOne({ _id: job._id, user: userId });
    return serializeJob(latest);
  }

  const queueJob = await enqueueOcrJob({
    jobId,
    imageUrl: job.uploadedImage?.imageUrl,
    userId: job.user,
    marketType: job.marketType,
    broker: job.broker,
  });
  const recovered = await OCRJob.findOneAndUpdate(
    { _id: job._id, user: userId, status: { $in: ["PENDING", "PROCESSING"] } },
    {
      $set: {
        status: "PENDING",
        queueJobId: queueJob.id,
        queueJobName: queueJob.name,
        processingStartedAt: null,
        processedAt: null,
        attemptsMade: 0,
        error: null,
        expiresAt: getExpiryDate(),
      },
      $inc: { queueRecoveryAttempts: 1 },
    },
    { new: true }
  );

  if (!recovered) {
    const latest = await OCRJob.findOne({ _id: job._id, user: userId });
    return serializeJob(latest);
  }

  logger.warn("Recovered missing OCR queue job from MongoDB", {
    jobId,
    queueJobId: queueJob.id,
    userId: userId?.toString?.() || userId,
    recoveryAttempt: recoveryAttempts + 1,
  });
  return serializeJob(recovered, await getOcrJobSnapshot(queueJob.id));
}

async function getOcrJobStatus(userId, jobId) {
  let job = await getOcrJobForUser(userId, jobId);
  if (TERMINAL_STATUSES.has(job.status)) {
    return serializeJob(job);
  }

  let queueState = null;
  try {
    queueState = job.queueJobId ? await getOcrJobSnapshot(job.queueJobId) : null;
  } catch (error) {
    logger.warn("OCR queue state unavailable; returning durable MongoDB status", {
      jobId,
      queueJobId: job.queueJobId,
      userId: userId?.toString?.() || userId,
      error: error.message,
    });
    return { ...serializeJob(job), queueUnavailable: true };
  }

  if (
    (job.status === "PENDING" || job.status === "PROCESSING") &&
    !queueState
  ) {
    const ageMs = Date.now() - new Date(job.processingStartedAt || job.createdAt).getTime();
    const staleMs = job.status === "PROCESSING" ? STALE_PROCESSING_MS : STALE_PENDING_MS;
    if (ageMs >= staleMs) {
      return recoverMissingQueueJob(job, userId);
    }
  }

  if (queueState?.state === "failed" && isLegacyDraftTradeFailure(queueState, job)) {
    return requeueLegacyDraftFailure(job, queueState);
  }
  if (
    queueState?.state === "failed" &&
    (job.status === "PENDING" || job.status === "PROCESSING")
  ) {
    const reconciled = await OCRJob.findOneAndUpdate(
      { _id: job._id, user: userId, status: { $in: ["PENDING", "PROCESSING"] } },
      {
        $set: {
          status: "FAILED",
          error: job.error || queueState.failedReason || "OCR processing failed",
          processedAt: job.processedAt || new Date(),
          attemptsMade: Math.max(job.attemptsMade || 0, queueState.attemptsMade || 0),
          expiresAt: getExpiryDate(),
        },
      },
      { new: true }
    );
    if (!reconciled) {
      job = await getOcrJobForUser(userId, jobId);
      return serializeJob(job);
    }
    job = reconciled;
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
    const processing = await OCRJob.findOneAndUpdate(
      { _id: job._id, user: userId, status: "PENDING" },
      {
        $set: {
          status: "PROCESSING",
          processingStartedAt: job.processingStartedAt || new Date(queueState.processedOn || Date.now()),
          attemptsMade: Math.max(job.attemptsMade || 0, queueState.attemptsMade || 0),
        },
      },
      { new: true }
    );
    job = processing || await getOcrJobForUser(userId, jobId);
  }

  return serializeJob(job, queueState);
}

async function cancelOcrJob(userId, jobId) {
  const job = await getOcrJobForUser(userId, jobId);
  if (job.status === "CONFIRMED" || job.status === "COMPLETED") {
    logger.info("OCR cancel ignored for terminal successful job", {
      jobId: job._id.toString(),
      status: job.status,
      userId: userId?.toString?.() || userId,
    });
    return serializeJob(job);
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

  let job = await OCRJob.findById(jobId);
  if (!job) {
    logger.error("OCR worker could not find OCRJob document", {
      jobId,
      queueJobId,
      attempt,
    });
    throw createNonRetryableOcrError("OCR job not found", "OCR_JOB_NOT_FOUND");
  }
  if (TERMINAL_STATUSES.has(job.status)) {
    return serializeJob(job);
  }

  // Atomic, status-guarded stamp: if the job was cancelled (or otherwise hit
  // a terminal state) between the read above and this write, this update
  // matches nothing -- a plain findById+mutate+save here would otherwise be
  // able to silently resurrect a cancelled job back into PROCESSING.
  const stamped = await OCRJob.findOneAndUpdate(
    { _id: jobId, status: { $nin: Array.from(TERMINAL_STATUSES) } },
    {
      $set: {
        status: "PROCESSING",
        processingStartedAt: job.processingStartedAt || new Date(),
        attemptsMade: attempt,
        queueJobId: queueJobId || job.queueJobId || job._id.toString(),
        error: null,
      },
    },
    { new: true }
  );
  if (!stamped) {
    const current = await OCRJob.findById(jobId);
    return current ? serializeJob(current) : serializeJob(job);
  }
  job = stamped;

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

    const preCheck = await OCRJob.findById(jobId);
    if (!preCheck || preCheck.status === "CANCELLED") {
      return preCheck ? serializeJob(preCheck) : result;
    }
    if (!result?.data || !hasUsableTradeData(result.data)) {
      throw createNonRetryableOcrError(
        "We couldn't read any trade details from this screenshot. Please try again in a few minutes, or upload a clearer broker screenshot showing the pair, entry/exit prices and P&L.",
        "OCR_EMPTY_RESULT"
      );
    }

    // Atomic, status-guarded write: if the job was cancelled (or otherwise
    // left PENDING/PROCESSING) concurrently between the read above and this
    // write, this update matches nothing -- unlike a plain findById+mutate+
    // save, it can't silently overwrite a concurrent cancellation with data.
    const completed = await OCRJob.findOneAndUpdate(
      { _id: jobId, status: { $in: ["PENDING", "PROCESSING"] } },
      {
        $set: {
          status: "COMPLETED",
          extractedData: result.data,
          extractionConfidence: result.data?.extractionConfidence || 0,
          broker: result.data?.brokerType || preCheck.broker || "",
          processedAt: new Date(),
          expiresAt: getExpiryDate(),
          error: null,
          attemptsMade: attempt,
        },
      },
      { new: true }
    );
    if (!completed) {
      const current = await OCRJob.findById(jobId);
      return current ? serializeJob(current) : result;
    }
    logger.info("OCR processing completed", {
      jobId,
      queueJobId,
      userId: completed.user?.toString?.() || completed.user,
      marketType: completed.marketType,
      extractionConfidence: completed.extractionConfidence,
      attempt,
    });
    return serializeJob(completed);
  } catch (error) {
    if (isCancellationError(error)) {
      const cancelled = await OCRJob.findOneAndUpdate(
        { _id: jobId, status: { $in: ["PENDING", "PROCESSING"] } },
        {
          $set: {
            status: "CANCELLED",
            cancelledAt: new Date(),
            error: null,
            extractedData: null,
            extractionConfidence: 0,
            attemptsMade: attempt,
          },
        },
        { new: true }
      );
      const latest = cancelled || await OCRJob.findById(jobId);
      return latest ? serializeJob(latest) : { jobId, status: "CANCELLED" };
    }

    const terminalFailure = isNonRetryableOcrError(error) || attempt >= appConfig.ocrQueue.attempts;
    const updated = await OCRJob.findOneAndUpdate(
      { _id: jobId, status: { $in: ["PENDING", "PROCESSING"] } },
      {
        $set: {
          status: terminalFailure ? "FAILED" : "PROCESSING",
          error: terminalFailure ? getFriendlyProcessingError(error) : null,
          processedAt: terminalFailure ? new Date() : null,
          ...(terminalFailure ? { expiresAt: getExpiryDate() } : {}),
          attemptsMade: attempt,
        },
      },
      { new: true }
    );
    const latest = updated || await OCRJob.findById(jobId);
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
    if (terminalFailure && latest) {
      await restoreFreeUploadAfterFailure(latest);
    }
    throw error;
  }
}

async function markOcrJobConfirmed(userId, jobId, { tradeId, collection, session } = {}) {
  if (!jobId) return null;
  assertObjectId(jobId);
  const query = OCRJob.findOne({ _id: jobId, user: userId });
  if (session) query.session(session);
  const job = await query;
  if (!job) {
    throw new ApiError(404, "OCR job not found or unauthorized", "NOT_FOUND");
  }
  if (job.status !== "COMPLETED" && job.status !== "CONFIRMED") {
    throw new ApiError(409, "OCR job is not ready to confirm", "OCR_JOB_NOT_COMPLETED");
  }

  job.status = "CONFIRMED";
  job.confirmedAt = new Date();
  job.confirmedTradeId = tradeId;
  job.confirmedTradeCollection = collection || "";
  await job.save({ session });
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
  claimOcrJobForConfirmation,
  releaseOcrJobClaim,
  extractConfirmationTrades,
  createOcrJob,
  deleteUploadedImageForJob,
  getOcrConfirmationTrades,
  getOcrJobStatus,
  markOcrJobConfirmed,
  isNonRetryableOcrError,
  processOcrJob,
};
