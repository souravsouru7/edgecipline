
const crypto = require("crypto");
const User = require("../models/Users");
const DeviceToken = require("../models/DeviceToken");
const bcrypt = require("bcryptjs");
const { sendOTPEmail } = require("../services/mailService");
const { appConfig } = require("../config");
const { getFirebaseAdmin } = require("../config/firebaseAdmin");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");
const { logger } = require("../utils/logger");
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
const { invalidateAuthCache } = require("../services/authCacheService");
const { buildTrialStart, TRIAL_DAYS } = require("../utils/premium");
const analytics = require("../services/analyticsEventService");
const { invalidateTradeCaches } = require("../utils/cacheUtils");
const { deleteAccount } = require("../services/accountDeletionService");

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCK_DURATION_MS = 15 * 60 * 1000;

// Dummy bcrypt hash used to keep login response time constant even when the
// email doesn't exist — prevents timing-based user enumeration.
const DUMMY_BCRYPT_HASH =
  "$2b$10$uoTOWGbsKyWDN1ii2upYa.rZCuba0WtgqWY8QO31i.FuwmsP7kKQ.";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Non-string input (array, number, null) is coerced to "" rather than throwing.
// `sanitizeInput` already rejects Mongo operator keys, but a JSON array body
// like {"email":["a@b.c"]} would otherwise reach .toLowerCase() and 500.
function normalizeEmail(email) {
  return typeof email === "string" ? email.toLowerCase().trim() : "";
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

function isAccountActive(user) {
  return !user?.accountStatus || user.accountStatus === "active";
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Returns true when the request comes from the Capacitor Android app. */
function isCapacitorRequest(req) {
  const origin = req.headers.origin || "";
  const clientPlatform = String(req.headers["x-client-platform"] || "").toLowerCase();
  return origin.startsWith("capacitor://") || clientPlatform === "capacitor";
}

function getAuthRequestDiagnostics(req) {
  return {
    userId: req.user?._id ? String(req.user._id) : null,
    deviceId: String(req.headers["x-device-id"] || "").slice(0, 100) || null,
    sessionId: String(req.headers["x-session-id"] || "").slice(0, 100) || null,
    tokenFamilyId: null,
    platform: isCapacitorRequest(req) ? "capacitor" : "web",
    origin: req.headers.origin || "",
    referer: req.headers.referer || "",
    clientPlatform: req.headers["x-client-platform"] || "",
    userAgent: (req.headers["user-agent"] || "").slice(0, 120),
    isCapacitor: isCapacitorRequest(req),
    hasRefreshCookie: Boolean(req.cookies?.[REFRESH_COOKIE_NAME]),
    cookieNames: Object.keys(req.cookies || {}),
  };
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
    deviceId: String(req.headers["x-device-id"] || "").slice(0, 100),
    sessionId: String(req.headers["x-session-id"] || "").slice(0, 100),
  };

  const accessToken = generateAccessToken(user._id, user.role, user.tokenVersion);
  const rawRefresh = await createRefreshToken(user._id, deviceInfo);

  res.cookie(REFRESH_COOKIE_NAME, rawRefresh, getCookieOptions(isCapacitorRequest(req)));
  logger.info("AUTH_LOGIN_SUCCESS", {
    ...getAuthRequestDiagnostics(req),
    userId: String(user._id),
  });
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
  if (!appConfig.firebase.projectId) {
    throw new ApiError(500, "Server misconfigured for Firebase login", "FIREBASE_CONFIG_MISSING");
  }
  if (payload.aud !== appConfig.firebase.projectId) {
    throw new ApiError(401, "Google token was issued for a different project", "AUTH_FAILED");
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
    ...buildTrialStart({ source: "auto_register" }),
  });

  analytics.track("trial_started", {
    userId: user._id,
    properties: {
      source: "auto_register",
      authProvider: "local",
      trialDays: TRIAL_DAYS,
      endsAt: user.trial?.endsAt,
    },
  });

  const token = await issueTokenPair(user, req, res);

  res.status(201).json({
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    token,
    trial: {
      endsAt: user.trial?.endsAt,
      daysRemaining: TRIAL_DAYS,
    },
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

  if (!user || !isPasswordValid || !isAccountActive(user)) {
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

  // Trial is NOT granted here — Google users haven't accepted terms yet.
  // Granting on insert would start the 7-day clock for users who bounce on
  // the terms screen. acceptTerms() applies the trial once they consent.

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
    trial: user?.trial?.endsAt ? { endsAt: user.trial.endsAt } : undefined,
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
  const authDiagnostics = getAuthRequestDiagnostics(req);

  logger.info("AUTH_REFRESH_START", authDiagnostics);

  if (!rawToken) {
    logger.warn("REFRESH_COOKIE_MISSING", authDiagnostics);
    throw new ApiError(401, "Session expired, please login again", "AUTH_REQUIRED");
  }

  const deviceInfo = {
    userAgent: (req.headers["user-agent"] || "").slice(0, 512),
    ip: req.ip || "",
    deviceId: String(req.headers["x-device-id"] || "").slice(0, 100),
    sessionId: String(req.headers["x-session-id"] || "").slice(0, 100),
  };

  const isCapacitor = isCapacitorRequest(req);

  let rotated;
  try {
    rotated = await rotateRefreshToken(rawToken, deviceInfo);
  } catch (err) {
    // A near-simultaneous duplicate refresh should wait/retry on the client.
    // Clearing the cookie here would turn a recoverable race into a logout.
    const terminalFailure = err?.statusCode === 401 && err?.errorCode !== "REFRESH_TOKEN_RACE";
    if (terminalFailure) {
      res.clearCookie(REFRESH_COOKIE_NAME, getClearCookieOptions(isCapacitor));
    }
    logger.warn(err?.errorCode === "TOKEN_REPLAY_DETECTED" ? "AUTH_REFRESH_REPLAY" : "AUTH_REFRESH_FAILED", {
      ...authDiagnostics,
      errorCode: err?.errorCode,
      statusCode: err?.statusCode,
      message: err?.message,
    });
    throw err;
  }

  const newAccessToken = generateAccessToken(
    rotated.userId,
    rotated.role,
    rotated.tokenVersion
  );

  res.cookie(REFRESH_COOKIE_NAME, rotated.newRawToken, getCookieOptions(isCapacitor));
  logger.info("AUTH_REFRESH_SUCCESS", {
    ...authDiagnostics,
    userId: String(rotated.userId),
    tokenFamilyId: rotated.family || null,
  });
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
// Disables the push token for the device that just logged out (identified by
// the same X-Device-ID header used elsewhere for diagnostics), so a
// shared/borrowed device stops receiving this account's notifications the
// moment it signs out — without touching any other device the user is still
// logged into elsewhere. Best-effort: logout must never fail because of this.
async function disableDeviceTokenForRequest(userId, req) {
  if (!userId) return;
  const deviceId = String(req.headers["x-device-id"] || "").slice(0, 100);
  if (!deviceId) return;
  await DeviceToken.updateMany(
    { user: userId, deviceId, enabled: true },
    { enabled: false, revokedAt: new Date() }
  );
}

exports.logoutUser = asyncHandler(async (req, res) => {
  const rawToken = req.cookies?.[REFRESH_COOKIE_NAME];
  logger.info("AUTH_LOGOUT_TRIGGERED", getAuthRequestDiagnostics(req));

  if (rawToken) {
    // Best-effort — don't fail logout if DB is momentarily unavailable
    revokeRefreshToken(rawToken)
      .then((userId) => disableDeviceTokenForRequest(userId, req))
      .catch(() => {});
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
    // "Everywhere" logout — unlike single-device logout, disable every
    // device this user has ever registered, not just the one that asked.
    DeviceToken.updateMany(
      { user: req.user._id, enabled: true },
      { enabled: false, revokedAt: new Date() }
    ),
  ]);

  // Drop the auth cache so the next request loads the new tokenVersion from
  // MongoDB and rejects all in-flight access tokens.
  await invalidateAuthCache(req.user._id);

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

const ONBOARDING_STEPS = [
  "welcomeSeen",
  "marketSelected",
  "styleSelected",
  "setupAdded",
  "tradeAdded",
  "tradeSkipped",
  "firstInsightSeen",
  "journalSeen",
  "analyticsSeen",
  "notificationsSeen",
  "tourCompleted",
  "checklistDismissed",
];

function serializeOnboarding(user) {
  const o = user?.onboarding || {};
  return {
    welcomeSeen:        Boolean(o.welcomeSeen),
    marketSelected:     Boolean(o.marketSelected),
    styleSelected:      Boolean(o.styleSelected),
    setupAdded:         Boolean(o.setupAdded),
    tradeAdded:         Boolean(o.tradeAdded),
    tradeSkipped:       Boolean(o.tradeSkipped),
    firstInsightSeen:   Boolean(o.firstInsightSeen),
    journalSeen:        Boolean(o.journalSeen),
    analyticsSeen:      Boolean(o.analyticsSeen),
    notificationsSeen:  Boolean(o.notificationsSeen),
    tourCompleted:      Boolean(o.tourCompleted),
    checklistDismissed: Boolean(o.checklistDismissed),
    startedAt:               o.startedAt || null,
    firstTradeAt:            o.firstTradeAt || null,
    firstScreenshotUploadAt: o.firstScreenshotUploadAt || null,
    firstInsightAt:          o.firstInsightAt || null,
    completedAt:             o.completedAt || null,
  };
}

exports.getMyPreferences = asyncHandler(async (req, res) => {
  if (!req.user) throw new ApiError(401, "Not authorized", "AUTH_FAILED");

  // isOnboardingCompleted tracks the new joyride tour independently.
  // hasSeenWelcomeGuide is kept for legacy compatibility only.
  res.json({
    hasSeenWelcomeGuide: Boolean(req.user.hasSeenWelcomeGuide),
    isOnboardingCompleted: Boolean(req.user.isOnboardingCompleted),
    preferredMarket: req.user.preferredMarket || null,
    onboarding: serializeOnboarding(req.user),
  });
});

exports.updateOnboardingStep = asyncHandler(async (req, res) => {
  if (!req.user) throw new ApiError(401, "Not authorized", "AUTH_FAILED");

  const { step, value } = req.body || {};
  if (!ONBOARDING_STEPS.includes(step)) {
    throw new ApiError(400, "Invalid onboarding step", "VALIDATION_ERROR");
  }

  const truthy = value === undefined ? true : Boolean(value);
  const set = { [`onboarding.${step}`]: truthy };
  if (truthy && step === "tourCompleted") {
    set["onboarding.checklistDismissed"] = true;
  }
  if (
    truthy &&
    !["welcomeSeen", "checklistDismissed"].includes(step)
  ) {
    set["onboarding.welcomeSeen"] = true;
  }
  const update = { $set: set };

  const user = await User.findByIdAndUpdate(req.user._id, update, { new: true });

  const o = user?.onboarding || {};
  const coreDone =
    o.welcomeSeen &&
    o.marketSelected &&
    o.setupAdded &&
    o.tradeAdded &&
    o.journalSeen;
  if (coreDone && !o.completedAt) {
    user.onboarding.completedAt = new Date();
    user.isOnboardingCompleted = true;
    user.hasSeenWelcomeGuide = true;
    await user.save();
  }

  await invalidateAuthCache(req.user._id);
  await invalidateTradeCaches({
    userId: req.user._id,
    event: "onboarding_update",
    source: "auth_onboarding_step",
  });

  res.json({ onboarding: serializeOnboarding(user) });
});

const VALID_MARKETS = ["Forex", "Indian_Market"];

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
  if (Object.prototype.hasOwnProperty.call(body, "preferredMarket")) {
    if (body.preferredMarket !== null && !VALID_MARKETS.includes(body.preferredMarket)) {
      throw new ApiError(400, "Invalid preferredMarket", "VALIDATION_ERROR");
    }
    updates.preferredMarket = body.preferredMarket;
  }

  if (Object.keys(updates).length === 0) {
    throw new ApiError(400, "No valid preferences provided", "VALIDATION_ERROR");
  }

  const user = await User.findByIdAndUpdate(
    req.user._id,
    { $set: updates },
    { new: true, runValidators: true }
  );

  // hasSeenWelcomeGuide / isOnboardingCompleted are cached fields.
  await invalidateAuthCache(req.user._id);

  res.json({
    hasSeenWelcomeGuide: Boolean(user?.hasSeenWelcomeGuide),
    isOnboardingCompleted: Boolean(user?.isOnboardingCompleted),
    preferredMarket: user?.preferredMarket || null,
  });
});

exports.acceptTerms = asyncHandler(async (req, res) => {
  if (!req.user) throw new ApiError(401, "Not authorized", "AUTH_FAILED");

  // First-time terms acceptance also kicks off the 7-day trial. Email signups
  // already got their trial in registerUser; this path covers Google users
  // who only land here after consent. Idempotent — never re-grants if
  // trial.used is true.
  const set = {
    "termsAcceptance.acceptedTerms":   true,
    "termsAcceptance.acceptedPrivacy": true,
    "termsAcceptance.acceptedAt":      new Date(),
    "termsAcceptance.termsVersion":    CURRENT_TERMS_VERSION,
  };

  const shouldGrantTrial = !req.user.trial?.used;
  let trialPayload = null;
  if (shouldGrantTrial) {
    trialPayload = buildTrialStart({ source: "auto_register" }).trial;
    Object.assign(set, {
      "trial.startedAt":  trialPayload.startedAt,
      "trial.endsAt":     trialPayload.endsAt,
      "trial.used":       trialPayload.used,
      "trial.source":     trialPayload.source,
      "trial.extendedBy": trialPayload.extendedBy,
    });
  }

  await User.findByIdAndUpdate(req.user._id, { $set: set }, { runValidators: false });

  // termsAcceptance + trial are cached fields — middleware gate reads them.
  await invalidateAuthCache(req.user._id);

  if (shouldGrantTrial) {
    analytics.track("trial_started", {
      userId: req.user._id,
      properties: {
        source: "auto_register",
        authProvider: req.user.authProvider || "google",
        trialDays: TRIAL_DAYS,
        endsAt: trialPayload.endsAt,
        grantedOnTermsAcceptance: true,
      },
    });
  }

  res.json({
    success: true,
    message: "Terms and Privacy Policy accepted.",
    trial: trialPayload ? { endsAt: trialPayload.endsAt } : undefined,
  });
});

// ---------------------------------------------------------------------------
// Password reset (OTP flow)
// ---------------------------------------------------------------------------

const OTP_MAX_ATTEMPTS = 3;
const OTP_LOCK_DURATION_MS = 30 * 60 * 1000;
const RESET_OTP_TTL_MS = 10 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 10 * 60 * 1000;

// SHA-256 hex. Used for OTPs and reset tokens before they touch the database —
// same pattern as refresh tokens, so a DB breach yields no usable secret.
function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest("hex");
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

// Short, stable identifier for correlating reset activity in logs without
// writing the address itself. Never log the OTP or the reset token.
function emailLogId(normalizedEmail) {
  return sha256Hex(normalizedEmail).slice(0, 12);
}

/**
 * POST /api/auth/forgot-password
 *
 * Answers explicitly: an address with no account gets 404 "No account was
 * found with this email address", a registered one gets "OTP sent
 * successfully". That is a product decision, not an oversight — it trades
 * account-enumeration resistance for a clearer dead end when someone mistypes
 * their address. The auth and per-email rate limiters below are what keep the
 * trade bounded; do not remove them.
 *
 * Database work is two indexed operations and never loads a full user:
 *   1. projected existence read  — findOne({email}).select("_id authProvider").lean()
 *   2. targeted write            — updateOne({_id}, {$set/$unset: ...})
 * The read hits the unique `email_1` index; `.lean()` skips hydrating a
 * Mongoose document, and the write touches only the reset fields instead of
 * re-serialising the whole record the way user.save() did.
 */
exports.forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  // Normalize before anything else: the stored value is lowercased and trimmed
  // by the schema on write, but that never applies to a query filter, so
  // "  User@Example.COM " only matches once it is folded here.
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new ApiError(400, "Email is required", "VALIDATION_ERROR");
  }
  if (!EMAIL_REGEX.test(normalizedEmail)) {
    throw new ApiError(400, "Please enter a valid email address", "VALIDATION_ERROR");
  }

  // Existence check. `authProvider` rides along because the answer depends on
  // it — fetching it here avoids a second round trip, and both fields together
  // are still a fraction of the document.
  const account = await User.findOne({ email: normalizedEmail })
    .select("_id authProvider")
    .lean();

  if (!account) {
    // Nothing is generated, stored, or sent for an address with no account.
    logger.info("Password reset requested for unknown email", {
      emailId: emailLogId(normalizedEmail),
      requestId: req.requestId,
    });
    throw new ApiError(404, "No account was found with this email address.", "ACCOUNT_NOT_FOUND");
  }

  // Google accounts have no password to reset — issuing an OTP would let
  // someone with inbox access bolt a local password onto an SSO account.
  if (account.authProvider === "google") {
    throw new ApiError(
      409,
      "This account signs in with Google, so there is no password to reset. Use \"Continue with Google\" instead.",
      "GOOGLE_ACCOUNT"
    );
  }

  const otp = String(crypto.randomInt(100000, 1000000));
  const now = new Date();

  // Mail first, then persist. The send is by far the likelier of the two to
  // fail (an unverified sender domain fails 100% of the time), and writing the
  // new hash first meant a failed send also destroyed whatever code the user
  // had already been mailed — turning a delivery hiccup into a dead reset for
  // someone who was holding a perfectly good OTP. Nothing changes on the
  // account unless the provider actually accepted the message.
  try {
    await sendOTPEmail(normalizedEmail, otp); // raw OTP leaves the process only in the email
  } catch (error) {
    // A rejected sender domain, a revoked key, or a sandbox key writing to a
    // stranger are configuration faults: they will fail identically on every
    // retry, so telling the user to try again just loops them.
    const permanent = Boolean(error?.permanent);
    logger.error("Password reset OTP delivery failed", {
      emailId: emailLogId(normalizedEmail),
      requestId: req.requestId,
      permanent,
      providerStatus: error?.providerStatus,
      error: error?.message,
    });
    throw new ApiError(
      502,
      permanent
        ? "Password reset email is not available right now. Please contact support so we can reset your password."
        : "We couldn't send the email right now. Please try again in a moment.",
      permanent ? "EMAIL_DELIVERY_UNAVAILABLE" : "EMAIL_DELIVERY_FAILED",
      permanent && appConfig.env !== "production"
        ? {
            operatorHint:
              "Resend is rejecting password reset emails. If RESEND_FROM uses onboarding@resend.dev, Resend only allows sends to the account owner's test email. Verify your real domain in Resend and set RESEND_FROM to an address on that verified domain.",
          }
        : null,
      true
    );
  }

  const newCode = {
    resetPasswordOTP: sha256Hex(otp), // store the hash, never the raw OTP
    resetPasswordOTPExpires: new Date(now.getTime() + RESET_OTP_TTL_MS),
  };
  // A fresh request supersedes any token an earlier verification handed out.
  const dropStaleToken = { resetPasswordToken: "", resetPasswordTokenExpires: "" };

  // An active lockout survives a new request — otherwise three wrong guesses
  // could be cleared just by asking for another code. The "not locked" test is
  // part of the filter, so the common path stays one atomic write with no
  // read-modify-write race.
  const notLocked = {
    _id: account._id,
    $or: [{ otpLockUntil: { $exists: false } }, { otpLockUntil: null }, { otpLockUntil: { $lte: now } }],
  };
  const unlockedWrite = await User.updateOne(notLocked, {
    $set: { ...newCode, otpAttempts: 0 },
    $unset: { ...dropStaleToken, otpLockUntil: "" },
  });

  if (unlockedWrite.matchedCount === 0) {
    // Locked out: still refresh the code, but leave the lockout window intact.
    await User.updateOne({ _id: account._id }, { $set: newCode, $unset: dropStaleToken });
  }

  logger.info("Password reset OTP sent", {
    emailId: emailLogId(normalizedEmail),
    requestId: req.requestId,
  });

  res.json({ message: "OTP sent successfully. Please check your email." });
});

exports.verifyOTP = asyncHandler(async (req, res) => {
  const { email, otp } = req.body;
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !otp) {
    throw new ApiError(400, "Email and OTP are required", "VALIDATION_ERROR");
  }
  // A malformed code can never match a stored hash. Rejecting it here keeps it
  // from burning one of the three attempts on an obvious typo.
  if (!/^\d{6}$/.test(String(otp).trim())) {
    throw new ApiError(400, "Enter the 6-digit code from your email", "VALIDATION_ERROR");
  }

  const user = await User.findOne({ email: normalizedEmail });
  if (!user || user.authProvider === "google") {
    // Same body and status as a wrong code — an unregistered address must not
    // be distinguishable from a registered one that got the digits wrong.
    throw new ApiError(400, "Invalid or expired OTP", "VALIDATION_ERROR");
  }

  if (user.otpLockUntil && user.otpLockUntil > new Date()) {
    const retryAfterMin = Math.ceil((user.otpLockUntil - Date.now()) / 60000);
    throw new ApiError(429, `Too many failed attempts. Try again in ${retryAfterMin} minute(s).`, "OTP_LOCKED");
  }

  const isValid =
    timingSafeHashEquals(user.resetPasswordOTP, sha256Hex(String(otp).trim())) &&
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
  user.resetPasswordToken = sha256Hex(resetToken); // hash at rest, like the OTP
  user.resetPasswordTokenExpires = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  await user.save();

  res.json({ message: "OTP verified. You can now reset your password.", resetToken });
});

exports.resetPassword = asyncHandler(async (req, res) => {
  const { email, resetToken, password } = req.body;
  if (!email || !resetToken || !password) {
    throw new ApiError(400, "All fields are required (email, resetToken, password)", "VALIDATION_ERROR");
  }

  validatePasswordStrength(password);

  const user = await User.findOne({ email: normalizeEmail(email) })
    .select("+password +loginAttempts +loginLockedUntil");
  if (!user || user.authProvider === "google") {
    throw new ApiError(400, "Invalid or expired reset token", "VALIDATION_ERROR");
  }

  // Validate the short-lived reset token issued by verifyOTP. Only its hash is
  // stored, so the candidate is hashed before the timing-safe comparison.
  const isValid =
    timingSafeHashEquals(
      user.resetPasswordToken,
      sha256Hex(typeof resetToken === "string" ? resetToken : "")
    ) &&
    user.resetPasswordTokenExpires &&
    user.resetPasswordTokenExpires > new Date();

  if (!isValid) {
    throw new ApiError(400, "Invalid or expired reset token. Please request a new OTP.", "VALIDATION_ERROR");
  }

  // Re-setting the same password would leave the user locked out with a
  // password they have already proven they cannot remember.
  if (user.password && (await bcrypt.compare(password, user.password))) {
    throw new ApiError(400, "New password must be different from your current password", "WEAK_PASSWORD");
  }

  const salt = await bcrypt.genSalt(10);
  user.password = await bcrypt.hash(password, salt);
  user.resetPasswordToken = undefined;
  user.resetPasswordTokenExpires = undefined;
  user.resetPasswordOTP = undefined;
  user.resetPasswordOTPExpires = undefined;
  user.otpAttempts = 0;
  user.otpLockUntil = undefined;
  // Failed logins are what sent most users here. Leaving the lockout in place
  // means a successful reset still ends at "account temporarily locked".
  user.loginAttempts = 0;
  user.loginLockedUntil = undefined;
  // Bump tokenVersion — invalidates all existing JWT access tokens immediately.
  // Also revoke all refresh tokens so every device must re-authenticate.
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();

  await revokeAllUserTokens(user._id);
  await invalidateAuthCache(user._id);

  res.json({ message: "Password reset successful. Please login with your new password." });
});

/**
 * DELETE /api/auth/account
 *
 * Permanently deletes the authenticated user and all of their personal data.
 *
 * Required by Google Play's User Data policy and Apple App Store Review
 * Guideline 5.1.1(v): an app that lets users create an account must let them
 * delete it from within the app. This is not recoverable and is deliberately
 * not a soft-delete — "deactivate" does not satisfy either policy.
 *
 * Requires the user to retype their exact email as `confirmEmail`. That guard
 * is here rather than only in the UI so the destructive path cannot be hit by
 * a stray client call or a mistyped curl.
 */
exports.deleteMyAccount = asyncHandler(async (req, res) => {
  if (!req.user) throw new ApiError(401, "Not authorized", "AUTH_FAILED");

  // Purging ~24 collections, dropping the Firebase identity and destroying every
  // uploaded image routinely outruns the global 15s API timeout. That timeout
  // does not just answer early — it destroys the socket, cutting the purge off
  // partway and stranding the account disabled-but-not-deleted. This deletion
  // must be allowed to run to completion.
  req.timeoutConfig?.extendTimeout?.(120_000);

  const confirmEmail = String(req.body?.confirmEmail || "").trim().toLowerCase();
  const actualEmail = String(req.user.email || "").trim().toLowerCase();

  if (!confirmEmail) {
    throw new ApiError(
      400,
      "Type your email address to confirm deletion",
      "CONFIRMATION_REQUIRED"
    );
  }
  if (confirmEmail !== actualEmail) {
    throw new ApiError(
      400,
      "The email you typed does not match this account",
      "CONFIRMATION_MISMATCH"
    );
  }

  const userId = req.user._id;

  logger.warn("ACCOUNT_DELETION_REQUESTED", getAuthRequestDiagnostics(req));

  await invalidateAuthCache(userId).catch(() => {});
  const summary = await deleteAccount(userId);
  // Takes an options object, not a bare id — passing the id positionally
  // destructures to `userId: undefined` and silently invalidates nothing.
  await invalidateTradeCaches({
    userId,
    event: "trade_mutation",
    source: "account_deletion",
  }).catch(() => {});

  res.clearCookie(REFRESH_COOKIE_NAME, getClearCookieOptions(isCapacitorRequest(req)));

  res.json({
    success: true,
    message: "Your account and all associated data have been permanently deleted.",
    data: {
      collectionsCleared: Object.keys(summary.documentsDeleted).length,
      imagesDeleted: summary.images.destroyed,
    },
  });
});
