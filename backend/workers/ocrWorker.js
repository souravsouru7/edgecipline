require("dotenv").config();

const { UnrecoverableError, Worker } = require("bullmq");
const connectDB = require("../config/db");
const { appConfig } = require("../config");
const { connectRedis, bullmqConnection } = require("../config/redis");
const { OCR_QUEUE_NAME } = require("../queues/ocrQueue");
const { isNonRetryableOcrError, processOcrJob } = require("../services/ocrJob.service");
const { logger } = require("../utils/logger");
const { jobFailureTracker } = require("../utils/jobFailureTracker");

let workerInstance = null;
let shutdownHandlersBound = false;

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
    const ocrJobId = job.data.jobId || job.data.tradeId || job.id;
    const userId = job.data.userId;

    logger.info(`OCR job started | id=${job.id} | jobId=${ocrJobId}`, {
      jobId: job.id,
      ocrJobId,
      userId,
      payload: {
        jobId: job.data.jobId || null,
        tradeId: job.data.tradeId || null,
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
    }
  );

  workerInstance.on("completed", (job) => {
    logger.info(`OCR job completed event fired | id=${job.id} | jobId=${job.data.jobId || job.data.tradeId}`, {
      jobId: job.id,
      ocrJobId: job.data.jobId || job.data.tradeId,
      timestamp: new Date().toISOString(),
    });
  });

  workerInstance.on("failed", (job, err) => {
    const ocrJobId = job?.data?.jobId || job?.data?.tradeId;
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
    mode,
  });

  console.log(`OCR worker running (${mode}).`);

  return workerInstance;
}

if (require.main === module) {
  startOcrWorker({ initializeConnections: true, mode: "standalone" }).catch((error) => {
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
