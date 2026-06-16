const jwt = require("jsonwebtoken");
const { appConfig } = require("../config");
const { client: redisClient } = require("../config/redis");
const { logger } = require("../utils/logger");

const RATE_LIMIT_SCRIPT = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
return { current, ttl }
`;

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
    const decoded = jwt.verify(token, appConfig.jwt.secret);
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
    retryAfterSeconds,
  });

  return res.status(429).json({
    status: "error",
    message,
  });
}

function createRedisRateLimiter({
  scope,
  windowMs,
  maxRequests,
  message = "Too many requests. Please try again later.",
}) {
  return async (req, res, next) => {
    try {
      const { key: rateLimitKey, keyType } = resolveRateLimitKey(req, scope);
      const [currentCountRaw, ttlMsRaw] = await redisClient.eval(
        RATE_LIMIT_SCRIPT,
        1,
        rateLimitKey,
        String(windowMs)
      );

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
      logger.error("Redis rate limiter unavailable — failing open", {
        scope,
        path: req.originalUrl,
        method: req.method,
        error: error.message,
      });

      // Fail open: allow the request through rather than blocking all users
      return next();
    }
  };
}

const globalRateLimiter = createRedisRateLimiter({
  scope: "global",
  windowMs: appConfig.rateLimit.globalWindowMs,
  maxRequests: appConfig.rateLimit.globalMaxRequests,
  message: "Too many requests. Please try again later.",
});

// Strict limiter: credential-submitting endpoints (login, register, google, password reset).
// These are the targets for brute-force and credential stuffing — keep them tight.
const authRateLimiter = createRedisRateLimiter({
  scope: "auth",
  windowMs: appConfig.rateLimit.authWindowMs,
  maxRequests: appConfig.rateLimit.authMaxRequests,
  message: "Too many authentication attempts. Please try again later.",
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

module.exports = {
  createRedisRateLimiter,
  globalRateLimiter,
  authRateLimiter,
  profileRateLimiter,
  refreshRateLimiter,
  uploadRateLimiter,
  statusRateLimiter,
  adminDestructiveRateLimiter,
  issueReportRateLimiter,
};
