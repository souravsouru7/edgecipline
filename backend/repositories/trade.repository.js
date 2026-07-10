const mongoose = require("mongoose");
const Trade = require("../models/Trade");
const tradeLifecycleService = require("../services/tradeLifecycle.service");
const { pickForexTradeFields } = require("../utils/tradeFieldAllowlist");

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
  "effectiveTradeDate",
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
  "stopLoss",
  "takeProfit",
  "profit",
  "commission",
  "swap",
  "balance",
  "strategy",
  "session",
  "riskRewardRatio",
  "riskRewardCustom",
  "notes",
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
  // Psychology fields
  "mood",
  "confidence",
  "emotionalTags",
  "mistakeTag",
  "lesson",
  "wouldRetake",
  "entryBasis",
  "entryBasisCustom",
  "setupRules",
  "setupScore",
  "tradeQuality",
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
  "tradeQuality",
  "mood",
  "confidence",
  "emotionalTags",
  "wouldRetake",
  "createdAt",
  "tradeDate",
].join(" ");

async function createTrade(data) {
  const tradeDate = data.tradeDate || data.createdAt || new Date();
  return Trade.create({ ...data, effectiveTradeDate: tradeDate });
}

async function createTrades(data) {
  const docs = data.map((trade) => ({
    ...trade,
    effectiveTradeDate: trade.tradeDate || trade.createdAt || new Date(),
  }));
  return Trade.insertMany(docs, { ordered: true });
}

function userMatch(userId) {
  const id = userId?.toString?.() || String(userId || "");
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new TypeError("A valid user ObjectId is required");
  }
  return new mongoose.Types.ObjectId(id);
}

function visibleForexQuery(userId, extra = {}) {
  return {
    user: userMatch(userId),
    marketType: { $ne: "Indian_Market" },
    "parsedData.multiTradeGhost": { $ne: true },
    deletedAt: null,
    status: { $nin: ["pending", "processing", "failed"] },
    ...extra,
  };
}

async function findForexTradesByUser(userId, { page, limit, dateFrom } = {}) {
  const query = visibleForexQuery(userId);

  if (dateFrom instanceof Date) {
    query.effectiveTradeDate = { $gte: dateFrom };
  }

  const hasPagination = typeof page === "number" && typeof limit === "number";
  const tradeQuery = Trade.find(query)
    .sort({ effectiveTradeDate: -1, _id: -1 });

  if (hasPagination) {
    tradeQuery
      .skip(Math.max(0, (page - 1) * limit))
      .limit(limit);
  }

  return tradeQuery
    .select(TRADE_LIST_PROJECTION)
    .lean();
}

async function countForexTradesByUser(userId, { dateFrom } = {}) {
  const query = visibleForexQuery(userId);
  if (dateFrom instanceof Date) {
    query.effectiveTradeDate = { $gte: dateFrom };
  }
  return Trade.countDocuments(query);
}

async function countTradesDebug(userId) {
  const visibleQuery = visibleForexQuery(userId);
  const [total, forexOnly, forexNotDeleted, forexVisible, marketTypes, ghostCount, deletedCount] = await Promise.all([
    Trade.countDocuments({ user: userId }),
    Trade.countDocuments({ user: userId, marketType: "Forex" }),
    Trade.countDocuments({ user: userId, marketType: "Forex", deletedAt: null }),
    Trade.countDocuments(visibleQuery),
    Trade.distinct("marketType", { user: userId }),
    Trade.countDocuments({ user: userId, "parsedData.multiTradeGhost": true }),
    Trade.countDocuments({ user: userId, deletedAt: { $ne: null } }),
  ]);
  return { total, forexOnly, forexNotDeleted, forexVisible, marketTypes, ghostCount, deletedCount };
}

async function findForexTradeByUser(tradeId, userId) {
  return Trade.findOne({
    _id: tradeId,
    user: userId,
    marketType: { $ne: "Indian_Market" },
    deletedAt: null,
  }).lean();
}

async function updateForexTradeByUser(tradeId, userId, update, options = {}) {
  const safeUpdate = pickForexTradeFields(update);
  const { derivedProfit, ...mongooseOptions } = options;
  if (derivedProfit !== undefined) {
    safeUpdate.profit = derivedProfit;
  }
  return Trade.findOneAndUpdate(
    { _id: tradeId, user: userId, marketType: { $ne: "Indian_Market" }, deletedAt: null },
    safeUpdate,
    { returnDocument: "after", lean: true, runValidators: true, ...mongooseOptions }
  );
}

async function deleteForexTradeByUser(tradeId, userId) {
  return tradeLifecycleService.softDeleteTrade(Trade, {
    tradeId,
    userId,
    deletedBy: userId,
    deletedSource: "user",
    marketFilter: { marketType: { $ne: "Indian_Market" } },
  });
}

async function findTradeByIdAndUser(tradeId, userId) {
  return Trade.findOne({ _id: tradeId, user: userId, deletedAt: null })
    .select(TRADE_STATUS_PROJECTION)
    .lean();
}

async function findTradesForWeeklyWindow(userId, startDate, endDate) {
  return Trade.find({
    user: userId,
    marketType: "Forex",
    deletedAt: null,
    "parsedData.multiTradeGhost": { $ne: true },
    status: { $ne: "failed" },
    $or: [
      { tradeDate: { $gte: startDate, $lte: endDate } },
      { tradeDate: null, createdAt: { $gte: startDate, $lte: endDate } },
    ],
  })
    .sort({ tradeDate: 1, createdAt: 1 })
    .select(WEEKLY_TRADE_PROJECTION)
    .lean();
}

module.exports = {
  countForexTradesByUser,
  countTradesDebug,
  createTrade,
  createTrades,
  deleteForexTradeByUser,
  findForexTradeByUser,
  findForexTradesByUser,
  findTradeByIdAndUser,
  findTradesForWeeklyWindow,
  updateForexTradeByUser,
};
