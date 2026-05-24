const mongoose = require("mongoose");
const IndianTrade = require("../models/IndianTrade");
const { clearUserCache } = require("../utils/cacheUtils");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");
const { evaluateSmartNotifications } = require("../services/smartNotificationEvaluator");

function normalizeTradeDate(tradeDate) {
  const parsed = new Date(tradeDate);
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError(400, "Trade date is invalid", "VALIDATION_ERROR");
  }
  return parsed;
}

function getPeriodStart(period) {
  const now = new Date();
  const start = new Date(now);

  switch (String(period || "all").toLowerCase()) {
    case "1w":
      start.setDate(start.getDate() - 7);
      return start;
    case "1m":
      start.setMonth(start.getMonth() - 1);
      return start;
    case "3m":
      start.setMonth(start.getMonth() - 3);
      return start;
    case "1y":
      start.setFullYear(start.getFullYear() - 1);
      return start;
    default:
      return null;
  }
}

function parseFiniteNumber(value) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const cleaned = value.replace(/,/g, "").trim();
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Fields that may be written by the client — excludes user, _id, timestamps
const ALLOWED_TRADE_FIELDS = [
  "underlying", "optionType", "entryPrice", "exitPrice", "stopLoss", "takeProfit", "profit",
  "strategy", "session", "notes", "riskRewardRatio", "riskRewardCustom", "screenshot",
  "stockSymbol", "exchange", "sharesQty", "sector", "strikePrice", "expiryDate",
  "quantity", "lotSize", "tradeType", "brokerage", "sttTaxes", "entryBasis", "entryBasisCustom",
  "setup", "mistakeTag", "lesson", "setupRules", "setupScore", "mood", "confidence",
  "emotionalTags", "wouldRetake",
];

const ALLOWED_UPDATE_FIELDS = ["pair", ...ALLOWED_TRADE_FIELDS];

exports.createTrade = asyncHandler(async (req, res) => {
  const { pair, type, underlying, strikePrice, optionType, tradeDate, instrumentType, stockSymbol, sharesQty } = req.body;

  if (!type) {
    throw new ApiError(400, "Type (BUY/SELL) is required", "VALIDATION_ERROR");
  }
  const validTypes = ["BUY", "SELL"];
  if (!validTypes.includes(type.toUpperCase())) {
    throw new ApiError(400, "Type must be BUY or SELL", "VALIDATION_ERROR");
  }

  const isEquity = (instrumentType || "").toUpperCase() === "EQUITY";

  let ot = (optionType || "CE").toUpperCase();
  if (!isEquity) {
    const validOptionTypes = ["CE", "PE"];
    if (!validOptionTypes.includes(ot)) {
      throw new ApiError(400, "Option type must be CE or PE", "VALIDATION_ERROR");
    }
  }

  if (isEquity) {
    if (!stockSymbol && !pair) {
      throw new ApiError(400, "Stock symbol is required for equity trades", "VALIDATION_ERROR");
    }
    const normalizedSharesQty = parseFiniteNumber(sharesQty);
    if (normalizedSharesQty == null || normalizedSharesQty <= 0) {
      throw new ApiError(400, "Shares quantity is required for equity trades", "VALIDATION_ERROR");
    }
    req.body.sharesQty = normalizedSharesQty;
  }

  let symbol = pair;
  if (!isEquity) {
    if (!symbol && underlying && strikePrice != null) {
      symbol = `${String(underlying).trim()} ${strikePrice} ${ot}`;
    }
    if (!symbol) {
      throw new ApiError(400, "Symbol is required (provide pair or underlying + strike + optionType)", "VALIDATION_ERROR");
    }
  } else {
    symbol = pair || String(stockSymbol).trim().toUpperCase();
  }

  if (!tradeDate) {
    throw new ApiError(400, "Trade date is required", "VALIDATION_ERROR");
  }

  const tradeData = {};
  for (const field of ALLOWED_TRADE_FIELDS) {
    if (req.body[field] !== undefined) tradeData[field] = req.body[field];
  }
  tradeData.pair = symbol;
  tradeData.type = type.toUpperCase();
  tradeData.tradeDate = normalizeTradeDate(tradeDate);
  tradeData.user = req.user._id;

  if (!isEquity) {
    tradeData.optionType = ot;
    tradeData.instrumentType = "OPTION";
    tradeData.segment = "F&O";
  } else {
    tradeData.instrumentType = "EQUITY";
    tradeData.segment = "EQUITY";
    tradeData.tradeType = "INTRADAY";
  }

  const trade = await IndianTrade.create(tradeData);

  await clearUserCache(req.user._id);
  await evaluateSmartNotifications({
    userId: req.user._id,
    trade,
    marketType: "Indian_Market",
    collection: "indian",
  });

  res.status(201).json(trade);
});

exports.getTrades = asyncHandler(async (req, res) => {
  const period = String(req.query.period || "all").toLowerCase();
  const query = { user: req.user._id };
  const periodStart = getPeriodStart(period);

  if (periodStart) {
    query.$or = [
      { tradeDate: { $gte: periodStart } },
      { tradeDate: null, createdAt: { $gte: periodStart } },
    ];
  }

  const trades = await IndianTrade.find(query)
    .select(
      "pair underlying type optionType quantity lotSize entryPrice exitPrice profit strategy session entryBasis entryBasisCustom createdAt tradeDate instrumentType segment tradeType stockSymbol sharesQty exchange sector strikePrice"
    )
    .sort({ tradeDate: -1, createdAt: -1 })
    .lean();

  res.json(trades);
});

exports.getTrade = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw new ApiError(404, "Trade not found or unauthorized", "NOT_FOUND");
  }

  const trade = await IndianTrade.findOne({
    _id: req.params.id,
    user: req.user._id,
  });

  if (!trade) {
    throw new ApiError(404, "Trade not found or unauthorized", "NOT_FOUND");
  }

  res.json(trade);
});

exports.updateTrade = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(404, "Trade not found or unauthorized", "NOT_FOUND");
  }

  const { type, tradeDate } = req.body;

  if (type) {
    const validTypes = ["BUY", "SELL"];
    if (!validTypes.includes(type.toUpperCase())) {
      throw new ApiError(400, "Type must be BUY or SELL", "VALIDATION_ERROR");
    }
  }

  const updates = {};
  for (const field of ALLOWED_UPDATE_FIELDS) {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  }
  if (type) updates.type = type.toUpperCase();
  if (tradeDate) updates.tradeDate = normalizeTradeDate(tradeDate);

  // Re-build pair symbol when component fields change on an OPTION trade
  if (updates.underlying !== undefined || updates.strikePrice !== undefined || updates.optionType !== undefined) {
    const existing = await IndianTrade.findOne({ _id: id, user: req.user._id }).lean();
    if (!existing) {
      throw new ApiError(404, "Trade not found or unauthorized", "NOT_FOUND");
    }
    if (existing.instrumentType !== "EQUITY") {
      const newUnderlying = updates.underlying !== undefined ? updates.underlying : existing.underlying;
      const newStrike = updates.strikePrice !== undefined ? updates.strikePrice : existing.strikePrice;
      const newOT = updates.optionType !== undefined ? updates.optionType : existing.optionType;
      if (newUnderlying && newStrike != null) {
        updates.pair = `${String(newUnderlying).trim()} ${newStrike} ${newOT || "CE"}`;
      }
    }
  }

  const trade = await IndianTrade.findOneAndUpdate(
    { _id: id, user: req.user._id },
    updates,
    { returnDocument: "after", runValidators: true }
  );

  if (!trade) {
    throw new ApiError(404, "Trade not found or unauthorized", "NOT_FOUND");
  }

  await clearUserCache(req.user._id);
  await evaluateSmartNotifications({
    userId: req.user._id,
    trade,
    marketType: "Indian_Market",
    collection: "indian",
  });

  res.json(trade);
});

exports.deleteTrade = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw new ApiError(404, "Trade not found or unauthorized", "NOT_FOUND");
  }

  const trade = await IndianTrade.findOneAndDelete({
    _id: req.params.id,
    user: req.user._id,
  });

  if (!trade) {
    throw new ApiError(404, "Trade not found or unauthorized", "NOT_FOUND");
  }

  await clearUserCache(req.user._id);

  res.json({ message: "Trade deleted" });
});
