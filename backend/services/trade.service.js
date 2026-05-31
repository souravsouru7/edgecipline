const ApiError = require("../utils/ApiError");
const { buildCacheKey, getCache, rememberCache } = require("../utils/cache");
const { clearUserCache } = require("../utils/cacheUtils");
const tradeRepository = require("../repositories/trade.repository");
const { evaluateSmartNotifications } = require("./smartNotificationEvaluator");
const { normalizeTradeDate } = require("../utils/dateUtils");

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

function getEffectiveTradeTime(trade) {
  return new Date(trade.tradeDate || trade.createdAt || 0).getTime();
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

  const trade = await tradeRepository.createTrade({
    ...payload,
    type: normalizeTradeType(payload.type),
    tradeDate: normalizeTradeDate(payload.tradeDate, { accountCreatedAt }),
    user: userId,
    status: payload.status || "completed",
    error: payload.error ?? null,
    processedAt: payload.processedAt || new Date(),
  });

  await clearUserCache(userId);
  await evaluateSmartNotifications({
    userId,
    trade,
    marketType: "Forex",
    collection: "forex",
  });
  return trade;
}

async function getTrades(userId, query) {
  const period = String(query.period || "all").toLowerCase();
  const page   = Math.max(1, parseInt(query.page,  10) || 1);
  const limit  = Math.min(200, Math.max(1, parseInt(query.limit, 10) || 50));
  const periodStart = getPeriodStart(period);
  const key = buildCacheKey("trades", userId, "list", `period=${period}&page=${page}&limit=${limit}`);
  const startedAt = Date.now();
  const { data: trades } = await rememberCache(key, TRADE_LIST_TTL_SECONDS, async () => {
    const rows = await tradeRepository.findForexTradesByUser(userId, { dateFrom: periodStart, page, limit });
    return rows
      .sort((a, b) => getEffectiveTradeTime(b) - getEffectiveTradeTime(a))
      .map((trade) => ({
        ...trade,
        symbol: trade.pair ?? null,
        pnl: trade.profit ?? 0,
      }));
  });
  const duration = Date.now() - startedAt;

  if (duration > 500) {
    console.warn(`[Performance] Slow DB query detected in getTrades: ${duration}ms`);
  }

  return trades;
}

async function getTrade(userId, tradeId) {
  const key = buildCacheKey("trades", userId, "detail", tradeId);
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
  const key = buildCacheKey("trades", userId, "status", tradeId);
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
  const update = Object.fromEntries(
    Object.entries({ ...payload }).filter(([, value]) => value !== undefined)
  );
  if (payload.type) {
    update.type = normalizeTradeType(payload.type);
  }
  const normalizedTradeDate = resolveTradeDateFromPayload(payload, { accountCreatedAt });
  if (normalizedTradeDate !== undefined) {
    update.tradeDate = normalizedTradeDate;
  } else {
    delete update.tradeDate;
  }

  const trade = await tradeRepository.updateForexTradeByUser(tradeId, userId, update);
  if (!trade) {
    throw new ApiError(404, "Trade not found or unauthorized", "NOT_FOUND");
  }

  await clearUserCache(userId);
  await evaluateSmartNotifications({
    userId,
    trade,
    marketType: "Forex",
    collection: "forex",
  });
  return trade;
}

async function deleteTrade(userId, tradeId) {
  const trade = await tradeRepository.deleteForexTradeByUser(tradeId, userId);
  if (!trade) {
    throw new ApiError(404, "Trade not found or unauthorized", "NOT_FOUND");
  }

  await clearUserCache(userId);
  return { message: "Trade deleted" };
}

module.exports = {
  createTrade,
  deleteTrade,
  getTrade,
  getTrades,
  getTradeStatus,
  updateTrade,
};
