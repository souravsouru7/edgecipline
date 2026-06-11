"use strict";

const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");
const analyticsSnapshotService = require("../services/analyticsSnapshotService");

const ALLOWED_FOREX_TYPES = new Set(["Forex", "Crypto", "Commodities", "Indices", "Stocks"]);

/**
 * GET /analytics/patterns
 * GET /indian/analytics/patterns
 *
 * Optional: ?days=30|90|180|365|all
 */
exports.getPatterns = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const isIndian = req.isIndianMarket === true;

  const daysParam = parseInt(req.query.days, 10);
  const dateRange = daysParam > 0 && daysParam <= 3650
    ? { from: new Date(Date.now() - daysParam * 24 * 60 * 60 * 1000) }
    : undefined;

  if (!isIndian) {
    const { marketType } = req.query;
    if (marketType && !ALLOWED_FOREX_TYPES.has(String(marketType))) {
      throw new ApiError(400, "Invalid marketType parameter", "VALIDATION_ERROR");
    }
  }

  const snapshot = await analyticsSnapshotService.getSnapshot({
    userId,
    market: isIndian ? "Indian_Market" : "Forex",
    instrumentType: isIndian ? req.query.instrumentType : undefined,
    dateRange,
  });

  res.json(snapshot.patterns);
});
