"use strict";

/**
 * Enforces one response envelope for every JSON response below its mount point.
 * Controllers can opt out of automatic wrapping by using utils/apiResponse.
 */
function standardizeResponse(req, res, next) {
  const sendJson = res.json.bind(res);

  res.json = (body) => {
    if (res.locals.standardApiResponse) {
      return sendJson(body);
    }

    if (res.statusCode >= 200 && res.statusCode < 400) {
      return sendJson({ success: true, data: body });
    }

    const nestedError = body?.error && typeof body.error === "object" ? body.error : {};
    return sendJson({
      success: false,
      error: {
        code: nestedError.code || body?.errorCode || `HTTP_${res.statusCode}`,
        message: nestedError.message || body?.message || "Request failed",
        ...(nestedError.details || body?.details
          ? { details: nestedError.details || body.details }
          : {}),
        ...(nestedError.requestId || body?.requestId || req.requestId
          ? { requestId: nestedError.requestId || body?.requestId || req.requestId }
          : {}),
      },
    });
  };

  next();
}

module.exports = { standardizeResponse };
