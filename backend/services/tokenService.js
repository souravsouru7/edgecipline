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

// Opaque cookie name - don't advertise the purpose in the name.
const REFRESH_COOKIE_NAME = "sid";

// Same-client refresh races can present the just-rotated token again before
// the winning response updates cookies/state in every tab. Treat that as a
// recoverable race instead of a token-family replay.
//
// Widened from 10s → 60s: on Capacitor Android, a backgrounded WebView can
// hold a request mid-flight long after the foreground tab has refreshed.
// 10s was producing false TOKEN_REPLAY_DETECTED → family revoke → forced
// logout for users on slow mobile networks.
const REFRESH_REUSE_GRACE_MS =
  Number(process.env.REFRESH_REUSE_GRACE_MS) || 60_000;

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
/**
 * @param {boolean} isCapacitor - true when the request originates from the Android
 * Capacitor app (Origin: capacitor://localhost). Capacitor makes cross-site requests
 * from a different origin (capacitor://localhost → https://api.stratedge.live), so
 * SameSite=None; Secure=true is REQUIRED regardless of NODE_ENV — without it,
 * Android WebView won't send the cookie and silent token refresh silently fails,
 * logging the user out every time they kill and reopen the app.
 */
function getCookieOptions(isCapacitor = false) {
  const isProduction = appConfig.env === "production";
  if (isCapacitor) {
    return {
      httpOnly: true,
      secure: true,      // SameSite=None requires Secure=true; staging is always HTTPS
      sameSite: "none",
      maxAge: REFRESH_TOKEN_EXPIRY_MS,
      path: "/api/auth",
    };
  }
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "strict" : "lax",
    maxAge: REFRESH_TOKEN_EXPIRY_MS,
    path: "/api/auth",
  };
}

function getClearCookieOptions(isCapacitor = false) {
  const isProduction = appConfig.env === "production";
  if (isCapacitor) {
    return {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/api/auth",
    };
  }
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "strict" : "lax",
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
 * Validates the presented refresh token, revokes it atomically, and issues a new one
 * in the same family. Returns data needed to issue a new access token.
 *
 * Race condition fix: uses findOneAndUpdate with { revokedAt: null } filter so that
 * only ONE concurrent request can successfully revoke the token. If two requests race
 * with the same token, one wins and gets a new token; the other sees null and triggers
 * the replay-attack family-revocation path.
 *
 * Throws ApiError on:
 *  - Unknown token (possible theft)
 *  - Already-revoked token (replay attack — entire family is revoked)
 *  - Expired token
 */
async function rotateRefreshToken(rawToken, deviceInfo) {
  const tokenHash = hashToken(rawToken);

  // Atomically mark the token as revoked. Returns the document as it was BEFORE the
  // update. Returns null if the token is already revoked or doesn't exist.
  const existing = await RefreshToken.findOneAndUpdate(
    { tokenHash, revokedAt: null },
    { $set: { revokedAt: new Date() } },
    { new: false } // Return original (pre-update) document
  ).populate("userId", "_id role tokenVersion");

  if (!existing) {
    // Token not found with revokedAt: null — either genuinely unknown or already revoked.
    // Check if it's a replay attack (token exists but was already used).
    const staleToken = await RefreshToken.findOne({ tokenHash }).lean();

    if (staleToken?.revokedAt) {
      const msSinceRotation = Date.now() - new Date(staleToken.revokedAt).getTime();
      const sameUserAgent =
        (staleToken.deviceInfo?.userAgent || "") === (deviceInfo?.userAgent || "");

      if (sameUserAgent && msSinceRotation >= 0 && msSinceRotation <= REFRESH_REUSE_GRACE_MS) {
        throw new ApiError(
          409,
          "Refresh already completed by another request. Please retry.",
          "REFRESH_TOKEN_RACE"
        );
      }

      // Replay attack detected - revoke the entire family to protect the legitimate user.
      await RefreshToken.updateMany(
        { userId: staleToken.userId, family: staleToken.family },
        { $set: { revokedAt: new Date() } }
      );
      throw new ApiError(
        401,
        "Security alert: session reuse detected. Please login again.",
        "TOKEN_REPLAY_DETECTED"
      );
    }

    // Token simply doesn't exist
    throw new ApiError(401, "Session expired, please login again", "AUTH_REQUIRED");
  }

  if (!existing.userId) {
    throw new ApiError(401, "Session expired, please login again", "AUTH_REQUIRED");
  }

  if (existing.expiresAt < new Date()) {
    throw new ApiError(401, "Session expired, please login again", "REFRESH_TOKEN_EXPIRED");
  }

  const { userId } = existing;

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
  REFRESH_REUSE_GRACE_MS,
  ACCESS_TOKEN_EXPIRY,
};
