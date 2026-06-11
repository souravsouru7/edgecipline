const IndianTrade = require("../models/IndianTrade");

const WEEKLY_INDIAN_TRADE_PROJECTION = [
  "pair",
  "profit",
  "brokerage",
  "sttTaxes",
  "strategy",
  "session",
  "setupScore",
  "entryBasis",
  "mistakeTag",
  "createdAt",
  "tradeDate",
].join(" ");

async function findIndianTradesForWeeklyWindow(userId, startDate, endDate) {
  return IndianTrade.find({
    user: userId,
    deletedAt: null,
    $or: [
      { tradeDate: { $gte: startDate, $lt: endDate } },
      { tradeDate: null, createdAt: { $gte: startDate, $lt: endDate } },
    ],
  })
    .sort({ tradeDate: 1, createdAt: 1 })
    .select(WEEKLY_INDIAN_TRADE_PROJECTION)
    .lean();
}

module.exports = {
  findIndianTradesForWeeklyWindow,
};
