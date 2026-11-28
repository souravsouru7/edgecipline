const { client: redis, isRedisReady } = require("../config/redis");
const { captureOperationalError } = require("../config/sentry");
const { appConfig } = require("../config");
const { logger } = require("./logger");

// Circuit breaker shared by every Gemini call site.
//
// During a Google outage each request would otherwise still try (and retry),
// holding the trader on a spinner for up to a minute before failing. After
// `failureThreshold` transient failures inside `windowMs`, the circuit opens:
// callers skip Gemini and use their fallback straight away. When `openMs`
// passes, exactly one probe call is let through. Success closes the circuit,
// failure re-opens it.
//
// State lives in Redis so the API and both workers agree. If Redis is down,
// each process keeps its own in-memory copy of the same state.

const KEYS = {
  failures: "gemini:circuit:failures",
  open: "gemini:circuit:open",
  tripped: "gemini:circuit:tripped",
  probe: "gemini:circuit:probe",
};
const PROBE_LOCK_MS = 30_000;
const TRIPPED_TTL_MS = 24 * 60 * 60 * 1000;

const ALERT_THROTTLE_SECONDS = 15 * 60;
const SPIKE_WINDOW_SECONDS = 5 * 60;
const SPIKE_THRESHOLD = 20;

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function settings() {
  const c = appConfig.ai.circuit || {};
  return {
    threshold: Math.max(1, Number(c.failureThreshold) || 5),
    windowMs: Math.max(1_000, Number(c.windowMs) || 60_000),
    openMs: Math.max(1_000, Number(c.openMs) || 60_000),
  };
}

// In-memory fallback state (also used by tests through reset()).
const memory = {
  failures: [],
  openUntil: 0,
  tripped: false,
  probeUntil: 0,
  alerts: new Map(),
  spikes: [],
};

function useRedis() {
  return isRedisReady();
}

// Transient upstream trouble: rate limit, overload, gateway, network, timeout.
// A bad key or a bad request is NOT counted: those are config bugs that the
// circuit can't fix, and they already alert on their own.
function isTransientGeminiError(error) {
  if (!error) return false;
  if (error.name === "TimeoutError") return true;
  if (RETRYABLE_STATUS.has(Number(error.status))) return true;
  const message = String(error.message || "");
  if (/\[(429|500|502|503|504)\s/.test(message)) return true;
  return /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|network error|timed? ?out|RESOURCE_EXHAUSTED|UNAVAILABLE|overloaded/i.test(message);
}

class GeminiCircuitOpenError extends Error {
  constructor() {
    super("Gemini circuit is open; skipping call");
    this.name = "GeminiCircuitOpenError";
    this.code = "GEMINI_CIRCUIT_OPEN";
  }
}

// Throttled Sentry alert: at most one per `key` per 15 minutes, across processes.
async function alertOnce(key, message, extra = {}) {
  const now = Date.now();
  let shouldSend = false;
  if (useRedis()) {
    try {
      const set = await redis.set(`gemini:alert:${key}`, "1", "EX", ALERT_THROTTLE_SECONDS, "NX");
      shouldSend = set === "OK";
    } catch {
      shouldSend = false;
    }
  } else {
    const last = memory.alerts.get(key) || 0;
    if (now - last >= ALERT_THROTTLE_SECONDS * 1000) {
      memory.alerts.set(key, now);
      shouldSend = true;
    }
  }
  logger.error(message, extra);
  if (shouldSend) {
    captureOperationalError(new Error(message), { subsystem: "gemini", tags: { event: key }, extra });
  }
  return shouldSend;
}

// Returns true when the caller must skip Gemini. Lets one probe through once
// the open period has elapsed.
async function isOpen() {
  const now = Date.now();
  if (useRedis()) {
    try {
      const [open, tripped] = await Promise.all([redis.get(KEYS.open), redis.get(KEYS.tripped)]);
      if (open) return true;
      if (!tripped) return false;
      const gotProbe = await redis.set(KEYS.probe, "1", "PX", PROBE_LOCK_MS, "NX");
      return gotProbe !== "OK";
    } catch (error) {
      logger.warn("GEMINI_CIRCUIT_REDIS_READ_FAILED", { error: error?.message });
      // fall through to memory
    }
  }
  if (now < memory.openUntil) return true;
  if (!memory.tripped) return false;
  if (now < memory.probeUntil) return true;
  memory.probeUntil = now + PROBE_LOCK_MS;
  return false;
}

async function trip(reason) {
  const { openMs } = settings();
  const now = Date.now();
  memory.openUntil = now + openMs;
  memory.tripped = true;
  memory.probeUntil = 0;
  memory.failures = [];
  if (useRedis()) {
    try {
      await Promise.all([
        redis.set(KEYS.open, "1", "PX", openMs),
        redis.set(KEYS.tripped, "1", "PX", TRIPPED_TTL_MS),
        redis.del(KEYS.probe, KEYS.failures),
      ]);
    } catch (error) {
      logger.warn("GEMINI_CIRCUIT_REDIS_WRITE_FAILED", { error: error?.message });
    }
  }
  await alertOnce("circuit_open", "GEMINI_CIRCUIT_OPEN", { reason, openMs });
}

async function recordFailure(error) {
  if (!isTransientGeminiError(error)) return false;
  const { threshold, windowMs } = settings();
  const now = Date.now();

  if (useRedis()) {
    try {
      const tripped = await redis.get(KEYS.tripped);
      if (tripped) {
        // The probe failed: re-open without waiting for a fresh streak.
        await trip("probe_failed");
        return true;
      }
      const count = await redis.incr(KEYS.failures);
      if (count === 1) await redis.pexpire(KEYS.failures, windowMs);
      if (count >= threshold) {
        await trip(`${count} failures in ${windowMs}ms`);
        return true;
      }
      return false;
    } catch (error2) {
      logger.warn("GEMINI_CIRCUIT_REDIS_WRITE_FAILED", { error: error2?.message });
    }
  }

  if (memory.tripped && now >= memory.openUntil) {
    await trip("probe_failed");
    return true;
  }
  memory.failures = memory.failures.filter((t) => now - t < windowMs);
  memory.failures.push(now);
  if (memory.failures.length >= threshold) {
    await trip(`${memory.failures.length} failures in ${windowMs}ms`);
    return true;
  }
  return false;
}

async function recordSuccess() {
  if (memory.tripped) logger.info("GEMINI_CIRCUIT_CLOSED");
  memory.tripped = false;
  memory.openUntil = 0;
  memory.probeUntil = 0;
  memory.failures = [];
  if (useRedis()) {
    try {
      const tripped = await redis.get(KEYS.tripped);
      if (tripped) {
        await redis.del(KEYS.tripped, KEYS.probe, KEYS.open, KEYS.failures);
        logger.info("GEMINI_CIRCUIT_CLOSED");
      }
    } catch {
      // best effort
    }
  }
}

// Coach failure-spike detector: many "busy" errors without the circuit
// opening (e.g. intermittent 503s) still deserve one alert.
async function noteUserFacingFailure(code) {
  const now = Date.now();
  let count;
  if (useRedis()) {
    try {
      const key = "gemini:spike:coach";
      count = await redis.incr(key);
      if (count === 1) await redis.expire(key, SPIKE_WINDOW_SECONDS);
    } catch {
      count = undefined;
    }
  }
  if (count === undefined) {
    memory.spikes = memory.spikes.filter((t) => now - t < SPIKE_WINDOW_SECONDS * 1000);
    memory.spikes.push(now);
    count = memory.spikes.length;
  }
  if (count > SPIKE_THRESHOLD) {
    await alertOnce("coach_failure_spike", "COACH_FAILURE_SPIKE", { count, windowSeconds: SPIKE_WINDOW_SECONDS, lastCode: code });
  }
  return count;
}

/**
 * Run one Gemini call behind the circuit and meter it.
 *   guardedCall({ feature, userId, model, call: () => model.generateContent(...) })
 * Throws GeminiCircuitOpenError without calling when the circuit is open, so
 * every caller's existing catch → fallback path handles it.
 */
function errorCodeOf(error) {
  return error?.name === "TimeoutError" ? "TIMEOUT" : String(error?.status || error?.code || "ERROR");
}

// One metering row per request a hedged call actually sent. The winner carries
// the provider's usage numbers; an aborted loser sent the same prompt, so its
// input tokens are estimated from the winner's (labelled "estimated").
function recordHedgedAttempts(recordAiUsage, base, attempts, { response, error }) {
  const winnerInput = Number(response?.usageMetadata?.promptTokenCount) || 0;
  for (const a of attempts) {
    if (a.outcome === "won") {
      recordAiUsage({ ...base, response, ok: true, attempt: a.attempt, hedged: attempts.length > 1, latencyMs: a.latencyMs });
    } else if (a.outcome === "aborted") {
      recordAiUsage({
        ...base,
        ok: false,
        errorCode: error ? errorCodeOf(error) : "HEDGE_ABORTED",
        attempt: a.attempt,
        hedged: attempts.length > 1,
        aborted: true,
        estimatedTokens: { inputTokens: winnerInput },
        latencyMs: a.latencyMs,
      });
    } else {
      recordAiUsage({
        ...base,
        ok: false,
        errorCode: errorCodeOf(a.error),
        attempt: a.attempt,
        hedged: attempts.length > 1,
        latencyMs: a.latencyMs,
      });
    }
  }
}

/**
 * Run one Gemini call behind the circuit and meter it.
 *   guardedCall({ feature, userId, model, operationId, call: (meter) => model.generateContent(...) })
 * A hedged call passes `meter.onAttempts` to hedgedGenerate so each request it
 * sent is metered separately.
 * Throws GeminiCircuitOpenError without calling when the circuit is open, so
 * every caller's existing catch → fallback path handles it.
 */
async function guardedCall({ feature, userId, model, operationId, call }) {
  // Lazy require: aiUsage pulls in mongoose models, which unit tests of the
  // circuit alone don't need.
  const { recordAiUsage } = require("./aiUsage");
  if (await isOpen()) throw new GeminiCircuitOpenError();
  const started = Date.now();
  let attempts = null;
  const meter = { onAttempts: (list) => { attempts = list; } };
  const base = { userId, feature, model, operationId };
  try {
    const result = await call(meter);
    recordSuccess().catch(() => {});
    if (attempts && attempts.length > 0) {
      recordHedgedAttempts(recordAiUsage, base, attempts, { response: result?.response });
    } else {
      recordAiUsage({ ...base, response: result?.response, ok: true, latencyMs: Date.now() - started });
    }
    return result;
  } catch (error) {
    recordFailure(error).catch(() => {});
    if (attempts && attempts.length > 0) {
      recordHedgedAttempts(recordAiUsage, base, attempts, { error });
    } else {
      recordAiUsage({ ...base, ok: false, errorCode: errorCodeOf(error), latencyMs: Date.now() - started });
    }
    throw error;
  }
}

function reset() {
  memory.failures = [];
  memory.openUntil = 0;
  memory.tripped = false;
  memory.probeUntil = 0;
  memory.alerts.clear();
  memory.spikes = [];
}

module.exports = {
  GeminiCircuitOpenError,
  alertOnce,
  guardedCall,
  isOpen,
  isTransientGeminiError,
  noteUserFacingFailure,
  recordFailure,
  recordSuccess,
  reset,
};
