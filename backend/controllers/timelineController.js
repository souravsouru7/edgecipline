"use strict";

const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const analyticsSnapshotService = require("../services/analyticsSnapshotService");

const VALID_PERIODS   = new Set(["daily", "weekly", "monthly"]);
const ALLOWED_FOREX   = new Set(["Forex", "Crypto", "Commodities", "Indices", "Stocks"]);

/**
 * GET /analytics/psychology-timeline           — Forex
 * GET /indian-analytics/psychology-timeline    — Indian Market
 *
 * Query params:
 *   period   "daily" | "weekly" | "monthly"   (default "weekly")
 *   days     30 | 90 | 180 | 365 | all        (default all)
 */
exports.getPsychologyTimeline = asyncHandler(async (req, res) => {
  const userId  = req.user._id;
  const isIndian = req.isIndianMarket === true;

  const { marketType: marketTypeParam, period: periodParam, days: daysParam } = req.query;

  if (!isIndian && marketTypeParam && !ALLOWED_FOREX.has(String(marketTypeParam))) {
    throw new ApiError(400, "Invalid marketType parameter", "VALIDATION_ERROR");
  }

  const period = VALID_PERIODS.has(periodParam) ? periodParam : "weekly";

  const daysNum = parseInt(daysParam, 10);
  const dateRange =
    daysNum > 0 && daysNum <= 3650
      ? { from: new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000) }
      : undefined;

  const snapshot = await analyticsSnapshotService.getTimelineSnapshot({
    userId,
    market: isIndian ? "Indian_Market" : "Forex",
    instrumentType: isIndian ? req.query.instrumentType : undefined,
    dateRange,
    period,
  });
  res.json(snapshot.timeline);
});
