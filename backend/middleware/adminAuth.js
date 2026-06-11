const jwt = require("jsonwebtoken");
const User = require("../models/Users");
const { appConfig } = require("../config");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");

const ADMIN_COOKIE_NAME = "admin_sid";

// Must match the secret used in adminAuthController — dedicated secret prevents
// user tokens from being accepted by admin middleware even if role check is bypassed.
const ADMIN_JWT_SECRET = appConfig.jwt.adminSecret;

/**
 * Admin authentication middleware.
 * Accepts token from httpOnly cookie (admin_sid) OR Authorization: Bearer header.
 * Verifies JWT, checks role === "admin", and validates tokenVersion to support revocation.
 */
const adminAuth = asyncHandler(async (req, res, next) => {
  // Prefer httpOnly cookie; fall back to Authorization header for API tooling
  const cookieToken = req.cookies?.[ADMIN_COOKIE_NAME];
  const headerToken =
    req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.split(" ")[1]
      : null;

  const token = cookieToken || headerToken;

  if (!token) {
    throw new ApiError(401, "No token provided", "AUTH_REQUIRED");
  }

  let decoded;
  try {
    decoded = jwt.verify(token, ADMIN_JWT_SECRET);
  } catch (error) {
    throw new ApiError(401, "Not authorized, token failed", "INVALID_TOKEN");
  }

  const user = await User.findById(decoded.id).select("-password");
  if (!user) {
    throw new ApiError(401, "Not authorized, user not found", "AUTH_FAILED");
  }

  // tokenVersion check — ensures tokens are invalidated after password reset / logout-all
  if (
    decoded.tokenVersion !== undefined &&
    decoded.tokenVersion !== user.tokenVersion
  ) {
    throw new ApiError(401, "Session expired, please login again", "TOKEN_INVALIDATED");
  }

  if (user.role !== "admin") {
    throw new ApiError(403, "Access denied. Admin privileges required.", "FORBIDDEN");
  }

  req.user = user;
  next();
});

module.exports = { adminAuth, ADMIN_COOKIE_NAME };
