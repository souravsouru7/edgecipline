const { Queue } = require("bullmq");
const { appConfig } = require("../config");
const { bullmqConnection } = require("../config/redis");
const { logger } = require("../utils/logger");

const OCR_QUEUE_NAME = appConfig.ocrQueue.name;
const OCR_JOB_NAME = "processOcrJob";
const ocrQueue = new Queue(OCR_QUEUE_NAME, {
  connection: bullmqConnection,
  defaultJobOptions: {
    removeOnComplete: {
      age: appConfig.ocrQueue.completedRetentionAgeSeconds,
      count: appConfig.ocrQueue.completedRetentionCount,
    },
    removeOnFail: {
      age: appConfig.ocrQueue.failedRetentionAgeSeconds,
      count: appConfig.ocrQueue.failedRetentionCount,
    },
    attempts: appConfig.ocrQueue.attempts,
    backoff: {
      type: "exponential",
      delay: appConfig.ocrQueue.backoffMs,
    },
  },
});

async function enqueueOcrJob({ jobId, imageUrl, userId, marketType, broker }) {
  const id = String(jobId || "").trim();
  if (!id) {
    const error = new Error("OCR queue payload missing jobId");
    error.code = "OCR_INVALID_PAYLOAD";
    logger.error("OCR enqueue rejected: missing jobId", {
      jobId,
      userId: userId?.toString?.() || userId,
      imageUrl: Boolean(imageUrl),
      marketType,
    });
    throw error;
  }
  if (!imageUrl) {
    const error = new Error("OCR queue payload missing imageUrl");
    error.code = "OCR_INVALID_PAYLOAD";
    logger.error("OCR enqueue rejected: missing imageUrl", {
      jobId: id,
      userId: userId?.toString?.() || userId,
      marketType,
    });
    throw error;
  }
  if (!userId) {
    const error = new Error("OCR queue payload missing userId");
    error.code = "OCR_INVALID_PAYLOAD";
    logger.error("OCR enqueue rejected: missing userId", {
      jobId: id,
      imageUrl: Boolean(imageUrl),
      marketType,
    });
    throw error;
  }

  const existing = await ocrQueue.getJob(id);
  if (existing) {
    const state = await existing.getState();
    logger.warn("Duplicate OCR enqueue prevented", {
      jobId: id,
      queueJobId: existing.id,
      state,
    });
    return existing;
  }

  logger.info("OCR job queued", {
    jobName: OCR_JOB_NAME,
    jobId: id,
    userId: userId?.toString?.() || userId,
    imageUrl: Boolean(imageUrl),
    marketType,
  });

  return ocrQueue.add(
    OCR_JOB_NAME,
    {
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

ocrQueue.on("waiting", (event) => {
  const jobId = typeof event === "string" ? event : event?.jobId || event?.id || null;
  logger.info("OCR job waiting", { jobId });
});

module.exports = {
  OCR_JOB_NAME,
  OCR_QUEUE_NAME,
  enqueueOcrJob,
  getOcrJobSnapshot,
  ocrQueue,
};
