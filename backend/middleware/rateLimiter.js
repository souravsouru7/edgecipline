const jwt = require("jsonwebtoken");
const { appConfig } = require("../config");
const { client: redisClient, isRedisReady } = require("../config/redis");
const { logger } = require("../utils/logger");
const { captureOperationalError } = require("../config/sentry");

const RATE_LIMIT_SCRIPT = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
return { current, ttl }
`;

const DEFAULT_FALLBACK_WINDOW_MS = 60 * 1000;
const DEFAULT_FALLBACK_MAX_REQUESTS = 10;
const FALLBACK_MAX_KEYS = 50_000;
const ALERT_THROTTLE_MS = 60 * 1000;
const REDIS_COMMAND_TIMEOUT_MS = Number(process.env.RATE_LIMIT_REDIS_TIMEOUT_MS) || 1500;
const memoryBuckets = new Map();
let lastSentryAlertAt = 0;
const limiterHealth = {
  degraded: false,
  degradedSince: null,
  lastRedisErrorAt: null,
  lastRedisSuccessAt: null,
  redisFailureCount: 0,
  fallbackRequestCount: 0,
  failClosedRequestCount: 0,
  affectedScopes: new Set(),
};

function normalizeIp(ip) {
  return String(ip || "unknown")
    .replace(/^::ffff:/, "")
    .trim() || "unknown";
}

function getTokenUserId(req) {
  if (req.user?._id) {
    return req.user._id.toString();
  }

  if (req._rateLimitUserId) {
    return req._rateLimitUserId;
  }

  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return null;
  }

  try {
    const decoded = jwt.verify(token, appConfig.jwt.secret, {
      algorithms: ["HS256"],
    });
    req._rateLimitUserId = decoded?.id ? String(decoded.id) : null;
    return req._rateLimitUserId;
  } catch {
    return null;
  }
}

function resolveRateLimitKey(req, scope) {
  const userId = getTokenUserId(req);
  if (userId) {
    return {
      key: `rate-limit:${scope}:user:${userId}`,
      keyType: "user",
    };
  }

  return {
    key: `rate-limit:${scope}:ip:${normalizeIp(req.ip)}`,
    keyType: "ip",
  };
}

function sendRateLimitResponse(req, res, { scope, limit, ttlMs, message, keyType }) {
  const retryAfterSeconds = Math.max(1, Math.ceil((ttlMs > 0 ? ttlMs : 1000) / 1000));

  res.setHeader("Retry-After", String(retryAfterSeconds));
  res.setHeader("RateLimit-Limit", String(limit));
  res.setHeader("RateLimit-Remaining", "0");
  res.setHeader("RateLimit-Reset", String(retryAfterSeconds));

  logger.warn("Rate limit exceeded", {
    scope,
    keyType,
    ip: normalizeIp(req.ip),
    path: req.originalUrl,
    method: req.method,
    requestId: req.requestId,
    retryAfterSeconds,
  });

  return res.status(429).json({
    status: "error",
    message,
  });
}

function markRedisHealthy() {
  limiterHealth.lastRedisSuccessAt = new Date();
  if (!limiterHealth.degraded) return;

  logger.info("Redis rate limiter recovered", {
    degradedSince: limiterHealth.degradedSince,
    affectedScopes: [...limiterHealth.affectedScopes],
  });
  limiterHealth.degraded = false;
  limiterHealth.degradedSince = null;
  limiterHealth.affectedScopes.clear();
}

function markRedisFailure(error, { scope, req, failureMode }) {
  const now = Date.now();
  limiterHealth.degraded = true;
  limiterHealth.degradedSince ||= new Date(now);
  limiterHealth.lastRedisErrorAt = new Date(now);
  limiterHealth.redisFailureCount += 1;
  limiterHealth.affectedScopes.add(scope);

  if (now - lastSentryAlertAt >= ALERT_THROTTLE_MS) {
    lastSentryAlertAt = now;
    captureOperationalError(error, {
      subsystem: "rate_limit",
      tags: { scope, behavior: failureMode },
      extra: { route: req.originalUrl.split("?")[0], requestId: req.requestId },
    });
    logger.error("Redis rate limiter unavailable", {
      scope,
      failureMode,
      path: req.originalUrl,
      method: req.method,
      error: error.message,
    });
  }
}

function pruneMemoryBuckets(now) {
  for (const [key, bucket] of memoryBuckets) {
    if (bucket.resetAt <= now) memoryBuckets.delete(key);
  }
  while (memoryBuckets.size >= FALLBACK_MAX_KEYS) {
    memoryBuckets.delete(memoryBuckets.keys().next().value);
  }
}

function consumeMemoryFallback(req, scope, { windowMs, maxRequests }) {
  const now = Date.now();
  const { key: rateLimitKey, keyType } = resolveRateLimitKey(req, scope);
  const fallbackWindowMs = Number(windowMs) || DEFAULT_FALLBACK_WINDOW_MS;
  const fallbackMaxRequests = Number(maxRequests) || DEFAULT_FALLBACK_MAX_REQUESTS;
  const key = `fallback:${rateLimitKey}`;
  let bucket = memoryBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    if (memoryBuckets.size >= FALLBACK_MAX_KEYS) pruneMemoryBuckets(now);
    bucket = { count: 0, resetAt: now + fallbackWindowMs };
    memoryBuckets.set(key, bucket);
  }

  bucket.count += 1;
  limiterHealth.fallbackRequestCount += 1;
  return {
    allowed: bucket.count <= fallbackMaxRequests,
    keyType: `fallback-${keyType}`,
    limit: fallbackMaxRequests,
    windowMs: fallbackWindowMs,
    remaining: Math.max(0, fallbackMaxRequests - bucket.count),
    ttlMs: Math.max(1, bucket.resetAt - now),
  };
}

function sendAuthUnavailableResponse(res) {
  res.setHeader("Retry-After", "60");
  res.setHeader("Cache-Control", "no-store");
  return res.status(503).json({ error: "Authentication temporarily unavailable" });
}

function getRateLimiterHealth() {
  const redisReady = isRedisReady();
  const degraded = limiterHealth.degraded || !redisReady;
  return {
    status: degraded ? "degraded" : "healthy",
    degraded,
    redisReady,
    reason: !redisReady ? "redis_unavailable" : limiterHealth.degraded ? "redis_command_failure" : null,
    degradedSince: limiterHealth.degradedSince,
    lastRedisErrorAt: limiterHealth.lastRedisErrorAt,
    lastRedisSuccessAt: limiterHealth.lastRedisSuccessAt,
    redisFailureCount: limiterHealth.redisFailureCount,
    fallbackRequestCount: limiterHealth.fallbackRequestCount,
    failClosedRequestCount: limiterHealth.failClosedRequestCount,
    affectedScopes: [...limiterHealth.affectedScopes],
    fallback: {
      defaultMaxRequests: DEFAULT_FALLBACK_MAX_REQUESTS,
      defaultWindowMs: DEFAULT_FALLBACK_WINDOW_MS,
      activeKeys: memoryBuckets.size,
    },
  };
}

function resetRateLimiterStateForTests() {
  memoryBuckets.clear();
  lastSentryAlertAt = 0;
  Object.assign(limiterHealth, {
    degraded: false,
    degradedSince: null,
    lastRedisErrorAt: null,
    lastRedisSuccessAt: null,
    redisFailureCount: 0,
    fallbackRequestCount: 0,
    failClosedRequestCount: 0,
  });
  limiterHealth.affectedScopes.clear();
}

function withRedisTimeout(command) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error("Redis rate limiter command timed out")),
      REDIS_COMMAND_TIMEOUT_MS
    );
  });
  return Promise.race([command, timeout]).finally(() => clearTimeout(timeoutId));
}

function createRedisRateLimiter({
  scope,
  windowMs,
  maxRequests,
  message = "Too many requests. Please try again later.",
  failureMode = "memory",
  skip,
}) {
  return async (req, res, next) => {
    if (typeof skip === "function" && skip(req)) {
      return next();
    }

    try {
      if (!isRedisReady()) {
        throw new Error("Redis is not ready for distributed rate limiting");
      }
      const { key: rateLimitKey, keyType } = resolveRateLimitKey(req, scope);
      const [currentCountRaw, ttlMsRaw] = await withRedisTimeout(
        redisClient.eval(
          RATE_LIMIT_SCRIPT,
          1,
          rateLimitKey,
          String(windowMs)
        )
      );
      markRedisHealthy();

      const currentCount = Number(currentCountRaw);
      const ttlMs = Number(ttlMsRaw);
      const remaining = Math.max(0, maxRequests - currentCount);
      const resetSeconds = Math.max(1, Math.ceil((ttlMs > 0 ? ttlMs : windowMs) / 1000));

      res.setHeader("RateLimit-Limit", String(maxRequests));
      res.setHeader("RateLimit-Remaining", String(remaining));
      res.setHeader("RateLimit-Reset", String(resetSeconds));

      if (currentCount > maxRequests) {
        return sendRateLimitResponse(req, res, {
          scope,
          limit: maxRequests,
          ttlMs,
          message,
          keyType,
        });
      }

      return next();
    } catch (error) {
      markRedisFailure(error, { scope, req, failureMode });

      if (failureMode === "deny") {
        limiterHealth.failClosedRequestCount += 1;
        return sendAuthUnavailableResponse(res);
      }

      const fallback = consumeMemoryFallback(req, scope, { windowMs, maxRequests });
      res.setHeader("RateLimit-Policy", "fallback-memory");
      res.setHeader("RateLimit-Limit", String(fallback.limit));
      res.setHeader("RateLimit-Remaining", String(fallback.remaining));
      res.setHeader("RateLimit-Reset", String(Math.ceil(fallback.ttlMs / 1000)));
      if (!fallback.allowed) {
        return sendRateLimitResponse(req, res, {
          scope,
          limit: fallback.limit,
          ttlMs: fallback.ttlMs,
          message,
          keyType: fallback.keyType,
        });
      }
      return next();
    }
  };
}

function skipGlobalForDedicatedStatusLimiter(req) {
  if (req.method !== "GET") return false;
  const path = String(req.originalUrl || req.path || "").split("?")[0];
  return (
    /^\/api\/upload\/job-status\/[a-f0-9]{24}$/i.test(path) ||
    /^\/api\/trade\/status\/[a-f0-9]{24}$/i.test(path) ||
    path === "/api/upload/queue-health"
  );
}

const globalRateLimiter = createRedisRateLimiter({
  scope: "global",
  windowMs: appConfig.rateLimit.globalWindowMs,
  maxRequests: appConfig.rateLimit.globalMaxRequests,
  message: "Too many requests. Please try again later.",
  skip: skipGlobalForDedicatedStatusLimiter,
});

// Strict limiter: credential-submitting endpoints (login, register, google, password reset).
// These are the targets for brute-force and credential stuffing — keep them tight.
const authRateLimiter = createRedisRateLimiter({
  scope: "auth",
  windowMs: appConfig.rateLimit.authWindowMs,
  maxRequests: appConfig.rateLimit.authMaxRequests,
  message: "Too many authentication attempts. Please try again later.",
  failureMode: "deny",
});

// Loose limiter: profile/preferences endpoints called frequently by the app on every load.
// Previously these shared the same 5 req/60s auth budget, causing legitimate 429s.
const profileRateLimiter = createRedisRateLimiter({
  scope: "profile",
  windowMs: 60 * 1000,
  maxRequests: Number(process.env.PROFILE_RATE_LIMIT_MAX_REQUESTS) || 60,
  message: "Too many profile requests. Please try again later.",
});

// Medium limiter: token refresh — called silently by the client when access tokens expire.
// Must be looser than auth (multiple tabs can trigger simultaneous refreshes) but not
// open (prevents token grinding). 10/min per user/IP is a comfortable ceiling.
const refreshRateLimiter = createRedisRateLimiter({
  scope: "refresh",
  windowMs: 60 * 1000,
  maxRequests: Number(process.env.REFRESH_RATE_LIMIT_MAX_REQUESTS) || 10,
  message: "Too many refresh requests. Please try again later.",
  failureMode: "deny",
});

const deviceTokenRateLimiter = createRedisRateLimiter({
  scope: "device-token",
  windowMs: 60 * 1000,
  maxRequests: Number(process.env.DEVICE_TOKEN_RATE_LIMIT_MAX_REQUESTS) || 20,
  message: "Too many device token requests. Please try again later.",
  failureMode: "memory",
});

const uploadRateLimiter = createRedisRateLimiter({
  scope: "upload",
  windowMs: appConfig.rateLimit.uploadWindowMs,
  maxRequests: appConfig.rateLimit.uploadMaxRequests,
  message: "Too many upload requests. Please try again later.",
});

const statusRateLimiter = createRedisRateLimiter({
  scope: "status",
  windowMs: appConfig.rateLimit.statusWindowMs,
  maxRequests: appConfig.rateLimit.statusMaxRequests,
  message: "Too many status requests. Please try again later.",
});

// Money endpoints: order creation and payment verification. 10/min per user is
// far above any legitimate flow (one subscription = 1 order + 1 verify) but
// caps an attacker holding a valid session from spinning the Razorpay client.
// failureMode: "deny" so a Redis outage cannot silently open the floodgates.
const paymentRateLimiter = createRedisRateLimiter({
  scope: "payment",
  windowMs: 60 * 1000,
  maxRequests: Number(process.env.PAYMENT_RATE_LIMIT_MAX_REQUESTS) || 10,
  message: "Too many payment requests. Please try again later.",
  failureMode: "deny",
});

const webhookRateLimiter = createRedisRateLimiter({
  scope: "razorpay-webhook",
  windowMs: 60 * 1000,
  maxRequests: Number(process.env.WEBHOOK_RATE_LIMIT_MAX_REQUESTS) || 60,
  message: "Too many webhook requests. Please try again later.",
  failureMode: "deny",
});

const adminFinancialRateLimiter = createRedisRateLimiter({
  scope: "admin-financial",
  windowMs: 60 * 1000,
  maxRequests: Number(process.env.ADMIN_FINANCIAL_RATE_LIMIT_MAX_REQUESTS) || 10,
  message: "Too many admin payment operations. Please wait before trying again.",
  failureMode: "deny",
});

// Strict limiter for destructive admin operations (delete, status toggle, plan extension).
// Keyed per admin user (falls back to IP). 10 destructive ops per minute is enough for
// any legitimate admin workflow; protects against accidental bulk loops or compromised sessions.
// Max 10 issue reports per hour per user — protects against runaway loops or abuse,
// while leaving headroom for a user genuinely hitting many problems in a single session.
const issueReportRateLimiter = createRedisRateLimiter({
  scope: "issue-report",
  windowMs: 60 * 60 * 1000,
  maxRequests: Number(process.env.ISSUE_REPORT_RATE_LIMIT_MAX_REQUESTS) || 10,
  message: "Too many issue reports submitted. Please wait an hour before submitting more.",
});

const adminDestructiveRateLimiter = createRedisRateLimiter({
  scope: "admin-destructive",
  windowMs: 60 * 1000,
  maxRequests: Number(process.env.ADMIN_DESTRUCTIVE_RATE_LIMIT_MAX_REQUESTS) || 10,
  message: "Too many admin operations. Please wait before performing more destructive actions.",
});

// Coach chat: streaming Gemini calls per user. Generous enough for a real
// conversation, tight enough that a stuck client can't open dozens of
// long-lived SSE streams in a few seconds. Free-tier weekly quota is enforced
// separately inside coachChatService.
const coachChatRateLimiter = createRedisRateLimiter({
  scope: "coach-chat",
  windowMs: 60 * 1000,
  maxRequests: Number(process.env.COACH_CHAT_RATE_LIMIT_MAX_REQUESTS) || 20,
  message: "Too many coach messages in a short time. Take a breath and try again in a moment.",
});

module.exports = {
  createRedisRateLimiter,
  getRateLimiterHealth,
  resetRateLimiterStateForTests,
  globalRateLimiter,
  authRateLimiter,
  profileRateLimiter,
  refreshRateLimiter,
  deviceTokenRateLimiter,
  uploadRateLimiter,
  statusRateLimiter,
  paymentRateLimiter,
  webhookRateLimiter,
  adminFinancialRateLimiter,
  adminDestructiveRateLimiter,
  issueReportRateLimiter,
  coachChatRateLimiter,
};
