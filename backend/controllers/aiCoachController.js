"use strict";

const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const { generateCoachFeed } = require("../utils/aiCoachFeed");
const analyticsSnapshotService = require("../services/analyticsSnapshotService");

const ALLOWED_FOREX_TYPES = new Set(["Forex", "Crypto", "Commodities", "Indices", "Stocks"]);

/**
 * GET /analytics/ai-coach-feed
 * GET /indian/analytics/ai-coach-feed
 *
 * Optional: ?days=30|90|180|365|all
 */
exports.getCoachFeed = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const isIndian = req.isIndianMarket === true;

  const { marketType: marketTypeParam } = req.query;
  if (!isIndian && marketTypeParam && !ALLOWED_FOREX_TYPES.has(String(marketTypeParam))) {
    throw new ApiError(400, "Invalid marketType parameter", "VALIDATION_ERROR");
  }

  const daysParam = parseInt(req.query.days, 10);
  const dateRange = daysParam > 0 && daysParam <= 3650
    ? { from: new Date(Date.now() - daysParam * 24 * 60 * 60 * 1000) }
    : undefined;

  const marketTypeLabel = isIndian ? "Indian_Market" : "Forex";
  const snapshot = await analyticsSnapshotService.getSnapshot({
    userId,
    market: marketTypeLabel,
    instrumentType: isIndian ? req.query.instrumentType : undefined,
    dateRange,
  });

  const feed = generateCoachFeed({
    psychologyCost: snapshot.psychologyCost,
    tradingDNA: snapshot.tradingDNA,
    patterns: snapshot.patterns,
    selfAwareness: snapshot.selfAwareness,
    totalTrades: snapshot.basicStats.totalTrades,
    totalVolume: snapshot.basicStats.totalVolume,
    marketType: marketTypeLabel,
  });

  res.json({ ...feed, basicStats: snapshot.basicStats });
});
