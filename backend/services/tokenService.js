/**
 * tokenService — single source of truth for all token operations.
 *
 * Design decisions:
 *  - Access tokens are short-lived JWTs (15 min). Stateless, validated by signature alone.
 *  - Refresh tokens are long-lived (30 day) cryptographically random opaques stored HASHED in DB.
 *    The raw token travels over the wire exactly ONCE (in an httpOnly cookie). We never log it.
 *  - Rotation families: every rotation chain shares one family UUID. If a revoked token in a
 *    family is presented again, we revoke the ENTIRE family — this kills a compromised session
 *    even if the attacker already rotated the token before the legitimate user did.
 *  - Refresh token cookie is scoped to /api/auth so it is NOT sent with every API request,
 *    minimising the attack surface.
 */

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { appConfig } = require("../config");
const RefreshToken = require("../models/RefreshToken");
const ApiError = require("../utils/ApiError");

// Access token lives 15 minutes — small blast radius if stolen via XSS.
// Configurable so you can increase in dev without code changes.
const ACCESS_TOKEN_EXPIRY = process.env.JWT_ACCESS_EXPIRES_IN || "15m";

// Refresh token lives 30 days. Rotation resets the window each use.
const REFRESH_TOKEN_EXPIRY_MS =
  Number(process.env.REFRESH_TOKEN_EXPIRY_MS) || 30 * 24 * 60 * 60 * 1000;

// Opaque cookie name — don't advertise the purpose in the name.
const REFRESH_COOKIE_NAME = "sid";

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

function generateAccessToken(userId, role, tokenVersion) {
  return jwt.sign(
    { id: String(userId), role, tokenVersion },
    appConfig.jwt.secret,
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  );
}

function hashToken(raw) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

// ---------------------------------------------------------------------------
// Cookie options — sameSite/secure adapt to environment.
// path: '/api/auth' ensures the cookie is ONLY sent to auth endpoints,
// not to every /api/trades, /api/analytics, etc. request.
// ---------------------------------------------------------------------------
function getCookieOptions() {
  const isProduction = appConfig.env === "production";
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "strict" : "lax",
    maxAge: REFRESH_TOKEN_EXPIRY_MS,
    path: "/api/auth",
  };
}

function getClearCookieOptions() {
  return {
    httpOnly: true,
    secure: appConfig.env === "production",
    sameSite: appConfig.env === "production" ? "strict" : "lax",
    path: "/api/auth",
  };
}

// ---------------------------------------------------------------------------
// Refresh token lifecycle
// ---------------------------------------------------------------------------

async function createRefreshToken(userId, deviceInfo) {
  const rawToken = crypto.randomBytes(48).toString("hex"); // 96 hex chars
  const tokenHash = hashToken(rawToken);
  const family = crypto.randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS);

  await RefreshToken.create({ userId, tokenHash, family, deviceInfo, expiresAt });
  return rawToken;
}

/**
 * Validates the presented refresh token, revokes it, and issues a new one
 * in the same family. Returns data needed to issue a new access token.
 *
 * Throws ApiError on:
 *  - Unknown token (possible theft)
 *  - Already-revoked token (replay attack — entire family is revoked)
 *  - Expired token
 */
async function rotateRefreshToken(rawToken, deviceInfo) {
  const tokenHash = hashToken(rawToken);

  const existing = await RefreshToken.findOne({ tokenHash }).populate(
    "userId",
    "_id role tokenVersion"
  );

  if (!existing || !existing.userId) {
    // Token unknown — conservative: revoke nothing (we can't find the user),
    // but return a generic error. The cookie will be cleared by the caller.
    throw new ApiError(401, "Session expired, please login again", "AUTH_REQUIRED");
  }

  const { userId } = existing;

  if (existing.revokedAt) {
    // Already-used token presented again — replay attack detected.
    // Revoke every token in this family to protect the legitimate user.
    await RefreshToken.updateMany(
      { userId: userId._id, family: existing.family },
      { revokedAt: new Date() }
    );
    throw new ApiError(
      401,
      "Security alert: session reuse detected. Please login again.",
      "TOKEN_REPLAY_DETECTED"
    );
  }

  if (existing.expiresAt < new Date()) {
    throw new ApiError(401, "Session expired, please login again", "REFRESH_TOKEN_EXPIRED");
  }

  // Revoke the old token synchronously — it must never be reused.
  existing.revokedAt = new Date();
  await existing.save();

  // Issue replacement token in the same family (rotation chain).
  const newRaw = crypto.randomBytes(48).toString("hex");
  await RefreshToken.create({
    userId: userId._id,
    tokenHash: hashToken(newRaw),
    family: existing.family,
    deviceInfo,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS),
  });

  return {
    newRawToken: newRaw,
    userId: userId._id,
    role: userId.role,
    tokenVersion: userId.tokenVersion,
  };
}

async function revokeRefreshToken(rawToken) {
  const tokenHash = hashToken(rawToken);
  await RefreshToken.updateOne({ tokenHash }, { revokedAt: new Date() });
}

/** Revokes all active refresh tokens for a user (logout-all-devices). */
async function revokeAllUserTokens(userId) {
  await RefreshToken.updateMany({ userId, revokedAt: null }, { revokedAt: new Date() });
}

module.exports = {
  generateAccessToken,
  hashToken,
  getCookieOptions,
  getClearCookieOptions,
  createRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
  REFRESH_COOKIE_NAME,
  REFRESH_TOKEN_EXPIRY_MS,
  ACCESS_TOKEN_EXPIRY,
};
