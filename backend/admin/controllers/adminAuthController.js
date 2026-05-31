const User = require("../../models/Users");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { appConfig } = require("../../config");
const ApiError = require("../../utils/ApiError");
const asyncHandler = require("../../utils/asyncHandler");
const { ADMIN_COOKIE_NAME } = require("../../middleware/adminAuth");

// Admin sessions last 8 hours — long enough for a working session, short enough to limit exposure.
// Stored in httpOnly cookie, never in localStorage.
const ADMIN_TOKEN_EXPIRY = "8h";
const ADMIN_COOKIE_MAX_AGE = 8 * 60 * 60 * 1000;

function generateAdminToken(user) {
  return jwt.sign(
    { id: String(user._id), role: user.role, tokenVersion: user.tokenVersion ?? 0 },
    appConfig.jwt.secret,
    { expiresIn: ADMIN_TOKEN_EXPIRY }
  );
}

function getAdminCookieOptions() {
  const isProduction = appConfig.env === "production";
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "strict" : "lax",
    maxAge: ADMIN_COOKIE_MAX_AGE,
    path: "/api/admin",
  };
}

function getClearAdminCookieOptions() {
  const isProduction = appConfig.env === "production";
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "strict" : "lax",
    path: "/api/admin",
  };
}

/**
 * Admin Login
 * POST /api/admin/auth/login
 * Validates credentials, confirms admin role, and sets an httpOnly session cookie.
 */
exports.adminLogin = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new ApiError(400, "Email and password are required", "VALIDATION_ERROR");
  }

  const user = await User.findOne({ email }).select("+password");

  // L1: Always run bcrypt compare to prevent timing attacks that reveal whether
  // the email exists. Use a dummy hash when the user is not found.
  const DUMMY_HASH = "$2b$10$invalidsaltinvalidsaltinvalidsal" + "tXXXXXXXXXXXXXXXXXXXX";
  const candidateHash = (user?.password && user.authProvider !== "google" && user.role === "admin")
    ? user.password
    : DUMMY_HASH;
  const isMatch = await bcrypt.compare(password, candidateHash);

  if (!user || user.authProvider === "google" || !user.password || user.role !== "admin" || !isMatch) {
    throw new ApiError(401, "Invalid credentials", "INVALID_CREDENTIALS");
  }

  const token = generateAdminToken(user);
  res.cookie(ADMIN_COOKIE_NAME, token, getAdminCookieOptions());

  res.json({
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
  });
});

/**
 * Admin Logout
 * POST /api/admin/auth/logout
 * Clears the admin session cookie.
 */
exports.adminLogout = asyncHandler(async (req, res) => {
  res.clearCookie(ADMIN_COOKIE_NAME, getClearAdminCookieOptions());
  res.json({ success: true, message: "Logged out successfully" });
});

/**
 * Get Admin Profile
 * GET /api/admin/auth/me
 * Returns the current admin's profile (requires adminAuth middleware).
 */
exports.getAdminProfile = asyncHandler(async (req, res) => {
  if (!req.user) {
    throw new ApiError(401, "Not authorized", "AUTH_FAILED");
  }

  res.json({
    _id: req.user._id,
    name: req.user.name,
    email: req.user.email,
    role: req.user.role,
    createdAt: req.user.createdAt,
  });
});
