const asyncHandler = require("../utils/asyncHandler");
const User = require("../models/Users");
const ApiError = require("../utils/ApiError");

// User-set daily loss limit and max trades per day, per market.
// GET   /api/profile/risk-limits
// PATCH /api/profile/risk-limits  { market, dailyLossLimit?, maxTradesPerDay?, promptAnswered? }

const MARKETS = ["Forex", "Indian_Market"];
const MAX_LOSS_LIMIT = 1e9;
const MAX_TRADES_LIMIT = 100;
const ALLOWED_KEYS = new Set(["market", "dailyLossLimit", "maxTradesPerDay", "promptAnswered"]);

function serializeMarket(block) {
  return {
    dailyLossLimit: Number.isFinite(block?.dailyLossLimit) && block.dailyLossLimit > 0 ? block.dailyLossLimit : null,
    maxTradesPerDay: Number.isInteger(block?.maxTradesPerDay) && block.maxTradesPerDay > 0 ? block.maxTradesPerDay : null,
    promptAnsweredAt: block?.promptAnsweredAt || null,
  };
}

function serialize(user) {
  const limits = user?.riskLimits || {};
  return {
    Forex: serializeMarket(limits.Forex),
    Indian_Market: serializeMarket(limits.Indian_Market),
  };
}

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// Accepts a number or numeric string; "" and null clear the limit.
function parseLossLimit(value) {
  if (value === null || value === "") return null;
  if (typeof value === "boolean" || Array.isArray(value) || typeof value === "object") {
    throw new ApiError(400, "Daily loss limit must be a positive amount", "VALIDATION_ERROR");
  }
  const n = typeof value === "string" ? Number(value.trim()) : Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_LOSS_LIMIT) {
    throw new ApiError(400, "Daily loss limit must be a positive amount", "VALIDATION_ERROR");
  }
  return Math.round(n * 100) / 100;
}

function parseTradeLimit(value) {
  if (value === null || value === "") return null;
  if (typeof value === "boolean" || Array.isArray(value) || typeof value === "object") {
    throw new ApiError(400, `Max trades per day must be a whole number from 1 to ${MAX_TRADES_LIMIT}`, "VALIDATION_ERROR");
  }
  const n = typeof value === "string" ? Number(value.trim()) : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_TRADES_LIMIT) {
    throw new ApiError(400, `Max trades per day must be a whole number from 1 to ${MAX_TRADES_LIMIT}`, "VALIDATION_ERROR");
  }
  return n;
}

exports.getRiskLimits = asyncHandler(async (req, res) => {
  if (!req.user) throw new ApiError(401, "Not authorized", "AUTH_FAILED");
  // Read fresh: req.user may come from the auth cache.
  const user = await User.findById(req.user._id).select("riskLimits").lean();
  res.json(serialize(user));
});

exports.updateRiskLimits = asyncHandler(async (req, res) => {
  if (!req.user) throw new ApiError(401, "Not authorized", "AUTH_FAILED");
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};

  const unknown = Object.keys(body).filter((k) => !ALLOWED_KEYS.has(k));
  if (unknown.length) throw new ApiError(400, `Unknown field: ${unknown[0]}`, "VALIDATION_ERROR");
  if (!MARKETS.includes(body.market)) throw new ApiError(400, "Invalid market", "VALIDATION_ERROR");

  const prefix = `riskLimits.${body.market}`;
  const set = {};
  if (has(body, "dailyLossLimit")) set[`${prefix}.dailyLossLimit`] = parseLossLimit(body.dailyLossLimit);
  if (has(body, "maxTradesPerDay")) set[`${prefix}.maxTradesPerDay`] = parseTradeLimit(body.maxTradesPerDay);
  if (has(body, "promptAnswered")) {
    if (body.promptAnswered !== true) throw new ApiError(400, "promptAnswered must be true", "VALIDATION_ERROR");
  }
  // Saving any limit also answers the first-time prompt, so it never re-asks.
  if (Object.keys(set).length || body.promptAnswered === true) {
    set[`${prefix}.promptAnsweredAt`] = new Date();
  }
  if (!Object.keys(set).length) throw new ApiError(400, "Nothing to update", "VALIDATION_ERROR");

  const user = await User.findByIdAndUpdate(
    req.user._id,
    { $set: set },
    { new: true, runValidators: true, projection: { riskLimits: 1 } }
  ).lean();

  res.json(serialize(user));
});

exports._test = { parseLossLimit, parseTradeLimit, serialize };
