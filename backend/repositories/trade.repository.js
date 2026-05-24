const Trade = require("../models/Trade");

const TRADE_LIST_PROJECTION = [
  "pair",
  "type",
  "quantity",
  "lotSize",
  "entryPrice",
  "exitPrice",
  "profit",
  "strategy",
  "session",
  "entryBasis",
  "entryBasisCustom",
  "tradeDate",
  "status",
  "marketType",
  "createdAt",
  "processedAt",
  "imageUrl",
  "screenshot",
  "needsReview",
  "extractionConfidence",
  "ocrJobId",
  "ocrAttempts",
].join(" ");

const TRADE_STATUS_PROJECTION = [
  "pair",
  "type",
  "quantity",
  "lotSize",
  "entryPrice",
  "exitPrice",
  "profit",
  "status",
  "error",
  "createdAt",
  "tradeDate",
  "queuedAt",
  "processingStartedAt",
  "processedAt",
  "ocrJobId",
  "ocrJobName",
  "ocrAttempts",
  "imageUrl",
  "screenshot",
  "marketType",
  "parsedData",
  "needsReview",
  "extractionConfidence",
].join(" ");

const WEEKLY_TRADE_PROJECTION = [
  "pair",
  "profit",
  "commission",
  "swap",
  "strategy",
  "session",
  "setupRules",
  "setupScore",
  "entryBasis",
  "mistakeTag",
  "createdAt",
  "tradeDate",
].join(" ");

async function createTrade(data) {
  return Trade.create(data);
}

async function findForexTradesByUser(userId, { page, limit } = {}) {
  const query = { user: userId, marketType: "Forex", "parsedData.multiTradeGhost": { $ne: true } };
  const cursor = Trade.find(query)
    .sort({ createdAt: -1 })
    .select(TRADE_LIST_PROJECTION)
    .lean();

  if (typeof page === "number" && typeof limit === "number") {
    cursor.skip((page - 1) * limit).limit(limit);
  }

  return cursor;
}

async function findForexTradeByUser(tradeId, userId) {
  return Trade.findOne({
    _id: tradeId,
    user: userId,
    marketType: "Forex",
  }).lean();
}

async function updateForexTradeByUser(tradeId, userId, update, options = {}) {
  return Trade.findOneAndUpdate(
    { _id: tradeId, user: userId, marketType: "Forex" },
    update,
    { returnDocument: "after", lean: true, ...options }
  );
}

async function deleteForexTradeByUser(tradeId, userId) {
  return Trade.findOneAndDelete({
    _id: tradeId,
    user: userId,
    marketType: "Forex",
  });
}

async function updateTradeById(tradeId, update, options = {}) {
  return Trade.findByIdAndUpdate(tradeId, update, { returnDocument: "after", ...options });
}

async function findTradeByIdAndUser(tradeId, userId) {
  return Trade.findOne({ _id: tradeId, user: userId })
    .select(TRADE_STATUS_PROJECTION)
    .lean();
}

async function findTradesForWeeklyWindow(userId, startDate, endDate) {
  return Trade.find({
    user: userId,
    marketType: "Forex",
    createdAt: { $gte: startDate, $lt: endDate },
  })
    .sort({ createdAt: 1 })
    .select(WEEKLY_TRADE_PROJECTION)
    .lean();
}

module.exports = {
  createTrade,
  deleteForexTradeByUser,
  findForexTradeByUser,
  findForexTradesByUser,
  findTradeByIdAndUser,
  findTradesForWeeklyWindow,
  updateForexTradeByUser,
  updateTradeById,
};
