const { client, isRedisReady } = require("../config/redis");
const { logger } = require("./logger");

/**
 * User trade mutations advance a version token used in every user-scoped cache key.
 * Old keys expire naturally by TTL, avoiding Redis SCAN/DEL bursts on hot users.
 */
const getTradeCacheVersion = async (userId) => {
  const normalizedUserId = userId?.toString?.() || String(userId || "");
  if (!normalizedUserId || !isRedisReady()) return "0";

  try {
    return (await client.get(`trade_version:${normalizedUserId}`)) || "0";
  } catch (error) {
    logger.warn("Failed to read trade cache version", {
      userId: normalizedUserId,
      error:  error.message,
    });
    return "0";
  }
};

const incrementTradeCacheVersion = async (userId) => {
  const normalizedUserId = userId?.toString?.() || String(userId || "");
  if (!normalizedUserId || !isRedisReady()) return 0;

  try {
    return await client.incr(`trade_version:${normalizedUserId}`);
  } catch (error) {
    logger.warn("Failed to increment trade cache version", {
      userId: normalizedUserId,
      error:  error.message,
    });
    return 0;
  }
};

const TRADE_CACHE_EVENTS = Object.freeze({
  BULK_DELETE: "bulk_delete",
  BULK_IMPORT: "bulk_import",
  CREATE: "create",
  DELETE: "delete",
  EDIT: "edit",
  IMPORT: "import",
  OCR_SAVE: "ocr_save",
  RESTORE: "restore",
});

const normalizeTradeCacheEvent = (event) => {
  const normalized = String(event || "").trim().toLowerCase();
  return Object.values(TRADE_CACHE_EVENTS).includes(normalized)
    ? normalized
    : "trade_mutation";
};

const invalidateTradeCaches = async ({
  userId,
  event,
  market = "all",
  tradeId = null,
  count = 1,
  source = "api",
} = {}) => {
  const normalizedUserId = userId?.toString?.() || String(userId || "");
  if (!normalizedUserId) return;

  const version = await incrementTradeCacheVersion(normalizedUserId);
  if (version > 0) {
    logger.info("Advanced user trade cache version", {
      userId: normalizedUserId,
      version,
      event: normalizeTradeCacheEvent(event),
      market,
      tradeId: tradeId?.toString?.() || tradeId || null,
      count,
      source,
    });
  }

  return version;
};

const clearUserCache = async (userId) => {
  return invalidateTradeCaches({
    userId,
    event: "trade_mutation",
    source: "legacy_clear_user_cache",
  });
};

module.exports = {
  TRADE_CACHE_EVENTS,
  clearUserCache,
  getTradeCacheVersion,
  invalidateTradeCaches,
  incrementTradeCacheVersion,
};
