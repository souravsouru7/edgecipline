"use strict";

const jwt = require("jsonwebtoken");
const { appConfig } = require("../config");
const ApiError = require("./ApiError");

// Share tokens use the main JWT secret but are scoped by `aud` so they can
// never be confused with a user-session token. Default TTL is 30 days —
// shareable but not permanent. Clamped to a 1-year ceiling.
const SHARE_AUDIENCE = "tdna-share";
const SHARE_ISSUER = "edgecipline";
const DEFAULT_TTL_DAYS = 30;
const MAX_TTL_DAYS = 365;

function clampTtlDays(ttlDays) {
  const n = Number(ttlDays);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TTL_DAYS;
  return Math.min(MAX_TTL_DAYS, Math.max(1, Math.round(n)));
}

function signShareToken({ reportId, userId, ttlDays = DEFAULT_TTL_DAYS } = {}) {
  if (!reportId) throw new Error("[shareToken] reportId is required");
  if (!userId) throw new Error("[shareToken] userId is required");
  const days = clampTtlDays(ttlDays);
  const expiresIn = `${days}d`;

  const token = jwt.sign(
    {
      reportId: String(reportId),
      userId: String(userId),
    },
    appConfig.jwt.secret,
    {
      algorithm: "HS256",
      audience: SHARE_AUDIENCE,
      issuer: SHARE_ISSUER,
      expiresIn,
    }
  );

  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return { token, expiresAt, ttlDays: days };
}

function verifyShareToken(token) {
  if (!token || typeof token !== "string") {
    throw new ApiError(400, "Missing share token", "VALIDATION_ERROR");
  }
  try {
    const decoded = jwt.verify(token, appConfig.jwt.secret, {
      algorithms: ["HS256"],
      audience: SHARE_AUDIENCE,
      issuer: SHARE_ISSUER,
    });
    if (!decoded?.reportId || !decoded?.userId) {
      throw new ApiError(401, "Invalid share token payload", "UNAUTHORIZED");
    }
    return {
      reportId: String(decoded.reportId),
      userId: String(decoded.userId),
      expiresAt: decoded.exp ? new Date(decoded.exp * 1000) : null,
    };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    const code = err.name === "TokenExpiredError" ? "TOKEN_EXPIRED" : "UNAUTHORIZED";
    const message =
      err.name === "TokenExpiredError"
        ? "This share link has expired"
        : "This share link is no longer valid";
    throw new ApiError(401, message, code);
  }
}

module.exports = {
  DEFAULT_TTL_DAYS,
  MAX_TTL_DAYS,
  SHARE_AUDIENCE,
  signShareToken,
  verifyShareToken,
};
