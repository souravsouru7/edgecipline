const User = require("../../models/Users");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { appConfig } = require("../../config");
const ApiError = require("../../utils/ApiError");
const asyncHandler = require("../../utils/asyncHandler");
const { ADMIN_COOKIE_NAME } = require("../../middleware/adminAuth");
const { invalidateAuthCache } = require("../../services/authCacheService");

// Admin sessions last 8 hours — long enough for a working session, short enough to limit exposure.
// Stored in httpOnly cookie, never in localStorage.
const ADMIN_TOKEN_EXPIRY = "8h";
const ADMIN_COOKIE_MAX_AGE = 8 * 60 * 60 * 1000;

// Use a dedicated secret so admin tokens cannot be confused with user tokens.
const ADMIN_JWT_SECRET = appConfig.jwt.adminSecret;

// Account lockout thresholds for admin login brute-force protection.
// Shared with the user login endpoint, which accepts these same credentials
// and writes the same counters — see constants/loginPolicy.js.
const { ADMIN_LOGIN_POLICY } = require("../../constants/loginPolicy");
const MAX_ADMIN_LOGIN_ATTEMPTS = ADMIN_LOGIN_POLICY.maxAttempts;
const ADMIN_LOCK_DURATION_MS   = ADMIN_LOGIN_POLICY.lockMs;

function generateAdminToken(user) {
  return jwt.sign(
    { id: String(user._id), role: user.role, tokenVersion: user.tokenVersion ?? 0 },
    ADMIN_JWT_SECRET,
    { algorithm: "HS256", expiresIn: ADMIN_TOKEN_EXPIRY }
  );
}

function getAdminCookieOptions() {
  const isProduction = appConfig.env === "production";
  // Cross-origin admin UI (e.g. Vercel) cannot use SameSite=strict cookies; Bearer token is primary.
  const crossSite = process.env.ADMIN_COOKIE_CROSS_SITE === "true";
  return {
    httpOnly: true,
    secure: isProduction || crossSite,
    sameSite: crossSite ? "none" : isProduction ? "strict" : "lax",
    maxAge: ADMIN_COOKIE_MAX_AGE,
    path: "/api/admin",
  };
}

function getClearAdminCookieOptions() {
  return { ...getAdminCookieOptions(), maxAge: 0 };
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

  const user = await User.findOne({ email })
    .select("+password +loginAttempts +loginLockedUntil");

  // Check lockout BEFORE bcrypt to avoid burning CPU on locked accounts.
  if (user && user.loginLockedUntil && user.loginLockedUntil > Date.now()) {
    throw new ApiError(
      429,
      "Admin account temporarily locked due to too many failed attempts. Please try again later.",
      "ACCOUNT_LOCKED"
    );
  }

  // Always run bcrypt compare to prevent timing attacks that reveal whether
  // the email exists. Use a dummy hash when the user is not found.
  const DUMMY_HASH =
    "$2b$10$uoTOWGbsKyWDN1ii2upYa.rZCuba0WtgqWY8QO31i.FuwmsP7kKQ.";
  const candidateHash = (user?.password && user.authProvider !== "google" && user.role === "admin")
    ? user.password
    : DUMMY_HASH;
  const isMatch = await bcrypt.compare(password, candidateHash);

  const isValidAdmin = user && user.role === "admin" && user.authProvider !== "google"
    && user.password && isMatch;

  if (!isValidAdmin) {
    // Track failed attempts only for real admin accounts to avoid leaking
    // whether a non-admin email exists.
    if (user && user.role === "admin") {
      const attempts = (user.loginAttempts || 0) + 1;
      const update = { loginAttempts: attempts };
      if (attempts >= MAX_ADMIN_LOGIN_ATTEMPTS) {
        update.loginLockedUntil = new Date(Date.now() + ADMIN_LOCK_DURATION_MS);
        update.loginAttempts = 0;
      }
      await User.updateOne({ _id: user._id }, update);
    }
    throw new ApiError(401, "Invalid credentials", "INVALID_CREDENTIALS");
  }

  // Successful login — reset attempt counter.
  if (user.loginAttempts || user.loginLockedUntil) {
    await User.updateOne({ _id: user._id }, { loginAttempts: 0, loginLockedUntil: null });
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
 * Admin Logout-All
 * POST /api/admin/auth/logout-all
 * Increments tokenVersion, invalidating all outstanding admin JWTs for this account.
 * Clears the current session cookie. Requires an active admin session.
 */
exports.logoutAllAdmin = asyncHandler(async (req, res) => {
  if (!req.user) throw new ApiError(401, "Not authorized", "AUTH_FAILED");

  await User.findByIdAndUpdate(req.user._id, { $inc: { tokenVersion: 1 } });
  await invalidateAuthCache(req.user._id);

  res.clearCookie(ADMIN_COOKIE_NAME, getClearAdminCookieOptions());
  res.json({ success: true, message: "All admin sessions revoked. Please login again." });
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
