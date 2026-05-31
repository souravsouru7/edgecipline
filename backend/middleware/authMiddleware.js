const jwt = require("jsonwebtoken");
const User = require("../models/Users");
const { appConfig } = require("../config");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");
const { CURRENT_TERMS_VERSION } = require("../constants/terms");

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

const protect = asyncHandler(async (req, res, next) => {
  let token;

  if (!req.headers.authorization || !req.headers.authorization.startsWith("Bearer")) {
    console.warn(`[Security] Missing token | path=${req.originalUrl} | ip=${req.ip}`);
    throw new ApiError(401, "No token provided", "AUTH_REQUIRED");
  }

  token = req.headers.authorization.split(" ")[1];

  if (!token) {
    console.warn(`[Security] Malformed authorization header | path=${req.originalUrl} | ip=${req.ip}`);
    throw new ApiError(401, "No token provided", "AUTH_REQUIRED");
  }

  try {
    const decoded = jwt.verify(token, appConfig.jwt.secret);
    const dbUser = await User.findById(decoded.id).select("-password");
    if (dbUser && decoded.tokenVersion !== undefined && decoded.tokenVersion !== dbUser.tokenVersion) {
      console.warn(`[Security] Stale token (version mismatch) | path=${req.originalUrl} | ip=${req.ip}`);
      throw Object.assign(new Error("Token invalidated"), { name: "TokenInvalidatedError" });
    }
    req.user = dbUser;
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      console.warn(`[Security] Expired token | path=${req.originalUrl} | ip=${req.ip}`);
      throw new ApiError(401, "Token expired, please login again", "TOKEN_EXPIRED");
    }

    if (error.name === "TokenInvalidatedError") {
      throw new ApiError(401, "Session expired, please login again", "TOKEN_INVALIDATED");
    }

    if (error.name === "JsonWebTokenError" || error.name === "NotBeforeError") {
      console.warn(`[Security] Invalid token | path=${req.originalUrl} | ip=${req.ip}`);
      throw new ApiError(401, "Invalid token", "INVALID_TOKEN");
    }

    console.error("[Security] Token verification failure:", error.message);
    throw new ApiError(401, "Not authorized", "AUTH_FAILED");
  }

  if (!req.user) {
    console.warn(`[Security] Token for missing user | path=${req.originalUrl} | ip=${req.ip}`);
    throw new ApiError(401, "Not authorized", "AUTH_FAILED");
  }

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
