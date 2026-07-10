const TradingDnaReport = require("../models/TradingDnaReport");

function dayKey(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

async function upsertReport({
  userId,
  marketType,
  periodType,
  windowStart,
  windowEnd,
  bundle,
  ai,
  aiModel,
  promptVersion,
  dataVersion = "",
}) {
  const start = dayKey(windowStart);
  const end = dayKey(windowEnd);
  return TradingDnaReport.findOneAndUpdate(
    { user: userId, marketType, periodType, windowStart: start, windowEnd: end },
    {
      $setOnInsert: {
        user: userId,
        marketType,
        periodType,
        windowStart: start,
        windowEnd: end,
      },
      $set: { bundle, ai, aiModel, promptVersion, dataVersion },
    },
    { returnDocument: "after", upsert: true }
  );
}

async function findLatest(userId, marketType, periodType) {
  return TradingDnaReport.findOne({ user: userId, marketType, periodType })
    .sort({ createdAt: -1 })
    .lean();
}

async function findByIdAndUser(reportId, userId) {
  return TradingDnaReport.findOne({ _id: reportId, user: userId }).lean();
}

async function listReports(userId, marketType, limit = 12) {
  return TradingDnaReport.find({ user: userId, marketType })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

async function findRecentlyGenerated(userId, marketType, periodType, since) {
  return TradingDnaReport.findOne({
    user: userId,
    marketType,
    periodType,
    aiModel: { $nin: ["", "fallback", "no-data"] },
    createdAt: { $gte: since },
  })
    .sort({ createdAt: -1 })
    .select("_id user marketType periodType aiModel createdAt");
}

module.exports = {
  findByIdAndUser,
  findLatest,
  findRecentlyGenerated,
  listReports,
  upsertReport,
};
