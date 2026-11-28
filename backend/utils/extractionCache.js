"use strict";

const crypto = require("crypto");
const { client: redis, isRedisReady } = require("../config/redis");
const { logger } = require("./logger");

// Per-job cache of paid extraction steps (Vision OCR text, Gemini results).
//
// A BullMQ retry, or a stalled job re-run after the OCR worker is killed for
// memory, used to repeat the whole pipeline and pay for every AI call again.
// Results are keyed by the job and the exact image bytes, so a re-run of the
// same job reuses them, and a different screenshot never can. Only successful
// results are cached; the validation and merge logic downstream runs as
// before on whatever comes back.

const TTL_SECONDS = 60 * 60;
const REDIS_BUDGET_MS = 300;

function imageHash(buffer) {
  if (!buffer || !buffer.length) return "";
  return crypto.createHash("sha1").update(buffer).digest("hex");
}

function keyFor(jobId, hash, stage) {
  return `ocr:cache:${jobId}:${hash}:${stage}`;
}

function withBudget(promise) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(undefined), REDIS_BUDGET_MS)),
  ]);
}

async function get(jobId, hash, stage) {
  if (!jobId || !hash || !isRedisReady()) return null;
  try {
    const raw = await withBudget(redis.get(keyFor(jobId, hash, stage)));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    logger.warn("EXTRACTION_CACHE_READ_FAILED", { stage, error: error?.message });
    return null;
  }
}

async function set(jobId, hash, stage, value) {
  if (!jobId || !hash || value == null || !isRedisReady()) return;
  try {
    await withBudget(redis.set(keyFor(jobId, hash, stage), JSON.stringify(value), "EX", TTL_SECONDS));
  } catch (error) {
    logger.warn("EXTRACTION_CACHE_WRITE_FAILED", { stage, error: error?.message });
  }
}

module.exports = { TTL_SECONDS, get, imageHash, keyFor, set };
