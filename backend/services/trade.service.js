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
  getOcrConfirmationTrades,
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
  let trustedProfit = null;
  if (ocrJobId) {
    const extractedTrades = await getOcrConfirmationTrades(userId, ocrJobId, "Forex");
    trustedProfit = trustedOcrProfitForTrade(payload, extractedTrades);
  }
  if (trustedProfit !== null) {
    tradePayload.profit = trustedProfit;
  } else {
    const derivedProfit = deriveForexProfit(tradePayload);
    if (derivedProfit !== null) tradePayload.profit = derivedProfit;
  }
  const normalizedTradeDate = normalizeTradeDate(payload.tradeDate, { accountCreatedAt });
  const trade = await tradeRepository.createTrade({
    ...tradePayload,
    type: normalizeTradeType(payload.type),
    tradeDate: normalizedTradeDate,
    effectiveTradeDate: normalizedTradeDate,
    user: userId,
    status: "completed",
    error: null,
    processedAt: new Date(),
  });

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
  { accountCreatedAt, extractedTrades = [], tradeIndex = 0 } = {}
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
  const trustedProfit = trustedOcrProfitForTrade(payload, extractedTrades, tradeIndex);
  if (trustedProfit !== null) {
    tradePayload.profit = trustedProfit;
  } else {
    const derivedProfit = deriveForexProfit(tradePayload);
    if (derivedProfit !== null) tradePayload.profit = derivedProfit;
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
  const extractedTrades = ocrJobId
    ? await getOcrConfirmationTrades(userId, ocrJobId, "Forex")
    : [];
  const docs = trades.map((trade, tradeIndex) => buildCreateTradeDocument(userId, trade, {
    accountCreatedAt,
    extractedTrades,
    tradeIndex,
  }));
  const createdTrades = await tradeRepository.createTrades(docs);

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

  // Load the current calculation inputs when the P&L basis changes. The same
  // query also supplies tradeImages for cleanup when that array is replaced.
  let existing = null;
  if (shouldDeriveProfit || Array.isArray(update.tradeImages)) {
    existing = await Trade.findOne({ _id: tradeId, user: userId })
      .select("pair type entryPrice exitPrice lotSize quantity commission swap tradeImages")
      .lean();
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
};
