"use strict";

require("dotenv").config();
const {
  captureOperationalError,
  initSentry,
} = require("../config/sentry");
initSentry({ processName: "trading-dna-worker" });

const { UnrecoverableError, Worker } = require("bullmq");
const connectDB = require("../config/db");
const { appConfig } = require("../config");
const { connectRedis, bullmqConnection } = require("../config/redis");
const { TRADING_DNA_QUEUE_NAME } = require("../queues/tradingDnaQueue");
const tradingDnaService = require("../services/tradingDnaService");
const { logger } = require("../utils/logger");
const { jobFailureTracker } = require("../utils/jobFailureTracker");

let workerInstance = null;
let shutdownHandlersBound = false;
let crashGuardsBound = false;

// Errors a retry cannot fix. Surfaced via ApiError errorCode from the service.
const NON_RETRYABLE_ERROR_CODES = new Set([
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "UNAUTHORIZED",
]);

function isNonRetryableError(error) {
  if (!error) return false;
  if (error.nonRetryable) return true;
  if (error.errorCode && NON_RETRYABLE_ERROR_CODES.has(error.errorCode)) return true;
  if (typeof error.statusCode === "number" && error.statusCode >= 400 && error.statusCode < 500) {
    return true;
  }
  return false;
}

function bindCrashGuards() {
  if (crashGuardsBound) return;

  // Same rationale as the OCR worker: a stray rejection from Gemini's HTTP
  // socket or a slow Mongo write must not crash the worker process and
  // strand in-flight jobs. Log, ship to Sentry, keep running — BullMQ retries
  // per the configured policy.
  process.on("unhandledRejection", (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    logger.error("Trading DNA worker unhandled rejection (suppressed)", {
      reason: error.message,
      stack: error.stack,
    });
    captureOperationalError(error, {
      subsystem: "trading-dna-worker",
      tags: { kind: "unhandled_rejection" },
    });
  });

  process.on("uncaughtException", (error) => {
    logger.error("Trading DNA worker uncaught exception (suppressed)", {
      error: error?.message || String(error),
      stack: error?.stack,
    });
    captureOperationalError(error, {
      subsystem: "trading-dna-worker",
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
    const { userId, marketType, periodType, force } = job.data || {};

    logger.info(`Trading DNA job started | id=${job.id}`, {
      jobId: job.id,
      userId,
      marketType,
      periodType,
      attempt: job.attemptsMade + 1,
      timestamp: new Date().toISOString(),
    });

    try {
      if (!userId || !marketType || !periodType) {
        const error = new Error("Trading DNA worker payload missing required fields");
        error.code = "TRADING_DNA_INVALID_PAYLOAD";
        error.nonRetryable = true;
        throw error;
      }

      await job.updateProgress({
        stage: "computing-signals",
        attempt: job.attemptsMade + 1,
      });

      // The service handles its own 24h lockout via generateNowOnce, but
      // when running from the worker we pass force=true to bypass — the
      // controller already enforced the lockout (or the user opted out)
      // before enqueueing.
      const report = await tradingDnaService.generateReport({
        userId,
        marketType,
        periodType,
      });

      await job.updateProgress({
        stage: "completed",
        attempt: job.attemptsMade + 1,
      });

      logger.info(`Trading DNA job completed | id=${job.id}`, {
        jobId: job.id,
        reportId: report?._id?.toString?.() || null,
        userId,
        marketType,
        periodType,
        timestamp: new Date().toISOString(),
      });

      return {
        reportId: report?._id?.toString?.() || null,
        aiModel: report?.aiModel || null,
        promptVersion: report?.promptVersion || null,
        force: Boolean(force),
      };
    } catch (error) {
      captureOperationalError(error, {
        subsystem: "trading-dna",
        tags: { event: "job_failed", attempt: job.attemptsMade + 1 },
        extra: { jobId: job.id, marketType, periodType },
        userId,
      });
      jobFailureTracker.recordFailure(job.id, error, "trading-dna");

      logger.error(`Trading DNA job failed | id=${job.id}`, {
        jobId: job.id,
        userId,
        marketType,
        periodType,
        error: error.message,
        stack: error.stack,
        attempt: job.attemptsMade + 1,
      });

      if (isNonRetryableError(error)) {
        throw new UnrecoverableError(error.message);
      }
      throw error;
    }
  };
}

async function startTradingDnaWorker({
  initializeConnections = true,
  mode = "standalone",
} = {}) {
  if (workerInstance) return workerInstance;

  bindCrashGuards();

  if (initializeConnections) {
    await connectDB();
    await connectRedis();
  }

  workerInstance = new Worker(TRADING_DNA_QUEUE_NAME, createProcessor(), {
    connection: bullmqConnection,
    concurrency: appConfig.tradingDnaWorker.concurrency,
    lockDuration: appConfig.tradingDnaWorker.lockDurationMs,
    maxStalledCount: appConfig.tradingDnaWorker.maxStalledCount,
  });

  workerInstance.on("completed", (job) => {
    logger.info(`Trading DNA job completed event | id=${job.id}`, {
      jobId: job.id,
      reportId: job.returnvalue?.reportId || null,
      timestamp: new Date().toISOString(),
    });
  });

  workerInstance.on("failed", (job, err) => {
    if (job && job.attemptsMade >= job.opts.attempts) {
      logger.error("Trading DNA job permanently failed; retries exhausted", {
        jobId: job?.id,
        attempts: job.attemptsMade,
        error: err?.message,
      });
    } else {
      logger.error(`Trading DNA job failed event | id=${job?.id}`, {
        jobId: job?.id,
        error: err?.message,
        stack: err?.stack,
      });
    }
  });

  workerInstance.on("stalled", (jobId) => {
    logger.error("Trading DNA job stalled", { jobId });
  });

  workerInstance.on("error", (error) => {
    captureOperationalError(error, {
      subsystem: "trading-dna",
      tags: { event: "worker_error" },
    });
    logger.error("Trading DNA worker runtime error", {
      error: error.message,
      stack: error.stack,
    });
  });

  bindShutdownHandlers();

  logger.info("Trading DNA worker started", {
    timestamp: new Date().toISOString(),
    pid: process.pid,
    queueName: TRADING_DNA_QUEUE_NAME,
    concurrency: appConfig.tradingDnaWorker.concurrency,
    lockDurationMs: appConfig.tradingDnaWorker.lockDurationMs,
    maxStalledCount: appConfig.tradingDnaWorker.maxStalledCount,
    mode,
  });

  console.log(`Trading DNA worker running (${mode}).`);

  return workerInstance;
}

if (require.main === module) {
  startTradingDnaWorker().catch((error) => {
    logger.error("Trading DNA worker failed to start", {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  });
}

module.exports = {
  isNonRetryableError,
  startTradingDnaWorker,
};
