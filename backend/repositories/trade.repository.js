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

async function findForexTradesByUser(userId, { page, limit, dateFrom } = {}) {
  const query = { user: userId, marketType: "Forex", "parsedData.multiTradeGhost": { $ne: true }, deletedAt: null };

  if (dateFrom instanceof Date) {
    query.$or = [
      { tradeDate: { $gte: dateFrom } },
      { tradeDate: null, createdAt: { $gte: dateFrom } },
    ];
  }

  const [cursor, debugCounts] = await Promise.all([
    Trade.find(query).sort({ createdAt: -1 }).select(TRADE_LIST_PROJECTION).lean()
      .then(rows => typeof page === "number" && typeof limit === "number"
        ? rows.slice((page - 1) * limit, page * limit)
        : rows),
    Promise.all([
      Trade.countDocuments({ user: userId }),
      Trade.countDocuments({ user: userId, marketType: "Forex" }),
      Trade.countDocuments({ user: userId, marketType: "Forex", deletedAt: null }),
      Trade.countDocuments({ user: userId, marketType: "Forex", deletedAt: null, "parsedData.multiTradeGhost": { $ne: true } }),
      Trade.distinct("marketType", { user: userId }),
    ]),
  ]);

  const [total, forexOnly, forexNotDeleted, forexVisible, marketTypes] = debugCounts;
  if (forexVisible === 0 && total > 0) {
    console.warn(`[TradeRepo] User ${userId} has ${total} trades but 0 visible in journal. Breakdown: forex=${forexOnly}, notDeleted=${forexNotDeleted}, notGhost=${forexVisible}. MarketTypes: ${JSON.stringify(marketTypes)}`);
  }

  return cursor;
}

async function countTradesDebug(userId) {
  const [total, forexOnly, forexNotDeleted, forexVisible, marketTypes, ghostCount, deletedCount] = await Promise.all([
    Trade.countDocuments({ user: userId }),
    Trade.countDocuments({ user: userId, marketType: "Forex" }),
    Trade.countDocuments({ user: userId, marketType: "Forex", deletedAt: null }),
    Trade.countDocuments({ user: userId, marketType: "Forex", deletedAt: null, "parsedData.multiTradeGhost": { $ne: true } }),
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
    marketType: "Forex",
    deletedAt: null,
  }).lean();
}

async function updateForexTradeByUser(tradeId, userId, update, options = {}) {
  return Trade.findOneAndUpdate(
    { _id: tradeId, user: userId, marketType: "Forex", deletedAt: null },
    update,
    { returnDocument: "after", lean: true, ...options }
  );
}

async function deleteForexTradeByUser(tradeId, userId) {
  return Trade.findOneAndUpdate(
    { _id: tradeId, user: userId, marketType: "Forex", deletedAt: null },
    { $set: { deletedAt: new Date() } },
    { returnDocument: "after" }
  );
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
  deleteForexTradeByUser,
  findForexTradeByUser,
  findForexTradesByUser,
  findTradeByIdAndUser,
  findTradesForWeeklyWindow,
  updateForexTradeByUser,
  updateTradeById,
};
