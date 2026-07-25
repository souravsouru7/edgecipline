const jwt = require("jsonwebtoken");
const User = require("../models/Users");
const { appConfig } = require("../config");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");
const { CURRENT_TERMS_VERSION } = require("../constants/terms");
const {
  getCachedAuthUser,
  setCachedAuthUser,
  invalidateAuthCache,
  MONGOOSE_PROJECTION,
} = require("../services/authCacheService");
const { logger } = require("../utils/logger");

const TERMS_ALLOWED_PATHS = new Set([
  "/api/auth/me",
  "/api/auth/accept-terms",
  "/api/auth/logout",
]);

function hasAcceptedCurrentTerms(user) {
  return (
    user?.termsAcceptance?.acceptedTerms === true &&
    user?.termsAcceptance?.acceptedPrivacy === true &&
    user?.termsAcceptance?.termsVersion === CURRENT_TERMS_VERSION
  );
}

function isAccountActive(user) {
  return !user?.accountStatus || user.accountStatus === "active";
}

// Fetch the user via Redis cache first, fall back to MongoDB on miss or
// any cache failure. Returns a lean object (NOT a mongoose doc); downstream
// controllers that need to mutate the user must re-fetch.
async function loadAuthUser(userId) {
  const cached = await getCachedAuthUser(userId);
  if (cached) return { user: cached, source: "cache" };

  const dbUser = await User.findById(userId).select(MONGOOSE_PROJECTION).lean();
  if (dbUser) {
    // Best-effort cache write — never blocks the request.
    setCachedAuthUser(dbUser).catch(() => {});
  }
  return { user: dbUser, source: "db" };
}

const protect = asyncHandler(async (req, res, next) => {
  if (!req.headers.authorization || !req.headers.authorization.startsWith("Bearer")) {
    console.warn(`[Security] Missing token | path=${req.originalUrl} | ip=${req.ip}`);
    throw new ApiError(401, "No token provided", "AUTH_REQUIRED");
  }

  const token = req.headers.authorization.split(" ")[1];
  if (!token) {
    console.warn(`[Security] Malformed authorization header | path=${req.originalUrl} | ip=${req.ip}`);
    throw new ApiError(401, "No token provided", "AUTH_REQUIRED");
  }

  // ─── 1. ALWAYS verify the JWT signature + expiry first ─────────────────────
  let decoded;
  try {
    decoded = jwt.verify(token, appConfig.jwt.secret, { algorithms: ["HS256"] });
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      console.warn(`[Security] Expired token | path=${req.originalUrl} | ip=${req.ip}`);
      throw new ApiError(401, "Token expired, please login again", "TOKEN_EXPIRED");
    }
    if (error.name === "JsonWebTokenError" || error.name === "NotBeforeError") {
      console.warn(`[Security] Invalid token | path=${req.originalUrl} | ip=${req.ip}`);
      throw new ApiError(401, "Invalid token", "INVALID_TOKEN");
    }
    console.error("[Security] Token verification failure:", error.message);
    throw new ApiError(401, "Not authorized", "AUTH_FAILED");
  }

  // ─── 2. Resolve the user (cache or DB) ─────────────────────────────────────
  let user;
  try {
    ({ user } = await loadAuthUser(decoded.id));
  } catch (error) {
    logger.error("AUTH_CACHE_ERROR", { phase: "load", error: error?.message });
    throw new ApiError(
      503,
      "Authentication service temporarily unavailable",
      "AUTH_SERVICE_UNAVAILABLE"
    );
  }

  if (!user) {
    console.warn(`[Security] Token for missing user | path=${req.originalUrl} | ip=${req.ip}`);
    throw new ApiError(401, "Not authorized", "AUTH_FAILED");
  }

  if (!isAccountActive(user)) {
    console.warn(`[Security] Disabled account token | path=${req.originalUrl} | ip=${req.ip}`);
    throw new ApiError(401, "Account disabled", "ACCOUNT_DISABLED");
  }

  // ─── 3. SECURITY GATE: tokenVersion must match what the cache/DB reports ──
  // This runs on every request, against the cached or DB-fresh value. When a
  // logout / password reset bumps tokenVersion, the invalidator drops the
  // cache so the next request loads a fresh copy with the new version; the
  // old JWT then fails this check.
  if (
    decoded.tokenVersion === undefined ||
    decoded.tokenVersion !== user.tokenVersion
  ) {
    console.warn(`[Security] Stale token (version mismatch) | path=${req.originalUrl} | ip=${req.ip}`);
    // Defence in depth: if the cache somehow served stale tokenVersion AND
    // the JWT presents the new version, drop the cache so the next request
    // loads from MongoDB. Also handles the inverse — invalidator missed.
    await invalidateAuthCache(decoded.id);
    throw new ApiError(401, "Session expired, please login again", "TOKEN_INVALIDATED");
  }

  req.user = user;

  // ─── 4. Terms gate ─────────────────────────────────────────────────────────
  if (!TERMS_ALLOWED_PATHS.has(req.path) && !TERMS_ALLOWED_PATHS.has(req.originalUrl.split("?")[0])) {
    if (!hasAcceptedCurrentTerms(req.user)) {
      throw new ApiError(
        403,
        "You must accept the Terms & Privacy Policy to continue",
        "TERMS_NOT_ACCEPTED"
      );
    }
  }

  return next();
});

module.exports = { protect };
