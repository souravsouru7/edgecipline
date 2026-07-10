"use strict";

const { Queue } = require("bullmq");
const { appConfig } = require("../config");
const { bullmqConnection } = require("../config/redis");
const { logger } = require("../utils/logger");

const TRADING_DNA_QUEUE_NAME = appConfig.tradingDnaQueue.name;
const TRADING_DNA_JOB_NAME = "generateTradingDna";

const ALLOWED_PERIODS = new Set(["30d", "90d", "365d"]);
const ALLOWED_MARKETS = new Set(["Forex", "Indian_Market"]);

const tradingDnaQueue = new Queue(TRADING_DNA_QUEUE_NAME, {
  connection: bullmqConnection,
  defaultJobOptions: {
    removeOnComplete: {
      age: appConfig.tradingDnaQueue.completedRetentionAgeSeconds,
      count: appConfig.tradingDnaQueue.completedRetentionCount,
    },
    removeOnFail: {
      age: appConfig.tradingDnaQueue.failedRetentionAgeSeconds,
      count: appConfig.tradingDnaQueue.failedRetentionCount,
    },
    attempts: appConfig.tradingDnaQueue.attempts,
    backoff: {
      type: "exponential",
      delay: appConfig.tradingDnaQueue.backoffMs,
    },
  },
});

// Deterministic id per (user, market, period). BullMQ rejects re-adds while
// the same id is waiting/active, so a double-click never enqueues twice.
// Once the job has completed and been retained-removed, a new enqueue is
// allowed — which is exactly what we want when the user clicks regenerate
// after looking at the previous result.
function buildJobId({ userId, marketType, periodType }) {
  return `tdna:${String(userId)}:${marketType}:${periodType}`;
}

async function enqueueTradingDnaJob({ userId, marketType, periodType, force = false } = {}) {
  if (!userId) {
    const error = new Error("Trading DNA queue payload missing userId");
    error.code = "TRADING_DNA_INVALID_PAYLOAD";
    throw error;
  }
  if (!ALLOWED_MARKETS.has(marketType)) {
    const error = new Error(`Trading DNA queue payload has invalid marketType: ${marketType}`);
    error.code = "TRADING_DNA_INVALID_PAYLOAD";
    throw error;
  }
  if (!ALLOWED_PERIODS.has(periodType)) {
    const error = new Error(`Trading DNA queue payload has invalid periodType: ${periodType}`);
    error.code = "TRADING_DNA_INVALID_PAYLOAD";
    throw error;
  }

  const jobId = buildJobId({ userId, marketType, periodType });

  // Because we use a deterministic jobId, we have to reconcile the existing
  // record before adding. Three cases:
  //   1. In-flight (waiting / active / delayed) — reuse it. The caller almost
  //      certainly wanted the same result; dedupe the request.
  //   2. Terminal (completed / failed) — the job still occupies the id slot
  //      inside the completion-retention window. We have to remove() it or
  //      queue.add will throw "job already exists". Removal is safe: the
  //      report itself is durably stored in Mongo, so the queue entry is
  //      purely a status-poll cache and can be rebuilt from scratch.
  //   3. Not found — clean slate.
  const existing = await tradingDnaQueue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === "waiting" || state === "active" || state === "delayed") {
      logger.info("Trading DNA enqueue deduplicated", { jobId, state });
      return { jobId: existing.id, state, deduplicated: true };
    }
    try {
      await existing.remove();
      logger.info("Trading DNA stale job removed before re-add", {
        jobId,
        previousState: state,
      });
    } catch (removeError) {
      // Race: someone else removed it between getState and remove. Safe to
      // continue — queue.add below will succeed if the slot is now empty
      // and surface the real error if not.
      logger.warn("Trading DNA stale job removal failed", {
        jobId,
        previousState: state,
        error: removeError.message,
      });
    }
  }

  const userIdStr = userId.toString?.() || String(userId);
  logger.info("Trading DNA job queued", {
    jobName: TRADING_DNA_JOB_NAME,
    jobId,
    userId: userIdStr,
    marketType,
    periodType,
    force,
  });

  const job = await tradingDnaQueue.add(
    TRADING_DNA_JOB_NAME,
    {
      userId: userIdStr,
      marketType,
      periodType,
      force: Boolean(force),
    },
    { jobId }
  );

  return { jobId: job.id, state: "waiting", deduplicated: false };
}

async function getTradingDnaJobSnapshot(jobId) {
  const job = await tradingDnaQueue.getJob(jobId);
  if (!job) return null;

  const state = await job.getState();
  const returnvalue =
    state === "completed"
      ? typeof job.returnvalue === "object"
        ? job.returnvalue
        : null
      : null;

  return {
    jobId: job.id,
    state,
    attemptsMade: job.attemptsMade,
    failedReason: job.failedReason || null,
    progress: job.progress,
    timestamp: job.timestamp,
    processedOn: job.processedOn || null,
    finishedOn: job.finishedOn || null,
    data: {
      userId: job.data?.userId || null,
      marketType: job.data?.marketType || null,
      periodType: job.data?.periodType || null,
    },
    result: returnvalue,
  };
}

tradingDnaQueue.on("error", (error) => {
  logger.error("Trading DNA queue error", {
    error: error.message,
    stack: error.stack,
  });
});

tradingDnaQueue.on("waiting", (event) => {
  const jobId = typeof event === "string" ? event : event?.jobId || event?.id || null;
  logger.info("Trading DNA job waiting", { jobId });
});

module.exports = {
  TRADING_DNA_JOB_NAME,
  TRADING_DNA_QUEUE_NAME,
  buildJobId,
  enqueueTradingDnaJob,
  getTradingDnaJobSnapshot,
  tradingDnaQueue,
};
