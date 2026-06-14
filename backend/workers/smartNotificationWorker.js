require("dotenv").config();

const { Worker, UnrecoverableError } = require("bullmq");
const connectDB = require("../config/db");
const { appConfig } = require("../config");
const { connectRedis, bullmqConnection } = require("../config/redis");
const { SMART_NOTIFICATION_QUEUE_NAME } = require("../queues/smartNotificationQueue");
const { logger } = require("../utils/logger");

let workerInstance = null;
let shutdownHandlersBound = false;

function bindShutdownHandlers() {
  if (shutdownHandlersBound) return;

  const shutdown = async (signal) => {
    logger.info("SMART_WORKER_SHUTDOWN", { signal });
    if (workerInstance) {
      try { await workerInstance.close(); } catch { /* ignore */ }
      workerInstance = null;
    }
    process.exit(0);
  };

  process.on("SIGINT",  () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  shutdownHandlersBound = true;
}

// The processor is created lazily because the evaluator imports the queue,
// and we cannot import the evaluator at module top-level without creating
// a circular reference. require() inside createProcessor() lands the import
// at first job — after the queue and evaluator modules are both initialised.
function createProcessor() {
  return async (job) => {
    const { userId, tradeId, collection, marketType, timezone } = job.data || {};
    const startedAt = Date.now();

    logger.info("SMART_WORKER_JOB_START", {
      jobId: job.id, userId, tradeId, marketType, attempt: job.attemptsMade + 1,
    });

    if (!userId || !tradeId) {
      // Malformed payload — no point retrying.
      throw new UnrecoverableError("smart notification job missing userId or tradeId");
    }

    // Lazy require — see comment above createProcessor.
    const Trade = require("../models/Trade");
    const IndianTrade = require("../models/IndianTrade");
    const { runAsyncChecks } = require("../services/smartNotificationEvaluator");

    const Model = collection === "indian" ? IndianTrade : Trade;
    const trade = await Model.findById(tradeId).lean();

    if (!trade) {
      // Trade was deleted between enqueue and execution. Don't retry.
      logger.warn("SMART_WORKER_TRADE_MISSING", { jobId: job.id, tradeId, userId });
      return { skipped: true, reason: "trade_missing" };
    }

    const result = await runAsyncChecks({
      userId, trade, collection, marketType, timezone,
    });

    logger.info("SMART_WORKER_JOB_DONE", {
      jobId: job.id,
      userId,
      tradeId,
      durationMs: Date.now() - startedAt,
      checkResults: result,
    });

    return result;
  };
}

async function startSmartNotificationWorker({ initializeConnections = true, mode = "standalone" } = {}) {
  if (workerInstance) return workerInstance;

  if (initializeConnections) {
    await connectDB();
    await connectRedis();
  }

  workerInstance = new Worker(
    SMART_NOTIFICATION_QUEUE_NAME,
    createProcessor(),
    {
      connection:   bullmqConnection,
      concurrency:  appConfig.smartNotificationQueue.concurrency,
      lockDuration: appConfig.smartNotificationQueue.lockDurationMs,
    }
  );

  workerInstance.on("completed", (job, returnValue) => {
    logger.info("SMART_WORKER_COMPLETED", {
      jobId: job.id,
      returnValue,
    });
  });

  workerInstance.on("failed", (job, err) => {
    const attemptsLeft = job ? Math.max(0, job.opts.attempts - job.attemptsMade) : 0;
    const exhausted = job ? job.attemptsMade >= job.opts.attempts : false;

    if (exhausted) {
      // DEAD-LETTER: this entry remains in Redis for 24h (removeOnFail.age)
      // and is queryable via getSmartNotificationQueueMetrics + admin endpoint.
      logger.error("SMART_WORKER_DEAD_LETTER", {
        jobId: job?.id,
        userId: job?.data?.userId,
        tradeId: job?.data?.tradeId,
        attempts: job?.attemptsMade,
        error: err?.message,
        stack: err?.stack,
      });
    } else {
      logger.warn("SMART_WORKER_RETRY_SCHEDULED", {
        jobId: job?.id,
        attempt: job?.attemptsMade,
        attemptsLeft,
        error: err?.message,
      });
    }
  });

  workerInstance.on("stalled", (jobId) => {
    logger.warn("SMART_WORKER_STALLED", { jobId });
  });

  workerInstance.on("error", (error) => {
    logger.error("SMART_WORKER_RUNTIME_ERROR", {
      error: error?.message,
      stack: error?.stack,
    });
  });

  bindShutdownHandlers();

  logger.info("SMART_WORKER_STARTED", {
    pid:          process.pid,
    queueName:    SMART_NOTIFICATION_QUEUE_NAME,
    concurrency:  appConfig.smartNotificationQueue.concurrency,
    lockDurationMs: appConfig.smartNotificationQueue.lockDurationMs,
    mode,
  });

  return workerInstance;
}

if (require.main === module) {
  startSmartNotificationWorker({ initializeConnections: true, mode: "standalone" }).catch((error) => {
    logger.error("SMART_WORKER_BOOTSTRAP_FAILED", {
      error: error?.message,
      stack: error?.stack,
    });
    process.exit(1);
  });
}

module.exports = { startSmartNotificationWorker };
