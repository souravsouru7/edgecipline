require("dotenv").config();
const {
  captureOperationalError,
  initSentry,
} = require("../config/sentry");
initSentry({ processName: "ocr-worker" });

const { UnrecoverableError, Worker } = require("bullmq");
const connectDB = require("../config/db");
const { appConfig } = require("../config");
const { connectRedis, bullmqConnection } = require("../config/redis");
const { OCR_QUEUE_NAME } = require("../queues/ocrQueue");
const { enqueueNotificationDelivery } = require("../queues/smartNotificationQueue");
const { isNonRetryableOcrError, processOcrJob } = require("../services/ocrJob.service");
const { logger } = require("../utils/logger");
const { jobFailureTracker } = require("../utils/jobFailureTracker");

let workerInstance = null;
let shutdownHandlersBound = false;
let crashGuardsBound = false;

function bindCrashGuards() {
  if (crashGuardsBound) return;

  // Without these, a stray unhandled rejection from anywhere in the OCR
  // pipeline (Gemini HTTP socket, Mongo write, timed-out promise that
  // settles after the race) would crash the worker process and trigger a
  // PM2 restart, leaving in-flight jobs stuck. Log to Sentry and keep
  // running — BullMQ will retry the affected job per its retry policy.
  //
  // NOTE: we deliberately do NOT call bindFatalHandlers here. That helper
  // registers process.exit(1) on the same events, which would defeat the
  // suppression below (both listeners fire; exit wins).
  process.on("unhandledRejection", (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    logger.error("OCR worker unhandled rejection (suppressed)", {
      reason: error.message,
      stack: error.stack,
    });
    captureOperationalError(error, {
      subsystem: "ocr-worker",
      tags: { kind: "unhandled_rejection" },
    });
  });

  process.on("uncaughtException", (error) => {
    logger.error("OCR worker uncaught exception (suppressed)", {
      error: error?.message || String(error),
      stack: error?.stack,
    });
    captureOperationalError(error, {
      subsystem: "ocr-worker",
      tags: { kind: "uncaught_exception" },
    });
  });

  crashGuardsBound = true;
}

function bindShutdownHandlers() {
  if (shutdownHandlersBound) return;

  const shutdown = async () => {
    if (workerInstance) {
      await workerInstance.close();
      workerInstance = null;
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  shutdownHandlersBound = true;
}

function createProcessor() {
  return async (job) => {
    const ocrJobId = job.data.jobId || job.id;
    const userId = job.data.userId;

    logger.info(`OCR job started | id=${job.id} | jobId=${ocrJobId}`, {
      jobId: job.id,
      ocrJobId,
      userId,
      payload: {
        jobId: job.data.jobId || null,
        imageUrl: Boolean(job.data.imageUrl),
        marketType: job.data.marketType || null,
      },
      attempt: job.attemptsMade + 1,
      timestamp: new Date().toISOString(),
    });

    try {
      if (!ocrJobId) {
        const error = new Error("OCR worker payload missing jobId");
        error.code = "OCR_INVALID_PAYLOAD";
        error.nonRetryable = true;
        throw error;
      }

      await job.updateProgress({
        stage: "processing",
        attempt: job.attemptsMade + 1,
      });

      const result = await processOcrJob(ocrJobId, {
        queueJobId: job.id,
        attempt: job.attemptsMade + 1,
      });

      await enqueueNotificationDelivery({
        userId,
        notification: {
          type: "ocr_completed",
          title: "Trade extraction ready",
          body: "Your screenshot has been processed. Review the extracted values before saving.",
          deepLink: job.data.marketType === "Indian_Market"
            ? "/indian-market/upload-trade"
            : "/upload-trade",
          data: { ocrJobId: String(ocrJobId), screen: "upload-trade" },
          sourceType: "ocr_job",
          sourceId: String(ocrJobId),
          dedupeKey: `ocr-completed:${ocrJobId}`,
        },
      });

      await job.updateProgress({
        stage: "completed",
        attempt: job.attemptsMade + 1,
      });

      logger.info(`OCR job completed successfully | id=${job.id} | jobId=${ocrJobId}`, {
        jobId: job.id,
        ocrJobId,
        timestamp: new Date().toISOString(),
      });

      return result;
    } catch (error) {
      const permanentFailure = isNonRetryableOcrError(error)
        || job.attemptsMade + 1 >= (job.opts.attempts || 1);
      if (permanentFailure && ocrJobId && userId) {
        try {
          await enqueueNotificationDelivery({
            userId,
            notification: {
              type: "ocr_failed",
              title: "Trade extraction needs attention",
              body: "We could not process this screenshot. Open the upload screen to retry.",
              deepLink: job.data.marketType === "Indian_Market"
                ? "/indian-market/upload-trade"
                : "/upload-trade",
              data: { ocrJobId: String(ocrJobId), screen: "upload-trade" },
              sourceType: "ocr_job",
              sourceId: String(ocrJobId),
              dedupeKey: `ocr-failed:${ocrJobId}`,
            },
          });
        } catch (notificationError) {
          captureOperationalError(notificationError, {
            subsystem: "notifications",
            tags: { event: "ocr_outcome_enqueue_failed" },
            extra: { ocrJobId },
            userId,
          });
          logger.error("OCR_OUTCOME_NOTIFICATION_ENQUEUE_FAILED", {
            ocrJobId,
            userId,
            error: notificationError.message,
          });
        }
      }
      captureOperationalError(error, {
        subsystem: "ocr",
        tags: { event: "job_failed", attempt: job.attemptsMade + 1 },
        extra: { jobId: job.id, ocrJobId },
        userId,
      });
      jobFailureTracker.recordFailure(job.id, error, ocrJobId);

      logger.error(`OCR job failed | id=${job.id} | jobId=${ocrJobId}`, {
        jobId: job.id,
        ocrJobId,
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString(),
      });
      if (isNonRetryableOcrError(error)) {
        throw new UnrecoverableError(error.message);
      }
      throw error;
    }
  };
}

async function startOcrWorker({ initializeConnections = true, mode = "standalone" } = {}) {
  if (workerInstance) {
    return workerInstance;
  }

  bindCrashGuards();

  if (initializeConnections) {
    await connectDB();
    await connectRedis();
  }

  workerInstance = new Worker(
    OCR_QUEUE_NAME,
    createProcessor(),
    {
      connection: bullmqConnection,
      concurrency: appConfig.ocrWorker.concurrency,
      lockDuration: appConfig.ocrWorker.lockDurationMs,
      maxStalledCount: appConfig.ocrWorker.maxStalledCount,
    }
  );

  workerInstance.on("completed", (job) => {
    logger.info(`OCR job completed event fired | id=${job.id} | jobId=${job.data.jobId || job.id}`, {
      jobId: job.id,
      ocrJobId: job.data.jobId || job.id,
      timestamp: new Date().toISOString(),
    });
  });

  workerInstance.on("failed", (job, err) => {
    const ocrJobId = job?.data?.jobId || job?.id;
    if (job && job.attemptsMade >= job.opts.attempts) {
      logger.error("OCR job permanently failed; all retries exhausted", {
        ocrJobId,
        jobId: job?.id,
        attempts: job.attemptsMade,
        error: err?.message,
      });
    } else {
      logger.error(`OCR job failed event fired | id=${job?.id} | jobId=${ocrJobId}`, {
        jobId: job?.id,
        ocrJobId,
        error: err?.message,
        stack: err?.stack,
        timestamp: new Date().toISOString(),
      });
    }
  });

  workerInstance.on("stalled", (jobId) => {
    logger.error("OCR job stalled", {
      jobId,
      timestamp: new Date().toISOString(),
    });
  });

  workerInstance.on("error", (error) => {
    captureOperationalError(error, { subsystem: "ocr", tags: { event: "worker_error" } });
    logger.error("OCR worker runtime error", {
      error: error.message,
      stack: error.stack,
    });
  });

  bindShutdownHandlers();

  logger.info("OCR worker started successfully", {
    timestamp: new Date().toISOString(),
    pid: process.pid,
    queueName: OCR_QUEUE_NAME,
    concurrency: appConfig.ocrWorker.concurrency,
    lockDurationMs: appConfig.ocrWorker.lockDurationMs,
    maxStalledCount: appConfig.ocrWorker.maxStalledCount,
    mode,
  });

  console.log(`OCR worker running (${mode}).`);

  return workerInstance;
}

if (require.main === module) {
  startOcrWorker({ initializeConnections: true, mode: "standalone" }).catch((error) => {
    captureOperationalError(error, { level: "fatal", subsystem: "ocr", tags: { event: "bootstrap_failed" } });
    logger.error("Failed to start OCR worker", {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  });
}

module.exports = {
  startOcrWorker,
};
