const IndianTrade = require("../models/IndianTrade");
const mongoose = require("mongoose");
const { TRADE_CACHE_EVENTS, invalidateTradeCaches } = require("../utils/cacheUtils");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");
const { evaluateSmartNotifications } = require("../services/smartNotificationEvaluator");
const tradeLifecycleService = require("../services/tradeLifecycle.service");
const { markOcrJobConfirmed } = require("../services/ocrJob.service");
const { normalizeTradeDate } = require("../utils/dateUtils");

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

function userMatch(userId) {
  const id = userId?.toString?.() || String(userId || "");
  if (mongoose.Types.ObjectId.isValid(id)) {
    return { $in: [new mongoose.Types.ObjectId(id), id] };
  }
  return userId;
}

const INDIAN_TRADE_LIST_PROJECTION = [
  "pair",
  "underlying",
  "type",
  "optionType",
  "quantity",
  "lotSize",
  "entryPrice",
  "exitPrice",
  "profit",
  "strategy",
  "session",
  "entryBasis",
  "entryBasisCustom",
  "createdAt",
  "tradeDate",
  "instrumentType",
  "segment",
  "tradeType",
  "stockSymbol",
  "sharesQty",
  "exchange",
  "sector",
  "strikePrice",
].join(" ");

const INDIAN_TRADE_LIST_PROJECT_STAGE = INDIAN_TRADE_LIST_PROJECTION
  .split(" ")
  .reduce((projection, field) => ({ ...projection, [field]: 1 }), { _id: 1 });

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

function buildIndianTradeDocument(userId, payload, { accountCreatedAt } = {}) {
  const { pair, type, underlying, strikePrice, optionType, tradeDate, instrumentType, stockSymbol, sharesQty } = payload;

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
    payload.sharesQty = normalizedSharesQty;
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

  const { ocrJobId, ...body } = payload;
  const tradeData = {
    ...body,
    pair: symbol,
    type: type.toUpperCase(),
    tradeDate: normalizeTradeDate(tradeDate, { accountCreatedAt }),
    user: userId,
  };
  if (!isEquity) {
    tradeData.optionType = ot;
    tradeData.instrumentType = "OPTION";
    tradeData.segment = "F&O";
  } else {
    tradeData.instrumentType = "EQUITY";
    tradeData.segment = "EQUITY";
    tradeData.tradeType = "INTRADAY";
  }

  return tradeData;
}

exports.createTrade = asyncHandler(async (req, res) => {
  const ocrJobId = req.body?.ocrJobId || null;
  const tradeData = buildIndianTradeDocument(req.user._id, req.body, {
    accountCreatedAt: req.user.createdAt,
  });
  const trade = await IndianTrade.create(tradeData);

  await invalidateTradeCaches({
    userId: req.user._id,
    event: ocrJobId ? TRADE_CACHE_EVENTS.OCR_SAVE : TRADE_CACHE_EVENTS.CREATE,
    market: "Indian_Market",
    tradeId: trade._id,
    source: ocrJobId ? "ocr_confirm" : "manual_create",
  });
  await evaluateSmartNotifications({
    userId: req.user._id,
    trade,
    marketType: "Indian_Market",
    collection: "indian",
  });
  if (ocrJobId) {
    await markOcrJobConfirmed(req.user._id, ocrJobId, {
      tradeId: trade._id,
      collection: "indian",
    });
  }

  res.status(201).json(trade);
});

exports.createTradesBatch = asyncHandler(async (req, res) => {
  const trades = Array.isArray(req.body?.trades) ? req.body.trades : [];
  if (trades.length === 0) {
    throw new ApiError(400, "At least one trade is required", "VALIDATION_ERROR");
  }
  if (trades.length > 100) {
    throw new ApiError(400, "Batch trade import cannot exceed 100 trades", "VALIDATION_ERROR");
  }

  const ocrJobId = req.body?.ocrJobId || trades.find((trade) => trade?.ocrJobId)?.ocrJobId || null;
  const docs = trades.map((trade) => buildIndianTradeDocument(req.user._id, trade, {
    accountCreatedAt: req.user.createdAt,
  }));
  const createdTrades = await IndianTrade.insertMany(docs, { ordered: true });

  await invalidateTradeCaches({
    userId: req.user._id,
    event: ocrJobId ? TRADE_CACHE_EVENTS.OCR_SAVE : TRADE_CACHE_EVENTS.BULK_IMPORT,
    market: "Indian_Market",
    tradeId: createdTrades[0]?._id || null,
    count: createdTrades.length,
    source: ocrJobId ? "ocr_batch_confirm" : "batch_create",
  });

  const representativeTrade = createdTrades[createdTrades.length - 1];
  if (representativeTrade) {
    await evaluateSmartNotifications({
      userId: req.user._id,
      trade: representativeTrade,
      marketType: "Indian_Market",
      collection: "indian",
    });
  }

  if (ocrJobId && createdTrades[0]) {
    await markOcrJobConfirmed(req.user._id, ocrJobId, {
      tradeId: createdTrades[0]._id,
      collection: "indian",
    });
  }

  res.status(201).json({
    success: true,
    count: createdTrades.length,
    trades: createdTrades,
  });
});

exports.getTrades = asyncHandler(async (req, res) => {
  const period = String(req.query.period || "all").toLowerCase();
  const query = { user: userMatch(req.user._id), deletedAt: null };
  const periodStart = getPeriodStart(period);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));

  if (periodStart) {
    query.$or = [
      { tradeDate: { $gte: periodStart } },
      { tradeDate: null, createdAt: { $gte: periodStart } },
    ];
  }

  const trades = await IndianTrade.aggregate([
    { $match: query },
    { $addFields: { effectiveTradeDate: { $ifNull: ["$tradeDate", "$createdAt"] } } },
    { $sort: { effectiveTradeDate: -1, _id: -1 } },
    { $skip: (page - 1) * limit },
    { $limit: limit },
    { $project: INDIAN_TRADE_LIST_PROJECT_STAGE },
  ]);
  res.json(trades);
});

exports.getTrade = asyncHandler(async (req, res) => {
  const trade = await IndianTrade.findOne({
    _id: req.params.id,
    user: req.user._id,
    deletedAt: null
  });

  if (!trade) {
    throw new ApiError(404, "Trade not found or unauthorized", "NOT_FOUND");
  }

  res.json(trade);
});

exports.updateTrade = asyncHandler(async (req, res) => {
  const { type, tradeDate } = req.body;

  const validTypes = ["BUY", "SELL"];
  if (type && !validTypes.includes(type.toUpperCase())) {
    throw new ApiError(400, "Type must be BUY or SELL", "VALIDATION_ERROR");
  }

  const update = { ...req.body };
  delete update.tradeDate;
  if (tradeDate != null && String(tradeDate).trim() !== "") {
    update.tradeDate = normalizeTradeDate(tradeDate, { accountCreatedAt: req.user.createdAt });
  }
  if (type) {
    update.type = type.toUpperCase();
  }

  const trade = await IndianTrade.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id, deletedAt: null },
    update,
    {
      returnDocument: "after",
      runValidators: true,
    }
  );

  if (!trade) {
    throw new ApiError(404, "Trade not found or unauthorized", "NOT_FOUND");
  }

  await invalidateTradeCaches({
    userId: req.user._id,
    event: TRADE_CACHE_EVENTS.EDIT,
    market: "Indian_Market",
    tradeId: req.params.id,
    source: "manual_edit",
  });
  await evaluateSmartNotifications({
    userId: req.user._id,
    trade,
    marketType: "Indian_Market",
    collection: "indian",
  });

  res.json(trade);
});

exports.deleteTrade = asyncHandler(async (req, res) => {
  const trade = await tradeLifecycleService.softDeleteTrade(IndianTrade, {
    tradeId: req.params.id,
    userId: req.user._id,
    deletedBy: req.user._id,
    deleteReason: req.body?.deleteReason || "",
    deletedSource: req.body?.deletedSource || "user",
    options: { lean: true },
  });

  if (!trade) {
    throw new ApiError(404, "Trade not found or unauthorized", "NOT_FOUND");
  }

  await invalidateTradeCaches({
    userId: req.user._id,
    event: TRADE_CACHE_EVENTS.DELETE,
    market: "Indian_Market",
    tradeId: req.params.id,
    source: "manual_delete",
  });

  res.json({ message: "Trade deleted", tradeId: trade._id, deletedAt: trade.deletedAt });
});

exports.restoreTrade = asyncHandler(async (req, res) => {
  const trade = await tradeLifecycleService.restoreTrade(IndianTrade, {
    tradeId: req.params.id,
    userId: req.user._id,
    options: { lean: true },
  });

  if (!trade) {
    throw new ApiError(404, "Deleted trade not found or unauthorized", "NOT_FOUND");
  }

  await invalidateTradeCaches({
    userId: req.user._id,
    event: TRADE_CACHE_EVENTS.RESTORE,
    market: "Indian_Market",
    tradeId: req.params.id,
    source: "manual_restore",
  });

  res.json({ message: "Trade restored", tradeId: trade._id });
});
