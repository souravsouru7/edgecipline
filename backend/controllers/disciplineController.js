"use strict";

const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const analyticsSnapshotService = require("../services/analyticsSnapshotService");

const ALLOWED_FOREX   = new Set(["Forex", "Crypto", "Commodities", "Indices", "Stocks"]);
const VALID_PERIODS   = new Set(["daily", "weekly", "monthly"]);

/**
 * GET /analytics/discipline                  — Forex (or combined with ?combined=true)
 * GET /indian-analytics/discipline           — Indian Market
 *
 * Query params:
 *   period    "daily" | "weekly" | "monthly"  (default "monthly")
 *   days      30 | 90 | 180 | 365 | all       (default all)
 *   setup     strategy name filter            (optional)
 *   combined  true                            (Forex endpoint only — merges both markets)
 */
exports.getDisciplineAnalytics = asyncHandler(async (req, res) => {
  const userId   = req.user._id;
  const isIndian = req.isIndianMarket === true;

  const { marketType: mtParam, period: periodParam, days: daysParam, setup: setupParam, combined } = req.query;

  if (!isIndian && mtParam && !ALLOWED_FOREX.has(String(mtParam))) {
    throw new ApiError(400, "Invalid marketType parameter", "VALIDATION_ERROR");
  }

  const period     = VALID_PERIODS.has(periodParam) ? periodParam : "monthly";
  const daysNum    = parseInt(daysParam, 10);
  const dateRange = daysNum > 0 && daysNum <= 3650
    ? { from: new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000) }
    : undefined;

  const setupFilter = setupParam ? String(setupParam).trim() : null;
  const isCombined  = combined === "true" && !isIndian;

  // Optional setup strategy filter (by strategy name)
  if (setupFilter) {
    const snapshot = await analyticsSnapshotService.getSnapshot({
      userId,
      market: isIndian ? "Indian_Market" : isCombined ? "combined" : "Forex",
      instrumentType: isIndian ? req.query.instrumentType : undefined,
      dateRange,
      period,
      includeTrades: true,
    });
    const trades = snapshot.trades.filter(t => (t.strategy || "").trim() === setupFilter);
    return res.json(analyticsSnapshotService.generateSnapshotFromTrades({
      trades,
      marketLabel: snapshot.marketType,
      period,
    }).discipline);
  }

  const snapshot = await analyticsSnapshotService.getSnapshot({
    userId,
    market: isIndian ? "Indian_Market" : isCombined ? "combined" : "Forex",
    instrumentType: isIndian ? req.query.instrumentType : undefined,
    dateRange,
    period,
  });
  res.json(snapshot.discipline);
});
