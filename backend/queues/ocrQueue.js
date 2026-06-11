const { Queue } = require("bullmq");
const { appConfig } = require("../config");
const { bullmqConnection } = require("../config/redis");
const { logger } = require("../utils/logger");

const OCR_QUEUE_NAME = appConfig.ocrQueue.name;
const OCR_JOB_NAME = "processOcrJob";
const ocrQueue = new Queue(OCR_QUEUE_NAME, {
  connection: bullmqConnection,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 1000,
    attempts: appConfig.ocrQueue.attempts,
    backoff: {
      type: "exponential",
      delay: appConfig.ocrQueue.backoffMs,
    },
  },
});

async function enqueueOcrJob({ jobId, tradeId, imageUrl, userId, marketType, broker }) {
  const id = String(jobId || tradeId);
  const existing = await ocrQueue.getJob(id);
  if (existing) {
    const state = await existing.getState();
    logger.warn("Duplicate OCR enqueue prevented", {
      jobId: id,
      jobId: existing.id,
      state,
    });
    return existing;
  }

  return ocrQueue.add(
    OCR_JOB_NAME,
    {
      tradeId,
      jobId: id,
      imageUrl,
      userId: userId?.toString(),
      marketType,
      broker: broker || "",
    },
    {
      jobId: id,
      delay: appConfig.ocrQueue.initialDelayMs,
    }
  );
}

async function getOcrJobSnapshot(jobId) {
  const job = await ocrQueue.getJob(jobId);
  if (!job) {
    return null;
  }

  return {
    jobId: job.id,
    state: await job.getState(),
    attemptsMade: job.attemptsMade,
    failedReason: job.failedReason || null,
    progress: job.progress,
    timestamp: job.timestamp,
    processedOn: job.processedOn || null,
    finishedOn: job.finishedOn || null,
  };
}

ocrQueue.on("error", (error) => {
  logger.error("OCR queue error", {
    error: error.message,
    stack: error.stack,
  });
});

ocrQueue.on("waiting", (jobId) => {
  logger.info("OCR job waiting", { jobId });
});

module.exports = {
  OCR_JOB_NAME,
  OCR_QUEUE_NAME,
  enqueueOcrJob,
  getOcrJobSnapshot,
  ocrQueue,
};
