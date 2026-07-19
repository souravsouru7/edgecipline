const IndianTrade = require("../models/IndianTrade");
const mongoose = require("mongoose");
const { TRADE_CACHE_EVENTS, invalidateTradeCaches } = require("../utils/cacheUtils");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");
const { evaluateSmartNotifications } = require("../services/smartNotificationEvaluator");
const streakService = require("../services/streak.service");
const onboardingService = require("../services/onboardingService");
const { handleStreakEvents } = require("../services/streakNotification.service");
const tradeLifecycleService = require("../services/tradeLifecycle.service");

async function updateStreaksForIndianTrade(userId, trade) {
  try {
    const result = await streakService.recordTradeAndRecompute(userId, trade);
    handleStreakEvents(userId, result.events).catch((err) =>
      logger.warn("STREAK_EVENTS_HANDLER_FAILED", { error: err?.message })
    );
  } catch (err) {
    logger.warn("STREAK_UPDATE_FAILED", { userId: String(userId), error: err?.message });
  }
}
const {
  getOcrConfirmationTrades,
  markOcrJobConfirmed,
} = require("../services/ocrJob.service");
const { normalizeTradeDate } = require("../utils/dateUtils");
const { destroyImages } = require("../utils/cloudinaryHelpers");
const { logger } = require("../utils/logger");
const { pickIndianTradeFields } = require("../utils/tradeFieldAllowlist");
const {
  deriveIndianProfit,
  trustedOcrProfitForTrade,
} = require("../utils/tradeProfit");

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
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(401, "Invalid authenticated user ID", "INVALID_USER_ID");
  }
  return new mongoose.Types.ObjectId(id);
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
  "effectiveTradeDate",
  "instrumentType",
  "segment",
  "tradeType",
  "stockSymbol",
  "sharesQty",
  "exchange",
  "sector",
  "strikePrice",
].join(" ");

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

function requirePositiveNumber(value, label) {
  const parsed = parseFiniteNumber(value);
  if (parsed == null || parsed <= 0) {
    throw new ApiError(400, `${label} must be greater than 0`, "VALIDATION_ERROR");
  }
  return parsed;
}

function normalizeOptionalNumber(target, field) {
  const parsed = parseFiniteNumber(target[field]);
  if (parsed == null) {
    delete target[field];
    return null;
  }
  target[field] = parsed;
  return parsed;
}

function buildIndianTradeDocument(
  userId,
  payload,
  { accountCreatedAt, extractedTrades = [], tradeIndex = 0 } = {}
) {
  const editablePayload = pickIndianTradeFields(payload);
  const { pair, type, underlying, strikePrice, optionType, tradeDate, instrumentType, stockSymbol, sharesQty } = editablePayload;

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
    editablePayload.sharesQty = normalizedSharesQty;
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

  const tradeData = {
    ...editablePayload,
    pair: symbol,
    type: type.toUpperCase(),
    tradeDate: normalizeTradeDate(tradeDate, { accountCreatedAt }),
    user: userId,
  };
  tradeData.effectiveTradeDate = tradeData.tradeDate;

  const trustedOcrProfit = trustedOcrProfitForTrade({
    ...payload,
    pair: symbol,
    optionType: ot,
    strikePrice: editablePayload.strikePrice ?? strikePrice,
    underlying: editablePayload.underlying ?? underlying,
  }, extractedTrades, tradeIndex);

  if (!isEquity) {
    tradeData.optionType = ot;
    tradeData.instrumentType = "OPTION";
    tradeData.segment = "F&O";
    if (trustedOcrProfit !== null) {
      const quantity = parseFiniteNumber(tradeData.quantity);
      const lotSize = parseFiniteNumber(tradeData.lotSize);
      if (quantity !== null && quantity < 0) {
        throw new ApiError(400, "Quantity cannot be negative", "VALIDATION_ERROR");
      }
      if (lotSize !== null && lotSize <= 0) {
        throw new ApiError(400, "Lot size must be greater than 0", "VALIDATION_ERROR");
      }
      if (quantity === null) delete tradeData.quantity;
      else tradeData.quantity = quantity;
      if (lotSize === null) delete tradeData.lotSize;
      else tradeData.lotSize = lotSize;
    } else {
      tradeData.quantity = requirePositiveNumber(tradeData.quantity, "Quantity");
      tradeData.lotSize = requirePositiveNumber(tradeData.lotSize, "Lot size");
    }
  } else {
    tradeData.instrumentType = "EQUITY";
    tradeData.segment = "EQUITY";
    tradeData.tradeType = "INTRADAY";
    tradeData.sharesQty = requirePositiveNumber(tradeData.sharesQty, "Shares quantity");
  }

  // entryPrice/exitPrice are only mandatory when we have to *derive* the P&L
  // from them. Many closed Indian positions (Avg = 0.00 on the broker
  // screenshot) legitimately have no per-unit entry/exit price — only an
  // aggregate P&L — so when the caller already submits a trusted profit
  // value, don't force a fabricated price into these fields just to pass
  // validation.
  normalizeOptionalNumber(tradeData, "entryPrice");
  normalizeOptionalNumber(tradeData, "exitPrice");
  normalizeOptionalNumber(tradeData, "brokerage");
  normalizeOptionalNumber(tradeData, "sttTaxes");
  normalizeOptionalNumber(tradeData, "stopLoss");
  normalizeOptionalNumber(tradeData, "takeProfit");
  normalizeOptionalNumber(tradeData, "strikePrice");

  const submittedProfit = parseFiniteNumber(tradeData.profit);
  if (trustedOcrProfit !== null) {
    tradeData.profit = trustedOcrProfit;
  } else if (submittedProfit !== null) {
    tradeData.profit = submittedProfit;
  } else {
    tradeData.entryPrice = requirePositiveNumber(tradeData.entryPrice, "Entry price");
    tradeData.exitPrice = requirePositiveNumber(tradeData.exitPrice, "Exit price");
    const derivedProfit = deriveIndianProfit(tradeData);
    if (derivedProfit !== null) {
      tradeData.profit = derivedProfit;
    }
  }

  if (parseFiniteNumber(tradeData.profit) === null) {
    throw new ApiError(400, "P&L is required", "VALIDATION_ERROR");
  }

  return tradeData;
}

exports.createTrade = asyncHandler(async (req, res) => {
  const ocrJobId = req.body?.ocrJobId || null;
  const extractedTrades = ocrJobId
    ? await getOcrConfirmationTrades(req.user._id, ocrJobId, "Indian_Market")
    : [];
  const tradeData = buildIndianTradeDocument(req.user._id, req.body, {
    accountCreatedAt: req.user.createdAt,
    extractedTrades,
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
  await updateStreaksForIndianTrade(req.user._id, trade);
  onboardingService
    .markTradeLogged({ userId: req.user._id, fromScreenshot: Boolean(ocrJobId) })
    .catch((err) => logger.warn("ONBOARDING_MARK_FAILED", { error: err?.message }));
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
  const extractedTrades = ocrJobId
    ? await getOcrConfirmationTrades(req.user._id, ocrJobId, "Indian_Market")
    : [];
  const docs = trades.map((trade, tradeIndex) => buildIndianTradeDocument(req.user._id, trade, {
    accountCreatedAt: req.user.createdAt,
    extractedTrades,
    tradeIndex,
  }));

  // Atomic: insertMany + markOcrJobConfirmed in one transaction. If the OCR
  // confirm fails the trades roll back, preventing a half-written batch with
  // an un-confirmed job. Cache invalidation and notification dispatch run
  // AFTER commit since they touch external systems (Redis, queues).
  // Standalone MongoDB (local dev) does not support transactions — falls back
  // to direct inserts when the session rejects the transaction start.
  let createdTrades;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      createdTrades = await IndianTrade.insertMany(docs, { ordered: true, session });
      if (ocrJobId && createdTrades[0]) {
        await markOcrJobConfirmed(req.user._id, ocrJobId, {
          tradeId: createdTrades[0]._id,
          collection: "indian",
          session,
        });
      }
    });
  } catch (txErr) {
    const isStandaloneError =
      txErr?.codeName === "IllegalOperation" ||
      String(txErr?.message || "").includes("Transaction numbers are only allowed") ||
      String(txErr?.message || "").includes("replica set");
    if (!isStandaloneError) throw txErr;
    // Fallback: non-transactional path for standalone MongoDB
    createdTrades = await IndianTrade.insertMany(docs, { ordered: true });
    if (ocrJobId && createdTrades[0]) {
      await markOcrJobConfirmed(req.user._id, ocrJobId, {
        tradeId: createdTrades[0]._id,
        collection: "indian",
      });
    }
  } finally {
    await session.endSession();
  }

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
  onboardingService
    .markTradeLogged({ userId: req.user._id, fromScreenshot: Boolean(ocrJobId) })
    .catch((err) => logger.warn("ONBOARDING_MARK_FAILED", { error: err?.message }));
  for (const t of createdTrades) {
    try { await streakService.recordTradeEvent(req.user._id, t); } catch (e) {
      logger.warn("STREAK_BULK_RECORD_FAILED", { error: e?.message });
    }
  }
  try {
    const recompute = await streakService.recomputeStreaks(req.user._id);
    handleStreakEvents(req.user._id, recompute.events).catch(() => {});
  } catch (e) {
    logger.warn("STREAK_BULK_RECOMPUTE_FAILED", { error: e?.message });
  }

  res.status(201).json({
    success: true,
    count: createdTrades.length,
    trades: createdTrades,
  });
});

// Cursor pagination on (effectiveTradeDate DESC, _id DESC).
//
// Client passes ?cursor=<ISO-date>&cursorId=<ObjectId> from the previous
// page's last row. Server returns the page + a {nextCursor, nextCursorId}
// pair if more rows exist. Cost is O(limit) regardless of depth — old
// $skip(page*limit) was O(page*limit) and unusable beyond page ~100.
//
// Backward compat: if neither cursor is provided, the old ?page=N&limit=L
// API is still honoured for page 1 only (page>1 returns first page; clients
// must migrate to cursor for deep paging).
exports.getTrades = asyncHandler(async (req, res) => {
  const period = String(req.query.period || "all").toLowerCase();
  const query = { user: userMatch(req.user._id), deletedAt: null };
  const periodStart = getPeriodStart(period);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));

  if (periodStart) {
    query.effectiveTradeDate = { $gte: periodStart };
  }

  // Cursor: { date: ISO string, id: ObjectId hex } from previous page tail.
  const cursorDate = req.query.cursor ? new Date(req.query.cursor) : null;
  const cursorId = req.query.cursorId && mongoose.Types.ObjectId.isValid(req.query.cursorId)
    ? new mongoose.Types.ObjectId(req.query.cursorId)
    : null;

  // Cursor predicate: strictly past the previous tail on the same sort.
  if (cursorDate && cursorId) {
    query.$or = [
      { effectiveTradeDate: { $lt: cursorDate } },
      { effectiveTradeDate: cursorDate, _id: { $lt: cursorId } },
    ];
  }

  const rows = await IndianTrade.find(query)
    .sort({ effectiveTradeDate: -1, _id: -1 })
    .limit(limit + 1)
    .select(INDIAN_TRADE_LIST_PROJECTION)
    .lean();
  const hasMore = rows.length > limit;
  const trades = hasMore ? rows.slice(0, limit) : rows;

  // Backward compat: legacy clients omit ?cursor — return the bare array,
  // matching the previous response shape exactly.
  const clientWantsCursor = req.query.cursor !== undefined || req.query.cursorId !== undefined;
  if (!clientWantsCursor) {
    return res.json(trades);
  }

  const tail = trades[trades.length - 1];
  res.json({
    trades,
    nextCursor:    hasMore && tail ? (tail.effectiveTradeDate || tail.tradeDate || tail.createdAt) : null,
    nextCursorId:  hasMore && tail ? tail._id : null,
    hasMore,
  });
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

  const update = pickIndianTradeFields(req.body);
  delete update.tradeDate;
  if (tradeDate != null && String(tradeDate).trim() !== "") {
    update.tradeDate = normalizeTradeDate(tradeDate, { accountCreatedAt: req.user.createdAt });
    update.effectiveTradeDate = update.tradeDate;
  }
  if (type) {
    update.type = type.toUpperCase();
  }
  if (Object.keys(update).length === 0) {
    throw new ApiError(400, "No editable trade fields provided", "VALIDATION_ERROR");
  }

  const profitBasisFields = [
    "profit", "type", "entryPrice", "exitPrice", "instrumentType",
    "sharesQty", "quantity", "lotSize", "brokerage", "sttTaxes",
  ];
  const shouldDeriveProfit = profitBasisFields.some((field) =>
    Object.prototype.hasOwnProperty.call(req.body, field)
  );

  let existing = null;
  if (shouldDeriveProfit || Array.isArray(update.tradeImages)) {
    existing = await IndianTrade.findOne({
      _id: req.params.id,
      user: req.user._id,
      deletedAt: null,
    })
      .select(
        "type entryPrice exitPrice instrumentType sharesQty quantity lotSize " +
        "brokerage sttTaxes tradeImages"
      )
      .lean();
  }

  if (shouldDeriveProfit) {
    const candidate = { ...(existing || {}), ...update };
    const submittedProfit = parseFiniteNumber(update.profit);
    if (submittedProfit !== null) {
      // A trusted P&L was submitted directly — don't force entry/exit price
      // validation for closed positions that never showed a per-unit price.
      update.profit = submittedProfit;
    } else {
      const isEquity = String(candidate.instrumentType || "").toUpperCase() === "EQUITY";
      if (isEquity) {
        candidate.sharesQty = requirePositiveNumber(candidate.sharesQty, "Shares quantity");
      } else {
        candidate.quantity = requirePositiveNumber(candidate.quantity, "Quantity");
        candidate.lotSize = requirePositiveNumber(candidate.lotSize, "Lot size");
      }
      candidate.entryPrice = requirePositiveNumber(candidate.entryPrice, "Entry price");
      candidate.exitPrice = requirePositiveNumber(candidate.exitPrice, "Exit price");
      const derivedProfit = deriveIndianProfit(candidate);
      if (derivedProfit === null) {
        throw new ApiError(400, "P&L is required", "VALIDATION_ERROR");
      }
      update.profit = derivedProfit;
    }
  }

  // Diff tradeImages to identify removed Cloudinary assets for cleanup.
  let removedImages = [];
  if (Array.isArray(update.tradeImages)) {
    if (existing?.tradeImages?.length) {
      const keepIds = new Set(
        update.tradeImages
          .map(img => img?.publicId)
          .filter(Boolean)
      );
      removedImages = existing.tradeImages.filter(img => img.publicId && !keepIds.has(img.publicId));
    }
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

  if (removedImages.length > 0) {
    destroyImages(removedImages).catch(err => {
      logger.warn("Indian trade evidence cleanup failed", {
        tradeId: req.params.id,
        error: err.message,
      });
    });
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
  await updateStreaksForIndianTrade(req.user._id, trade);

  res.json(trade);
});

exports.deleteTrade = asyncHandler(async (req, res) => {
  const trade = await tradeLifecycleService.softDeleteTrade(IndianTrade, {
    tradeId: req.params.id,
    userId: req.user._id,
    deletedBy: req.user._id,
    deleteReason: req.body?.deleteReason || "",
    deletedSource: "user",
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
