"use strict";

const ApiError = require("../utils/ApiError");

async function cleanupRejectedUploads(uploadedImages) {
  const publicIds = (uploadedImages || []).map((image) => image?.publicId).filter(Boolean);
  if (publicIds.length === 0) return;
  const cloudinary = require("../config/cloudinary");
  await Promise.allSettled(
    publicIds.map((publicId) =>
      cloudinary.uploader.destroy(publicId, { resource_type: "image" })
    )
  );
}

/**
 * Validates request body, query, and params with a Zod schema.
 * Parsed values are available through req.validated and parsed bodies replace
 * req.body so coercions are consistently consumed by controllers.
 */
function toPlainObject(value) {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value) || Buffer.isBuffer(value)) {
    return {};
  }
  return { ...value };
}

function validateRequest(schema) {
  return async (req, _res, next) => {
    const result = await schema.safeParseAsync({
      body: req.body == null ? {} : req.body,
      query: toPlainObject(req.query),
      params: toPlainObject(req.params),
    });

    if (!result.success) {
      await cleanupRejectedUploads(req.uploadedImages);
      const details = result.error.issues.map((issue) => ({
        field: issue.path.join("."),
        code: issue.code,
        message: issue.message,
      }));
      const invalidRouteId = details.some((detail) =>
        detail.field.startsWith("params.") && /ObjectId/i.test(detail.message)
      );
      return next(new ApiError(
        400,
        invalidRouteId ? "Invalid route identifier" : "Request validation failed",
        invalidRouteId ? "INVALID_ID" : "VALIDATION_ERROR",
        details
      ));
    }

    req.validated = result.data;
    if (result.data.body !== undefined) {
      req.body = result.data.body;
    }
    return next();
  };
}

module.exports = { validateRequest };
