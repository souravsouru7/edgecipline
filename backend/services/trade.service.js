const ApiError = require("../utils/ApiError");
const { buildCacheKey, getCache, rememberCache } = require("../utils/cache");
const { TRADE_CACHE_EVENTS, getTradeCacheVersion, invalidateTradeCaches } = require("../utils/cacheUtils");
const Trade = require("../models/Trade");
const tradeRepository = require("../repositories/trade.repository");
const { evaluateSmartNotifications } = require("./smartNotificationEvaluator");
const { onTradeSaved, onTradeDeleted, onTradeUpdated } = require("./missionProgressService");
const streakService = require("./streak.service");
const onboardingService = require("./onboardingService");
const { handleStreakEvents } = require("./streakNotification.service");
const tradeLifecycleService = require("./tradeLifecycle.service");
const { normalizeTradeDate } = require("../utils/dateUtils");
const {
  claimOcrJobForConfirmation,
  releaseOcrJobClaim,
  extractConfirmationTrades,
  markOcrJobConfirmed,
} = require("./ocrJob.service");
const { destroyImages } = require("../utils/cloudinaryHelpers");
const { logger } = require("../utils/logger");
const { pickForexTradeFields } = require("../utils/tradeFieldAllowlist");
const {
  deriveForexProfit,
  trustedOcrProfitForTrade,
} = require("../utils/tradeProfit");
const { buildPagination } = require("../utils/apiResponse");

const TRADE_LIST_TTL_SECONDS = 45;
const TRADE_STATUS_TTL_SECONDS = 10;
const TRADE_DETAILS_TTL_SECONDS = 45;

function normalizeTradeType(type) {
  const normalizedType = String(type || "").toUpperCase();
  if (normalizedType !== "BUY" && normalizedType !== "SELL") {
    throw new ApiError(400, "Type must be BUY or SELL", "VALIDATION_ERROR");
  }
  return normalizedType;
}

// Forex trades had no business-rule check on position size at all -- the
// Mongoose schema alone accepts negative/zero quantity and lot size. Mirrors
// the equivalent guard already in indianTradeController.js. Only validates
// when a value is actually provided, since neither field is required.
function requirePositiveIfProvided(value, label) {
  if (value == null || value === "") return undefined;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    throw new ApiError(400, `${label} must be a positive number`, "VALIDATION_ERROR");
  }
  return num;
}

function requirePositiveNumber(value, label) {
  if (value == null || value === "") {
    throw new ApiError(400, `${label} is required`, "VALIDATION_ERROR");
  }
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    throw new ApiError(400, `${label} must be a positive number`, "VALIDATION_ERROR");
  }
  return num;
}

function requireEntryBasisCustomText(entryBasis, entryBasisCustom) {
  if (entryBasis === "Custom" && !String(entryBasisCustom || "").trim()) {
    throw new ApiError(400, "Custom entry basis requires a description", "VALIDATION_ERROR");
  }
}

function enforcePositiveTradeSize(tradePayload) {
  const quantity = requirePositiveIfProvided(tradePayload.quantity, "Quantity");
  if (quantity !== undefined) tradePayload.quantity = quantity;
  const lotSize = requirePositiveIfProvided(tradePayload.lotSize, "Lot size");
  if (lotSize !== undefined) tradePayload.lotSize = lotSize;
}

function enforceManualForexPricing(tradePayload) {
  tradePayload.entryPrice = requirePositiveNumber(tradePayload.entryPrice, "Entry price");
  tradePayload.exitPrice = requirePositiveNumber(tradePayload.exitPrice, "Exit price");

  if (tradePayload.lotSize == null && tradePayload.quantity == null) {
    throw new ApiError(400, "Lot size is required", "VALIDATION_ERROR");
  }
}

// insertMany({ordered:true}) on a mid-batch failure leaves the earlier
// documents committed in Mongo but throws a plain (non-ApiError) bulk-write
// error -- which the global error handler flattens into a generic 500
// "Something went wrong", hiding both which trades already saved and that
// a retry of the full batch would duplicate them. Surface that explicitly.
function isBulkWriteError(err) {
  return Boolean(err) && (
    err.name === "MongoBulkWriteError" ||
    err.name === "BulkWriteError" ||
    Array.isArray(err.writeErrors) ||
    Array.isArray(err.insertedDocs)
  );
}

// An OCR-confirmed trade gets its double-submit protection from the atomic
// claimOcrJobForConfirmation() gate above -- but a plain manual trade has no
// ocrJobId to key that off, so a double-click or a client retry after a
// dropped response creates two identical Trade documents with nothing to
// stop it. Fall back to matching on the trade's own content within a short
// window: if the same user just created a trade with the same pair/type/
// date/size/prices/profit, treat this submission as the same one.
const DUPLICATE_TRADE_WINDOW_MS = 10_000;

function buildDuplicateTradeQuery(userId, tradeDoc) {
  const query = {
    user: userId,
    pair: tradeDoc.pair,
    type: tradeDoc.type,
    tradeDate: tradeDoc.tradeDate,
    createdAt: { $gte: new Date(Date.now() - DUPLICATE_TRADE_WINDOW_MS) },
  };
  for (const field of ["quantity", "lotSize", "entryPrice", "exitPrice", "profit"]) {
    if (tradeDoc[field] !== undefined) query[field] = tradeDoc[field];
  }
  return query;
}

async function findRecentDuplicateTrade(userId, tradeDoc) {
  return Trade.findOne(buildDuplicateTradeQuery(userId, tradeDoc)).sort({ createdAt: -1 });
}

function wrapBatchInsertError(err, totalCount) {
  if (!isBulkWriteError(err)) return err;
  const insertedDocs = Array.isArray(err.insertedDocs) ? err.insertedDocs : [];
  const insertedCount = insertedDocs.length || Number(err?.result?.nInserted ?? err?.result?.result?.nInserted ?? 0);
  const failedCount = Math.max(0, totalCount - insertedCount);
  const insertedTradeIds = insertedDocs.map((d) => d?._id).filter(Boolean);
  return new ApiError(
    409,
    insertedCount > 0
      ? `${insertedCount} of ${totalCount} trades were saved before an error occurred (${failedCount} failed). Check your trade log before retrying to avoid duplicates.`
      : `Failed to save trades: ${err.message}`,
    "BATCH_PARTIAL_FAILURE",
    { insertedCount, failedCount, insertedTradeIds }
  );
}

// setMonth()/setFullYear() don't clamp -- subtracting a month from e.g. Mar
// 31 overflows into Feb 31, which JS silently rolls into Mar 3 instead of
// erroring, shrinking the "last month" filter to skip nearly all of
// February. Set the day to 1 before changing month/year (so the change
// itself can't overflow), then clamp back to the last real day of the
// resulting month. Same rollover class as the bug already fixed in
// normalizeTradeDate (utils/dateUtils.js).
function subtractMonthsClamped(date, months) {
  const originalDay = date.getDate();
  const result = new Date(date);
  result.setDate(1);
  result.setMonth(result.getMonth() - months);
  const daysInResultMonth = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(originalDay, daysInResultMonth));
  return result;
}

function getPeriodStart(period) {
  const now = new Date();
  const start = new Date(now);

  switch (String(period || "all").toLowerCase()) {
    case "1w":
      start.setDate(start.getDate() - 7);
      return start;
    case "1m":
      return subtractMonthsClamped(now, 1);
    case "3m":
      return subtractMonthsClamped(now, 3);
    case "1y":
      return subtractMonthsClamped(now, 12);
    default:
      return null;
  }
}

async function createTrade(userId, payload, { accountCreatedAt } = {}) {
  if (!payload.pair) {
    throw new ApiError(400, "Pair is required", "VALIDATION_ERROR");
  }
  if (!payload.type) {
    throw new ApiError(400, "Action/Type is required", "VALIDATION_ERROR");
  }
  if (!payload.tradeDate) {
    throw new ApiError(400, "Trade date is required", "VALIDATION_ERROR");
  }

  const ocrJobId = payload.ocrJobId;
  const tradePayload = pickForexTradeFields(payload);
  enforcePositiveTradeSize(tradePayload);
  requireEntryBasisCustomText(tradePayload.entryBasis, tradePayload.entryBasisCustom);
  let trustedProfit = null;
  if (ocrJobId) {
    // Claim the job (COMPLETED -> CONFIRMED) before creating the trade, so a
    // second concurrent confirm of the same screenshot is rejected here
    // instead of both requests silently creating separate Trade documents.
    const claimedJob = await claimOcrJobForConfirmation(userId, ocrJobId, "Forex");
    const extractedTrades = extractConfirmationTrades(claimedJob);
    trustedProfit = trustedOcrProfitForTrade(payload, extractedTrades);
  }
  if (trustedProfit !== null) {
    tradePayload.profit = trustedProfit;
  } else {
    if (!ocrJobId) enforceManualForexPricing(tradePayload);
    const derivedProfit = deriveForexProfit(tradePayload);
    if (derivedProfit !== null) {
      tradePayload.profit = derivedProfit;
    } else if (!ocrJobId) {
      throw new ApiError(
        400,
        "P&L cannot be derived for this Forex instrument",
        "VALIDATION_ERROR"
      );
    }
  }
  const normalizedTradeDate = normalizeTradeDate(payload.tradeDate, { accountCreatedAt });
  const candidateDoc = {
    ...tradePayload,
    type: normalizeTradeType(payload.type),
    tradeDate: normalizedTradeDate,
  };

  if (!ocrJobId) {
    const duplicate = await findRecentDuplicateTrade(userId, candidateDoc);
    if (duplicate) return duplicate;
  }

  let trade;
  try {
    trade = await tradeRepository.createTrade({
      ...candidateDoc,
      effectiveTradeDate: normalizedTradeDate,
      user: userId,
      status: "completed",
      error: null,
      processedAt: new Date(),
    });
  } catch (err) {
    if (ocrJobId) await releaseOcrJobClaim(userId, ocrJobId);
    throw err;
  }

  await invalidateTradeCaches({
    userId,
    event: ocrJobId ? TRADE_CACHE_EVENTS.OCR_SAVE : TRADE_CACHE_EVENTS.CREATE,
    market: "Forex",
    tradeId: trade._id,
    source: ocrJobId ? "ocr_confirm" : "manual_create",
  });
  await evaluateSmartNotifications({
    userId,
    trade,
    marketType: "Forex",
    collection: "forex",
  });
  await updateStreaksForTrade(userId, trade);
  onTradeSaved(userId, trade).catch(err =>
    logger.warn("MISSION_PROGRESS_TRADE_SAVE_FAILED", { error: err?.message })
  );
  // Onboarding activation: stamp first-trade timestamps and flip the
  // tradeAdded flag. Fire-and-forget so a failed write never breaks the
  // trade save — the dashboard derivation will catch up regardless.
  onboardingService
    .markTradeLogged({ userId, fromScreenshot: Boolean(ocrJobId) })
    .catch((err) => logger.warn("ONBOARDING_MARK_FAILED", { error: err?.message }));
  if (ocrJobId) {
    await markOcrJobConfirmed(userId, ocrJobId, {
      tradeId: trade._id,
      collection: "forex",
    });
  }
  return trade;
}

// Record the trade into the daily discipline index and recompute streaks.
// Side-effects only (push notifications) are fire-and-forget — streak math
// errors should never break a trade save.
async function updateStreaksForTrade(userId, trade) {
  try {
    const result = await streakService.recordTradeAndRecompute(userId, trade);
    handleStreakEvents(userId, result.events).catch((err) =>
      logger.warn("STREAK_EVENTS_HANDLER_FAILED", { error: err?.message })
    );
  } catch (err) {
    logger.warn("STREAK_UPDATE_FAILED", { userId: String(userId), error: err?.message });
  }
}

function buildCreateTradeDocument(
  userId,
  payload,
  { accountCreatedAt, extractedTrades = [], tradeIndex = 0, ocrConfirmed = false } = {}
) {
  if (!payload.pair) {
    throw new ApiError(400, "Pair is required", "VALIDATION_ERROR");
  }
  if (!payload.type) {
    throw new ApiError(400, "Action/Type is required", "VALIDATION_ERROR");
  }
  if (!payload.tradeDate) {
    throw new ApiError(400, "Trade date is required", "VALIDATION_ERROR");
  }

  const tradePayload = pickForexTradeFields(payload);
  enforcePositiveTradeSize(tradePayload);
  requireEntryBasisCustomText(tradePayload.entryBasis, tradePayload.entryBasisCustom);
  const trustedProfit = trustedOcrProfitForTrade(payload, extractedTrades, tradeIndex);
  if (trustedProfit !== null) {
    tradePayload.profit = trustedProfit;
  } else {
    if (!ocrConfirmed) enforceManualForexPricing(tradePayload);
    const derivedProfit = deriveForexProfit(tradePayload);
    if (derivedProfit !== null) {
      tradePayload.profit = derivedProfit;
    } else if (!ocrConfirmed) {
      throw new ApiError(
        400,
        "P&L cannot be derived for this Forex instrument",
        "VALIDATION_ERROR"
      );
    }
  }
  const normalizedTradeDate = normalizeTradeDate(payload.tradeDate, { accountCreatedAt });
  return {
    ...tradePayload,
    type: normalizeTradeType(payload.type),
    tradeDate: normalizedTradeDate,
    effectiveTradeDate: normalizedTradeDate,
    user: userId,
    status: "completed",
    error: null,
    processedAt: new Date(),
  };
}

async function createTradesBatch(userId, payload, { accountCreatedAt } = {}) {
  const trades = Array.isArray(payload?.trades) ? payload.trades : [];
  if (trades.length === 0) {
    throw new ApiError(400, "At least one trade is required", "VALIDATION_ERROR");
  }
  if (trades.length > 100) {
    throw new ApiError(400, "Batch trade import cannot exceed 100 trades", "VALIDATION_ERROR");
  }

  const ocrJobId = payload.ocrJobId || trades.find((trade) => trade?.ocrJobId)?.ocrJobId || null;
  let extractedTrades = [];
  if (ocrJobId) {
    const claimedJob = await claimOcrJobForConfirmation(userId, ocrJobId, "Forex");
    extractedTrades = extractConfirmationTrades(claimedJob);
  }
  const docs = trades.map((trade, tradeIndex) => buildCreateTradeDocument(userId, trade, {
    accountCreatedAt,
    extractedTrades,
    tradeIndex,
    ocrConfirmed: Boolean(ocrJobId),
  }));
  let createdTrades;
  try {
    createdTrades = await tradeRepository.createTrades(docs);
  } catch (err) {
    if (ocrJobId) await releaseOcrJobClaim(userId, ocrJobId);
    throw wrapBatchInsertError(err, docs.length);
  }

  await invalidateTradeCaches({
    userId,
    event: ocrJobId ? TRADE_CACHE_EVENTS.OCR_SAVE : TRADE_CACHE_EVENTS.BULK_IMPORT,
    market: "Forex",
    tradeId: createdTrades[0]?._id || null,
    count: createdTrades.length,
    source: ocrJobId ? "ocr_batch_confirm" : "batch_create",
  });

  const representativeTrade = createdTrades[createdTrades.length - 1];
  if (representativeTrade) {
    await evaluateSmartNotifications({
      userId,
      trade: representativeTrade,
      marketType: "Forex",
      collection: "forex",
    });
  }
  // Index every trade individually for streak purposes — bulk imports may
  // span multiple days and we want each day's entry to reflect reality.
  for (const t of createdTrades) {
    try { await streakService.recordTradeEvent(userId, t); } catch (e) {
      logger.warn("STREAK_BULK_RECORD_FAILED", { error: e?.message });
    }
  }
  try {
    const recompute = await streakService.recomputeStreaks(userId);
    handleStreakEvents(userId, recompute.events).catch(() => {});
  } catch (e) {
    logger.warn("STREAK_BULK_RECOMPUTE_FAILED", { error: e?.message });
  }

  if (ocrJobId && createdTrades[0]) {
    await markOcrJobConfirmed(userId, ocrJobId, {
      tradeId: createdTrades[0]._id,
      collection: "forex",
    });
  }

  if (createdTrades.length > 0) {
    onboardingService
      .markTradeLogged({ userId, fromScreenshot: Boolean(ocrJobId) })
      .catch((err) => logger.warn("ONBOARDING_MARK_FAILED", { error: err?.message }));
  }

  return {
    success: true,
    count: createdTrades.length,
    trades: createdTrades,
  };
}

async function getTrades(userId, query) {
  const period = String(query.period || "all").toLowerCase();
  const page = Number(query.page) || 1;
  const limit = Number(query.limit) || 50;
  const periodStart = getPeriodStart(period);
  const version = await getTradeCacheVersion(userId);
  const key = buildCacheKey("trades", userId, `version=${version}`, "list", `period=${period}&page=${page}&limit=${limit}`);
  const startedAt = Date.now();
  const { data: result } = await rememberCache(key, TRADE_LIST_TTL_SECONDS, async () => {
    const [rows, total] = await Promise.all([
      tradeRepository.findForexTradesByUser(userId, { dateFrom: periodStart, page, limit }),
      tradeRepository.countForexTradesByUser(userId, { dateFrom: periodStart }),
    ]);
    return {
      items: rows.map((trade) => ({
        ...trade,
        symbol: trade.pair ?? null,
        pnl: trade.profit ?? 0,
      })),
      pagination: buildPagination({ page, limit, total }),
    };
  });
  const duration = Date.now() - startedAt;

  if (duration > 500) {
    console.warn(`[Performance] Slow DB query detected in getTrades: ${duration}ms`);
  }

  return result;
}

async function getTrade(userId, tradeId) {
  const version = await getTradeCacheVersion(userId);
  const key = buildCacheKey("trades", userId, `version=${version}`, "detail", tradeId);
  const startedAt = Date.now();
  const { data: trade } = await rememberCache(key, TRADE_DETAILS_TTL_SECONDS, () =>
    tradeRepository.findForexTradeByUser(tradeId, userId)
  );
  const duration = Date.now() - startedAt;

  if (duration > 500) {
    console.warn(`[Performance] Slow DB query detected in getTrade: ${duration}ms`);
  }

  if (!trade) {
    throw new ApiError(404, "Trade not found or unauthorized", "NOT_FOUND");
  }

  return trade;
}

async function getTradeStatus(userId, tradeId) {
  const version = await getTradeCacheVersion(userId);
  const key = buildCacheKey("trades", userId, `version=${version}`, "status", tradeId);
  const startedAt = Date.now();
  const { data: trade } = await rememberCache(key, TRADE_STATUS_TTL_SECONDS, () =>
    tradeRepository.findTradeByIdAndUser(tradeId, userId)
  );
  const duration = Date.now() - startedAt;

  if (duration > 500) {
    console.warn(`[Performance] Slow DB query detected in getTradeStatus: ${duration}ms`);
  }

  if (!trade) {
    const bridgeKey = buildCacheKey("trade_status_bridge", userId, tradeId);
    const bridgedStatus = await getCache(bridgeKey);
    if (bridgedStatus) {
      return bridgedStatus;
    }
    throw new ApiError(404, "Trade not found or unauthorized", "NOT_FOUND");
  }

  if (trade?.parsedData?.multiTradeGhost === true) {
    return {
      jobId: trade.ocrJobId || trade._id.toString(),
      status: "completed",
      attemptsMade: trade.ocrAttempts || 0,
      data: {
        parsedData: trade.parsedData,
        parsedTrade: trade.parsedData?.parsedTrade || null,
        parsedTrades: trade.parsedData?.parsedTrades || [],
        imageUrl: trade.imageUrl || trade.screenshot || "",
        screenshot: trade.screenshot || trade.imageUrl || "",
        extractedText: trade.extractedText || "",
        marketType: trade.marketType || "Forex",
        tradeSubType: trade.tradeSubType || "",
        tradeDate: trade.tradeDate || null,
      },
      error: null,
    };
  }

  return {
    jobId: trade.ocrJobId || trade._id.toString(),
    status: trade.status,
    attemptsMade: trade.ocrAttempts || 0,
    data: trade.status === "completed" ? trade : null,
    error: trade.error || null,
  };
}

function resolveTradeDateFromPayload(payload, { accountCreatedAt } = {}) {
  if (payload.tradeDate == null || String(payload.tradeDate).trim() === "") {
    return undefined;
  }
  return normalizeTradeDate(payload.tradeDate, { accountCreatedAt });
}

async function updateTrade(userId, tradeId, payload, { accountCreatedAt } = {}) {
  const update = pickForexTradeFields(payload);
  if (payload.type) {
    update.type = normalizeTradeType(payload.type);
  }
  const normalizedTradeDate = resolveTradeDateFromPayload(payload, { accountCreatedAt });
  if (normalizedTradeDate !== undefined) {
    update.tradeDate = normalizedTradeDate;
    update.effectiveTradeDate = normalizedTradeDate;
  } else {
    delete update.tradeDate;
  }
  if (Object.keys(update).length === 0) {
    throw new ApiError(400, "No editable trade fields provided", "VALIDATION_ERROR");
  }

  const profitBasisFields = [
    "profit", "pair", "type", "entryPrice", "exitPrice",
    "lotSize", "quantity", "commission", "swap",
  ];
  const shouldDeriveProfit = profitBasisFields.some((field) =>
    Object.prototype.hasOwnProperty.call(payload, field)
  );

  const touchesEntryBasis = update.entryBasis !== undefined || update.entryBasisCustom !== undefined;

  // Load the current calculation inputs when the P&L basis changes. The same
  // query also supplies tradeImages for cleanup when that array is replaced,
  // and entryBasis/entryBasisCustom for the custom-text cross-field check.
  let existing = null;
  if (shouldDeriveProfit || Array.isArray(update.tradeImages) || touchesEntryBasis) {
    existing = await Trade.findOne({ _id: tradeId, user: userId })
      .select("pair type entryPrice exitPrice lotSize quantity commission swap tradeImages entryBasis entryBasisCustom")
      .lean();
  }

  if (touchesEntryBasis) {
    requireEntryBasisCustomText(
      update.entryBasis !== undefined ? update.entryBasis : existing?.entryBasis,
      update.entryBasisCustom !== undefined ? update.entryBasisCustom : existing?.entryBasisCustom
    );
  }

  let derivedProfit;
  if (shouldDeriveProfit) {
    derivedProfit = deriveForexProfit({ ...(existing || {}), ...update });
  }

  // If client is replacing the tradeImages array, diff against the existing
  // array and destroy removed Cloudinary assets. We fire-and-forget so a
  // Cloudinary outage doesn't block the update.
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

  const trade = shouldDeriveProfit
    ? await tradeRepository.updateForexTradeByUser(
        tradeId,
        userId,
        update,
        { derivedProfit }
      )
    : await tradeRepository.updateForexTradeByUser(tradeId, userId, update);
  if (!trade) {
    throw new ApiError(404, "Trade not found or unauthorized", "NOT_FOUND");
  }

  if (removedImages.length > 0) {
    destroyImages(removedImages).catch(err => {
      logger.warn("Trade evidence cleanup failed", { tradeId, error: err.message });
    });
  }

  await invalidateTradeCaches({
    userId,
    event: TRADE_CACHE_EVENTS.EDIT,
    market: "Forex",
    tradeId,
    source: "manual_edit",
  });
  await evaluateSmartNotifications({
    userId,
    trade,
    marketType: "Forex",
    collection: "forex",
  });
  // Edit may have added a setupScore or changed setupRules — refresh the
  // discipline index for the affected day and recompute. Idempotent.
  await updateStreaksForTrade(userId, trade);
  onTradeSaved(userId, trade).catch(err =>
    logger.warn("MISSION_PROGRESS_TRADE_UPDATE_FAILED", { error: err?.message })
  );
  return trade;
}

async function deleteTrade(userId, tradeId) {
  const trade = await tradeLifecycleService.softDeleteTrade(Trade, {
    tradeId,
    userId,
    deletedBy: userId,
    deletedSource: "user",
    marketFilter: { marketType: { $ne: "Indian_Market" } },
    options: { lean: true },
  });
  if (!trade) {
    throw new ApiError(404, "Trade not found or unauthorized", "NOT_FOUND");
  }

  await invalidateTradeCaches({
    userId,
    event: TRADE_CACHE_EVENTS.DELETE,
    market: "Forex",
    tradeId,
    source: "manual_delete",
  });
  onTradeDeleted(userId, trade).catch(err =>
    logger.warn("MISSION_PROGRESS_TRADE_DELETE_FAILED", { error: err?.message })
  );
  return { message: "Trade deleted", tradeId: trade._id, deletedAt: trade.deletedAt };
}

async function restoreTrade(userId, tradeId) {
  const trade = await tradeLifecycleService.restoreTrade(Trade, {
    tradeId,
    userId,
    marketFilter: { marketType: { $ne: "Indian_Market" } },
    options: { lean: true },
  });
  if (!trade) {
    throw new ApiError(404, "Deleted trade not found or unauthorized", "NOT_FOUND");
  }

  await invalidateTradeCaches({
    userId,
    event: TRADE_CACHE_EVENTS.RESTORE,
    market: "Forex",
    tradeId,
    source: "manual_restore",
  });
  return { message: "Trade restored", tradeId: trade._id };
}

module.exports = {
  createTrade,
  createTradesBatch,
  deleteTrade,
  getTrade,
  getTrades,
  getTradeStatus,
  restoreTrade,
  updateTrade,
  wrapBatchInsertError,
};
