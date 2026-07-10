const multer = require("multer");
const mongoose = require("mongoose");
const ApiError = require("../utils/ApiError");
const { appConfig } = require("../config");
const { logger } = require("../utils/logger");
const { captureOperationalError } = require("../config/sentry");

function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  let normalizedError = err;

  if (err instanceof multer.MulterError) {
    let message = "File upload error.";
    if (err.code === "LIMIT_FILE_SIZE") {
      message = "File is too large.";
    } else if (err.code === "LIMIT_UNEXPECTED_FILE") {
      message = "Invalid file type. Only supported image files are allowed.";
    }
    normalizedError = new ApiError(400, message, err.code || "UPLOAD_ERROR");
  }

  if (err?.code === "INVALID_FILE_TYPE") {
    normalizedError = new ApiError(400, err.message || "Invalid file type.", "INVALID_FILE_TYPE");
  }

  if (err instanceof mongoose.Error.ValidationError) {
    normalizedError = new ApiError(
      400,
      Object.values(err.errors).map((entry) => entry.message).join(", ") || "Validation failed.",
      "VALIDATION_ERROR"
    );
  }

  if (err instanceof mongoose.Error.CastError) {
    normalizedError = new ApiError(400, `Invalid ${err.path}.`, "INVALID_ID");
  }

  if (err?.code === 11000) {
    const duplicateField = Object.keys(err.keyPattern || {})[0] || "resource";
    normalizedError = new ApiError(409, `${duplicateField} already exists.`, "DUPLICATE_RESOURCE");
  }

  const statusCode = normalizedError?.statusCode && Number.isInteger(normalizedError.statusCode)
    ? normalizedError.statusCode
    : 500;
  const errorCode = normalizedError?.errorCode || "INTERNAL_ERROR";
  const isServerError = statusCode >= 500;
  const responseMessage = isServerError
    ? "Something went wrong"
    : normalizedError?.message || "Request failed";

  if (/\/api\/auth\/(login|register|google)$/.test(req.originalUrl.split("?")[0])) {
    logger.warn("AUTH_LOGIN_FAILURE", {
      userId: null,
      deviceId: String(req.headers["x-device-id"] || "").slice(0, 100) || null,
      sessionId: String(req.headers["x-session-id"] || "").slice(0, 100) || null,
      tokenFamilyId: null,
      platform: String(req.headers["x-client-platform"] || "web").slice(0, 30),
      statusCode,
      errorCode,
    });
  }

  // Suppress noisy but expected 401s on /auth/refresh — no cookie = expected client probe,
  // not a real error worth logging every page load.
  const isSilentRefreshProbe =
    statusCode === 401 &&
    req.originalUrl.includes("/auth/refresh") &&
    (errorCode === "AUTH_REQUIRED" || errorCode === "REFRESH_TOKEN_EXPIRED");

  if (!isSilentRefreshProbe) {
    // Stack traces are useful in dev and in CI logs, but in prod they get
    // shipped to log aggregators that externalize internal file paths and
    // module names. Sentry already captures the full stack for server errors
    // below — the local log line doesn't need to duplicate it in prod.
    const includeStack = appConfig.env !== "production";
    logger[isServerError ? "error" : "warn"](`Error in ${req.method} ${req.originalUrl}`, {
      statusCode,
      errorCode,
      message: normalizedError?.message,
      ...(includeStack ? { stack: normalizedError?.stack } : {}),
      route: req.originalUrl,
      method: req.method,
      userAgent: req.get("user-agent"),
      ip: req.ip,
      requestId: req.requestId,
    });
    if (isServerError) {
      captureOperationalError(normalizedError, {
        subsystem: "express",
        tags: {
          error_code: errorCode,
          method: req.method,
          route: req.originalUrl.split("?")[0],
          request_id: req.requestId,
        },
        extra: { statusCode, requestId: req.requestId, ip: req.ip },
        userId: req.user?._id,
      });
    }
  }

  const payload = {
    status: "error",
    message: responseMessage,
    errorCode,
    requestId: req.requestId,
  };

  if (normalizedError?.details) {
    payload.details = normalizedError.details;
  }

  if (appConfig.env !== "production" && normalizedError?.stack) {
    payload.stack = normalizedError.stack;
  }

  res.status(statusCode).json(payload);
}

module.exports = {
  errorHandler
};
