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

function escapeRegex(value) {
  // Escapes every non-alphanumeric character, so a symbol a trader types
  // ("EUR/USD", "GBP+") can never act as a regex operator.
  return String(value)
    .split("")
    .map((ch) => (/[A-Za-z0-9]/.test(ch) ? ch : "\\" + ch))
    .join("");
}

// Only an unambiguous ISO day counts as a date search. "10/08" could be either
// order depending on the reader's locale, and guessing wrong silently returns
// the wrong month of trades.
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseSearchDay(term) {
  if (!ISO_DAY.test(term)) return null;
  const day = new Date(`${term}T00:00:00.000Z`);
  return Number.isNaN(day.getTime()) ? null : day;
}

/**
 * The one place the trade log's filters turn into a query. Period, direction
 * and search all narrow the same base query, so the list, the count and the
 * header totals can never be computed over different sets of trades.
 */
function buildForexListQuery(userId, { dateFrom, direction, search } = {}) {
  const query = visibleForexQuery(userId);
  const range = {};
  if (dateFrom instanceof Date) range.$gte = dateFrom;

  if (direction === "LONG") query.type = "BUY";
  else if (direction === "SHORT") query.type = "SELL";

  const term = String(search || "").trim();
  if (term) {
    const day = parseSearchDay(term);
    if (day) {
      // The period filter still applies: searching a day outside the selected
      // period correctly returns nothing rather than silently widening it.
      const next = new Date(day.getTime() + 24 * 60 * 60 * 1000);
      range.$gte = range.$gte && range.$gte > day ? range.$gte : day;
      range.$lt = next;
    } else {
      // Anchored so the index on `pair` bounds the scan. Case-insensitive
      // because older rows were stored however the broker spelled them, and
      // the match is already confined to one user's trades.
      query.pair = { $regex: `^${escapeRegex(term)}`, $options: "i" };
    }
  }

  if (Object.keys(range).length) query.effectiveTradeDate = range;
  return query;
}

async function findForexTradesByUser(userId, { page, limit, dateFrom, direction, search } = {}) {
  const query = buildForexListQuery(userId, { dateFrom, direction, search });

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

/**
 * Keyset page of the trade log. Unlike skip/limit this costs the same at row
 * 10,000 as at row 0, because the index seeks straight to the cursor instead
 * of walking and discarding everything before it. It is also stable while the
 * user adds or deletes trades mid-scroll, where an offset would duplicate or
 * skip a row.
 *
 * The sort key is (effectiveTradeDate, _id). The date alone is not unique, so
 * _id breaks ties and keeps the cursor from stalling on same-day trades.
 */
async function findForexTradePage(userId, { limit = 50, dateFrom, direction, search, cursor } = {}) {
  const query = buildForexListQuery(userId, { dateFrom, direction, search });
  const size = Math.max(1, Math.min(Number(limit) || 50, 200));

  if (cursor?.date && cursor?.id && mongoose.Types.ObjectId.isValid(cursor.id)) {
    const at = new Date(cursor.date);
    if (!Number.isNaN(at.getTime())) {
      // Kept in $and so it composes with the period/search range already on
      // effectiveTradeDate instead of overwriting it.
      query.$and = [
        ...(query.$and || []),
        {
          $or: [
            { effectiveTradeDate: { $lt: at } },
            { effectiveTradeDate: at, _id: { $lt: new mongoose.Types.ObjectId(cursor.id) } },
          ],
        },
      ];
    }
  }

  // One extra row answers "is there another page" without a second query.
  const rows = await Trade.find(query)
    .sort({ effectiveTradeDate: -1, _id: -1 })
    .limit(size + 1)
    .select(TRADE_LIST_PROJECTION)
    .lean();

  const hasMore = rows.length > size;
  const items = hasMore ? rows.slice(0, size) : rows;
  const last = items[items.length - 1];

  return {
    items,
    hasMore,
    nextCursor: hasMore && last
      ? { date: new Date(last.effectiveTradeDate).toISOString(), id: String(last._id) }
      : null,
  };
}

async function countForexTradesByUser(userId, { dateFrom, direction, search } = {}) {
  return Trade.countDocuments(buildForexListQuery(userId, { dateFrom, direction, search }));
}

/**
 * Totals over EVERY visible trade in the window, not just one page. The trade
 * log's header boxes used to be summed on the client from the rows it had
 * loaded, so a user with 53 trades saw the numbers for the first 50 and a
 * different figure from the dashboard, which asks the server. One aggregate
 * beside the count keeps the two screens on the same maths.
 */
async function summarizeForexTradesByUser(userId, { dateFrom, direction, search } = {}) {
  const query = buildForexListQuery(userId, { dateFrom, direction, search });
  const [row] = await Trade.aggregate([
    { $match: query },
    {
      $group: {
        _id: null,
        totalTrades: { $sum: 1 },
        grossPnL: { $sum: { $ifNull: ["$profit", 0] } },
        wins: { $sum: { $cond: [{ $gt: [{ $ifNull: ["$profit", 0] }, 0] }, 1, 0] } },
        losses: { $sum: { $cond: [{ $lt: [{ $ifNull: ["$profit", 0] }, 0] }, 1, 0] } },
      },
    },
  ]);
  const totalTrades = row?.totalTrades ?? 0;
  const wins = row?.wins ?? 0;
  return {
    totalTrades,
    wins,
    losses: row?.losses ?? 0,
    grossPnL: Math.round((row?.grossPnL ?? 0) * 100) / 100,
    winRate: totalTrades ? Math.round((wins / totalTrades) * 1000) / 10 : 0,
  };
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
  buildForexListQuery,
  findForexTradePage,
  findForexTradesByUser,
  findTradeByIdAndUser,
  findTradesForWeeklyWindow,
  summarizeForexTradesByUser,
  updateForexTradeByUser,
};
