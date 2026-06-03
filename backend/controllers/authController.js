const crypto = require("crypto");
const User = require("../models/Users");
const bcrypt = require("bcryptjs");
const { sendOTPEmail } = require("../services/mailService");
const { appConfig } = require("../config");
const { getFirebaseAdmin } = require("../config/firebaseAdmin");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");
const { CURRENT_TERMS_VERSION } = require("../constants/terms");
const {
  generateAccessToken,
  createRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
  getCookieOptions,
  getClearCookieOptions,
  REFRESH_COOKIE_NAME,
} = require("../services/tokenService");

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCK_DURATION_MS = 15 * 60 * 1000;

// Dummy bcrypt hash used to keep login response time constant even when the
// email doesn't exist — prevents timing-based user enumeration.
const DUMMY_BCRYPT_HASH = "$2b$10$invalidsaltinvalidsaltinvalidsal" + "tXXXXXXXXXXXXXXXXXXXX";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function normalizeEmail(email) {
  return (email || "").toLowerCase().trim();
}

// ---------------------------------------------------------------------------
// Password validation
// ---------------------------------------------------------------------------

/**
 * Enforces minimum password complexity.
 * Throws ApiError if requirements are not met.
 * Requirements: 8+ chars, at least one uppercase, lowercase, digit, and special char.
 */
function validatePasswordStrength(password) {
  if (!password || typeof password !== "string") {
    throw new ApiError(400, "Password is required", "VALIDATION_ERROR");
  }
  if (password.length < 8) {
    throw new ApiError(400, "Password must be at least 8 characters", "WEAK_PASSWORD");
  }
  if (!/[A-Z]/.test(password)) {
    throw new ApiError(400, "Password must contain at least one uppercase letter", "WEAK_PASSWORD");
  }
  if (!/[a-z]/.test(password)) {
    throw new ApiError(400, "Password must contain at least one lowercase letter", "WEAK_PASSWORD");
  }
  if (!/[0-9]/.test(password)) {
    throw new ApiError(400, "Password must contain at least one number", "WEAK_PASSWORD");
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    throw new ApiError(400, "Password must contain at least one special character", "WEAK_PASSWORD");
  }
}

function needsTermsAcceptance(user) {
  return (
    user?.termsAcceptance?.acceptedTerms !== true ||
    user?.termsAcceptance?.acceptedPrivacy !== true ||
    user?.termsAcceptance?.termsVersion !== CURRENT_TERMS_VERSION
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Returns true when the request comes from the Capacitor Android app. */
function isCapacitorRequest(req) {
  const origin = req.headers.origin || "";
  return origin.startsWith("capacitor://");
}

/**
 * Issues an access token + refresh token pair for a user.
 * - Access token: short-lived JWT returned in the response body (backward compat).
 * - Refresh token: long-lived opaque token set as an httpOnly cookie.
 *
 * This is the ONLY place tokens are issued after authentication. All login paths
 * (local, Google, refresh) funnel through here so the policy is consistent.
 */
async function issueTokenPair(user, req, res) {
  const deviceInfo = {
    userAgent: (req.headers["user-agent"] || "").slice(0, 512),
    ip: req.ip || "",
  };

  const accessToken = generateAccessToken(user._id, user.role, user.tokenVersion);
  const rawRefresh = await createRefreshToken(user._id, deviceInfo);

  res.cookie(REFRESH_COOKIE_NAME, rawRefresh, getCookieOptions(isCapacitorRequest(req)));
  return accessToken;
}

// ---------------------------------------------------------------------------
// Google token verification (Firebase Admin SDK preferred, raw Google API fallback)
// ---------------------------------------------------------------------------

async function verifyFirebaseToken(firebaseIdToken) {
  try {
    const admin = getFirebaseAdmin();
    return await admin.auth().verifyIdToken(firebaseIdToken);
  } catch (error) {
    if (error?.code === "FIREBASE_CONFIG_MISSING") {
      throw new ApiError(500, "Server misconfigured for Firebase login", "FIREBASE_CONFIG_MISSING");
    }
    throw new ApiError(401, "Firebase authentication failed", "AUTH_FAILED");
  }
}

async function verifyGoogleIdToken(googleIdToken) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  let response;
  try {
    response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(googleIdToken)}`,
      { signal: controller.signal }
    );
  } catch (err) {
    if (err.name === "AbortError") {
      throw new ApiError(504, "Google token verification timed out", "GOOGLE_AUTH_TIMEOUT");
    }
    throw new ApiError(502, "Unable to reach Google token verification service", "GOOGLE_AUTH_UNAVAILABLE");
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new ApiError(401, "Google authentication failed", "AUTH_FAILED");
  }

  const payload = await response.json();
  const emailVerified = payload.email_verified === true || payload.email_verified === "true";

  if (!["accounts.google.com", "https://accounts.google.com"].includes(payload.iss)) {
    throw new ApiError(401, "Invalid Google token issuer", "AUTH_FAILED");
  }
  if (!payload.email || !emailVerified) {
    throw new ApiError(401, "Google email not verified", "AUTH_FAILED");
  }

  return {
    email: payload.email,
    email_verified: true,
    name: payload.name,
    given_name: payload.given_name,
    family_name: payload.family_name,
    picture: payload.picture,
    sub: payload.sub,
    provider: "google.com",
  };
}

// ---------------------------------------------------------------------------
// Auth controllers
// ---------------------------------------------------------------------------

exports.registerUser = asyncHandler(async (req, res) => {
  const { name, email, password, acceptedTerms, acceptedPrivacy } = req.body;

  if (!name || !email || !password) {
    throw new ApiError(400, "All fields are required (name, email, password)", "VALIDATION_ERROR");
  }
  if (!EMAIL_REGEX.test(email)) {
    throw new ApiError(400, "Invalid email address", "VALIDATION_ERROR");
  }
  if (!acceptedTerms || !acceptedPrivacy) {
    throw new ApiError(400, "You must accept the Terms & Privacy Policy to continue", "TERMS_NOT_ACCEPTED");
  }

  validatePasswordStrength(password);

  const userExists = await User.findOne({ email: normalizeEmail(email) });
  if (userExists) {
    throw new ApiError(400, "User already exists", "VALIDATION_ERROR");
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  const user = await User.create({
    name,
    email,
    password: hashedPassword,
    authProvider: "local",
    termsAcceptance: {
      acceptedTerms: true,
      acceptedPrivacy: true,
      acceptedAt: new Date(),
      termsVersion: CURRENT_TERMS_VERSION,
    },
  });

  const token = await issueTokenPair(user, req, res);

  res.status(201).json({
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    token,
  });
});

exports.loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email: normalizeEmail(email) }).select("+password +loginAttempts +loginLockedUntil");

  // Account lockout check before expensive bcrypt comparison
  if (user?.loginLockedUntil && user.loginLockedUntil > new Date()) {
    const retryAfterMin = Math.ceil((user.loginLockedUntil - Date.now()) / 60000);
    throw new ApiError(429, `Account temporarily locked. Try again in ${retryAfterMin} minute(s).`, "ACCOUNT_LOCKED");
  }

  if (user?.authProvider === "google") {
    throw new ApiError(401, "This account uses Google sign-in. Please continue with Google.", "AUTH_PROVIDER_MISMATCH");
  }

  // Always run bcrypt even for unknown emails so response time is constant,
  // preventing an attacker from enumerating registered addresses via timing.
  const candidateHash = user?.password || DUMMY_BCRYPT_HASH;
  const isPasswordValid = await bcrypt.compare(password, candidateHash);

  if (!user || !isPasswordValid) {
    if (user) {
      user.loginAttempts = (user.loginAttempts || 0) + 1;
      if (user.loginAttempts >= LOGIN_MAX_ATTEMPTS) {
        user.loginLockedUntil = new Date(Date.now() + LOGIN_LOCK_DURATION_MS);
        user.loginAttempts = 0;
      }
      await user.save();
    }
    throw new ApiError(401, "Invalid credentials", "INVALID_CREDENTIALS");
  }

  user.loginAttempts = 0;
  user.loginLockedUntil = undefined;
  user.lastLogin = new Date();
  await user.save();

  const needsTerms = needsTermsAcceptance(user);
  const token = await issueTokenPair(user, req, res);

  res.json({
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    token,
    requiresTermsAcceptance: needsTerms || undefined,
  });
});

exports.googleLogin = asyncHandler(async (req, res) => {
  const { idToken, credential } = req.body || {};
  const authToken = idToken || credential;

  if (!authToken) {
    throw new ApiError(400, "Missing Google or Firebase ID token", "VALIDATION_ERROR");
  }

  let decodedToken;
  let signInProvider;
  let email;
  let emailVerified;
  let googleId;

  try {
    decodedToken = await verifyFirebaseToken(authToken);
    const identities = decodedToken.firebase?.identities || {};
    signInProvider = decodedToken.firebase?.sign_in_provider;
    email = decodedToken.email;
    emailVerified = decodedToken.email_verified;
    googleId = identities["google.com"]?.[0] || decodedToken.uid;
  } catch (firebaseError) {
    decodedToken = await verifyGoogleIdToken(authToken);
    signInProvider = decodedToken.provider;
    email = decodedToken.email;
    emailVerified = decodedToken.email_verified;
    googleId = decodedToken.sub;
  }

  if (!email || !emailVerified) {
    throw new ApiError(401, "Google email not verified", "AUTH_FAILED");
  }
  if (signInProvider !== "google.com") {
    throw new ApiError(401, "Unsupported Firebase sign-in provider", "AUTH_FAILED");
  }

  const name =
    decodedToken.name ||
    (decodedToken.given_name
      ? `${decodedToken.given_name} ${decodedToken.family_name || ""}`.trim()
      : "Trader");
  const avatar = decodedToken.picture || null;

  // Block Google sign-in for accounts that were registered with a password.
  // Without this check, Google login silently overwrites authProvider to "google"
  // and permanently locks the user out of their password login.
  const existingUser = await User.findOne({ email: normalizeEmail(email) });
  if (existingUser && existingUser.authProvider === "local") {
    throw new ApiError(
      409,
      "This email is already registered with a password. Please sign in with your password instead.",
      "AUTH_PROVIDER_CONFLICT"
    );
  }

  const now = new Date();
  const setPayload = {
    name,
    authProvider: "google",
    lastLogin: now,
    ...(googleId ? { googleId } : {}),
    ...(avatar ? { avatar } : {}),
  };

  let user;
  try {
    user = await User.findOneAndUpdate(
      { email: normalizeEmail(email) },
      {
        $set: setPayload,
        $setOnInsert: {
          email: normalizeEmail(email),
          termsAcceptance: {
            acceptedTerms: false,
            acceptedPrivacy: false,
            acceptedAt: null,
            termsVersion: null,
          },
        },
      },
      { upsert: true, new: true, runValidators: true }
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;
    user = await User.findOneAndUpdate(
      { email: normalizeEmail(email) },
      { $set: setPayload },
      { new: true, runValidators: true }
    );
  }

  const needsTerms = needsTermsAcceptance(user);
  const token = await issueTokenPair(user, req, res);

  res.json({
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    token,
    requiresTermsAcceptance: needsTerms || undefined,
  });
});

/**
 * POST /api/auth/refresh
 *
 * Silent token refresh — client sends the httpOnly refresh-token cookie,
 * gets back a new short-lived access token + a rotated refresh cookie.
 *
 * On replay detection the entire token family is revoked; the user must
 * re-authenticate from scratch.
 */
exports.refreshToken = asyncHandler(async (req, res) => {
  const rawToken = req.cookies?.[REFRESH_COOKIE_NAME];

  if (!rawToken) {
    throw new ApiError(401, "Session expired, please login again", "AUTH_REQUIRED");
  }

  const deviceInfo = {
    userAgent: (req.headers["user-agent"] || "").slice(0, 512),
    ip: req.ip || "",
  };

  const isCapacitor = isCapacitorRequest(req);

  let rotated;
  try {
    rotated = await rotateRefreshToken(rawToken, deviceInfo);
  } catch (err) {
    // On any token error, clear the stale cookie so the browser stops sending it
    res.clearCookie(REFRESH_COOKIE_NAME, getClearCookieOptions(isCapacitor));
    throw err;
  }

  const newAccessToken = generateAccessToken(
    rotated.userId,
    rotated.role,
    rotated.tokenVersion
  );

  res.cookie(REFRESH_COOKIE_NAME, rotated.newRawToken, getCookieOptions(isCapacitor));
  res.json({ token: newAccessToken });
});

/**
 * POST /api/auth/logout
 *
 * Revokes the presented refresh token so it can never be rotated again.
 * Clears the cookie. The short-lived access token will naturally expire.
 * Does NOT require authentication — it's idempotent and safe to call even
 * if the session is already invalid.
 */
exports.logoutUser = asyncHandler(async (req, res) => {
  const rawToken = req.cookies?.[REFRESH_COOKIE_NAME];

  if (rawToken) {
    // Best-effort — don't fail logout if DB is momentarily unavailable
    revokeRefreshToken(rawToken).catch(() => {});
  }

  res.clearCookie(REFRESH_COOKIE_NAME, getClearCookieOptions(isCapacitorRequest(req)));
  res.json({ success: true, message: "Logged out successfully" });
});

/**
 * POST /api/auth/logout-all
 *
 * Revokes ALL active sessions for the authenticated user (requires valid access token).
 * Also increments tokenVersion so any in-flight access tokens are rejected.
 */
exports.logoutAll = asyncHandler(async (req, res) => {
  if (!req.user) throw new ApiError(401, "Not authorized", "AUTH_FAILED");

  await Promise.all([
    revokeAllUserTokens(req.user._id),
    User.findByIdAndUpdate(req.user._id, { $inc: { tokenVersion: 1 } }),
  ]);

  res.clearCookie(REFRESH_COOKIE_NAME, getClearCookieOptions(isCapacitorRequest(req)));
  res.json({ success: true, message: "All sessions revoked. Please login again." });
});

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

exports.getMe = asyncHandler(async (req, res) => {
  if (!req.user) throw new ApiError(401, "Not authorized", "AUTH_FAILED");

  const needsTerms = needsTermsAcceptance(req.user);

  res.json({
    _id: req.user._id,
    name: req.user.name,
    email: req.user.email,
    role: req.user.role,
    createdAt: req.user.createdAt,
    requiresTermsAcceptance: needsTerms || undefined,
  });
});

exports.getMyPreferences = asyncHandler(async (req, res) => {
  if (!req.user) throw new ApiError(401, "Not authorized", "AUTH_FAILED");

  // isOnboardingCompleted tracks the new joyride tour independently.
  // hasSeenWelcomeGuide is kept for legacy compatibility only.
  res.json({
    hasSeenWelcomeGuide: Boolean(req.user.hasSeenWelcomeGuide),
    isOnboardingCompleted: Boolean(req.user.isOnboardingCompleted),
  });
});

exports.updateMyPreferences = asyncHandler(async (req, res) => {
  if (!req.user) throw new ApiError(401, "Not authorized", "AUTH_FAILED");

  const body = req.body || {};
  const updates = {};

  if (Object.prototype.hasOwnProperty.call(body, "hasSeenWelcomeGuide")) {
    updates.hasSeenWelcomeGuide = Boolean(body.hasSeenWelcomeGuide);
  }
  if (Object.prototype.hasOwnProperty.call(body, "isOnboardingCompleted")) {
    updates.isOnboardingCompleted = Boolean(body.isOnboardingCompleted);
    // Keep hasSeenWelcomeGuide in sync so legacy code stays consistent
    updates.hasSeenWelcomeGuide = Boolean(body.isOnboardingCompleted);
  }

  if (Object.keys(updates).length === 0) {
    throw new ApiError(400, "No valid preferences provided", "VALIDATION_ERROR");
  }

  const user = await User.findByIdAndUpdate(
    req.user._id,
    { $set: updates },
    { new: true, runValidators: true }
  );

  res.json({
    hasSeenWelcomeGuide: Boolean(user?.hasSeenWelcomeGuide),
    isOnboardingCompleted: Boolean(user?.isOnboardingCompleted),
  });
});

exports.acceptTerms = asyncHandler(async (req, res) => {
  if (!req.user) throw new ApiError(401, "Not authorized", "AUTH_FAILED");

  await User.findByIdAndUpdate(
    req.user._id,
    {
      $set: {
        "termsAcceptance.acceptedTerms": true,
        "termsAcceptance.acceptedPrivacy": true,
        "termsAcceptance.acceptedAt": new Date(),
        "termsAcceptance.termsVersion": CURRENT_TERMS_VERSION,
      },
    },
    { runValidators: false }
  );

  res.json({ success: true, message: "Terms and Privacy Policy accepted." });
});

// ---------------------------------------------------------------------------
// Password reset (OTP flow)
// ---------------------------------------------------------------------------

exports.forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) throw new ApiError(400, "Email is required", "VALIDATION_ERROR");

  const user = await User.findOne({ email: normalizeEmail(email) });

  // Always return the same response to prevent user enumeration
  if (!user || user.authProvider === "google") {
    return res.json({ message: "If that email is registered, an OTP has been sent." });
  }

  const otp = String(crypto.randomInt(100000, 1000000));
  user.resetPasswordOTP = hashOtp(otp); // store hash, never the raw OTP
  user.resetPasswordOTPExpires = Date.now() + 10 * 60 * 1000;
  user.otpAttempts = 0;
  user.otpLockUntil = undefined;
  await user.save();

  await sendOTPEmail(email, otp); // raw OTP sent in email only
  res.json({ message: "If that email is registered, an OTP has been sent." });
});

const OTP_MAX_ATTEMPTS = 3;
const OTP_LOCK_DURATION_MS = 30 * 60 * 1000;

// Hash OTP with SHA-256 before storing — same pattern as refresh tokens.
// If DB is breached, raw OTPs are not exposed.
function hashOtp(otp) {
  return crypto.createHash("sha256").update(String(otp || "")).digest("hex");
}

// Timing-safe comparison of two SHA-256 hex digests (both 64 chars).
function timingSafeHashEquals(storedHash, candidateHash) {
  if (!storedHash || !candidateHash) return false;
  if (storedHash.length !== candidateHash.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(storedHash), Buffer.from(candidateHash));
  } catch {
    return false;
  }
}

exports.verifyOTP = asyncHandler(async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) throw new ApiError(400, "Email and OTP are required", "VALIDATION_ERROR");

  const user = await User.findOne({ email: normalizeEmail(email) });
  if (!user || user.authProvider === "google") {
    throw new ApiError(400, "Invalid or expired OTP", "VALIDATION_ERROR");
  }

  if (user.otpLockUntil && user.otpLockUntil > new Date()) {
    const retryAfterMin = Math.ceil((user.otpLockUntil - Date.now()) / 60000);
    throw new ApiError(429, `Too many failed attempts. Try again in ${retryAfterMin} minute(s).`, "OTP_LOCKED");
  }

  const isValid =
    timingSafeHashEquals(user.resetPasswordOTP, hashOtp(otp)) &&
    user.resetPasswordOTPExpires &&
    user.resetPasswordOTPExpires > new Date();

  if (!isValid) {
    user.otpAttempts = (user.otpAttempts || 0) + 1;
    if (user.otpAttempts >= OTP_MAX_ATTEMPTS) {
      user.otpLockUntil = new Date(Date.now() + OTP_LOCK_DURATION_MS);
      user.otpAttempts = 0;
    }
    await user.save();
    throw new ApiError(400, "Invalid or expired OTP", "VALIDATION_ERROR");
  }

  // OTP is valid — clear it immediately so it cannot be reused.
  // Issue a short-lived opaque reset token (valid 10 min) that resetPassword
  // validates instead of requiring the OTP a second time.
  const resetToken = crypto.randomBytes(32).toString("hex");
  user.otpAttempts = 0;
  user.otpLockUntil = undefined;
  user.resetPasswordOTP = undefined;
  user.resetPasswordOTPExpires = undefined;
  user.resetPasswordToken = resetToken;
  user.resetPasswordTokenExpires = new Date(Date.now() + 10 * 60 * 1000);
  await user.save();

  res.json({ message: "OTP verified. You can now reset your password.", resetToken });
});

exports.resetPassword = asyncHandler(async (req, res) => {
  const { email, resetToken, password } = req.body;
  if (!email || !resetToken || !password) {
    throw new ApiError(400, "All fields are required (email, resetToken, password)", "VALIDATION_ERROR");
  }

  validatePasswordStrength(password);

  const user = await User.findOne({ email: normalizeEmail(email) });
  if (!user || user.authProvider === "google") {
    throw new ApiError(400, "Invalid or expired reset token", "VALIDATION_ERROR");
  }

  // Validate the short-lived reset token issued by verifyOTP
  const isValid =
    user.resetPasswordToken &&
    user.resetPasswordTokenExpires &&
    user.resetPasswordTokenExpires > new Date() &&
    crypto.timingSafeEqual(
      Buffer.from(user.resetPasswordToken),
      Buffer.from(resetToken)
    );

  if (!isValid) {
    throw new ApiError(400, "Invalid or expired reset token. Please request a new OTP.", "VALIDATION_ERROR");
  }

  const salt = await bcrypt.genSalt(10);
  user.password = await bcrypt.hash(password, salt);
  user.resetPasswordToken = undefined;
  user.resetPasswordTokenExpires = undefined;
  user.otpAttempts = 0;
  user.otpLockUntil = undefined;
  // Bump tokenVersion — invalidates all existing JWT access tokens immediately.
  // Also revoke all refresh tokens so every device must re-authenticate.
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();

  await revokeAllUserTokens(user._id);

  res.json({ message: "Password reset successful. Please login with your new password." });
});
