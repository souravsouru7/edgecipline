const mongoose = require("mongoose");
const Trade = require("../models/Trade");
const tradeLifecycleService = require("../services/tradeLifecycle.service");

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

const TRADE_LIST_PROJECT_STAGE = TRADE_LIST_PROJECTION
  .split(" ")
  .reduce((projection, field) => ({ ...projection, [field]: 1 }), { _id: 1 });

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
  return Trade.create(data);
}

async function createTrades(data) {
  return Trade.insertMany(data, { ordered: true });
}

function userMatch(userId) {
  const id = userId?.toString?.() || String(userId || "");
  if (mongoose.Types.ObjectId.isValid(id)) {
    return { $in: [new mongoose.Types.ObjectId(id), id] };
  }
  return userId;
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
    query.$or = [
      { tradeDate: { $gte: dateFrom } },
      { tradeDate: null, createdAt: { $gte: dateFrom } },
    ];
  }

  const hasPagination = typeof page === "number" && typeof limit === "number";
  const tradeQuery = hasPagination
    ? Trade.aggregate([
        { $match: query },
        { $addFields: { effectiveTradeDate: { $ifNull: ["$tradeDate", "$createdAt"] } } },
        { $sort: { effectiveTradeDate: -1, _id: -1 } },
        { $skip: Math.max(0, (page - 1) * limit) },
        { $limit: limit },
        { $project: TRADE_LIST_PROJECT_STAGE },
      ])
    : Trade.find(query)
        .sort({ createdAt: -1, _id: -1 })
        .select(TRADE_LIST_PROJECTION)
        .lean();

  return tradeQuery;
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
  return Trade.findOneAndUpdate(
    { _id: tradeId, user: userId, marketType: { $ne: "Indian_Market" }, deletedAt: null },
    update,
    { returnDocument: "after", lean: true, ...options }
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

async function updateTradeById(tradeId, update, options = {}) {
  return Trade.findByIdAndUpdate(tradeId, update, { returnDocument: "after", ...options });
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
  countTradesDebug,
  createTrade,
  createTrades,
  deleteForexTradeByUser,
  findForexTradeByUser,
  findForexTradesByUser,
  findTradeByIdAndUser,
  findTradesForWeeklyWindow,
  updateForexTradeByUser,
  updateTradeById,
};
