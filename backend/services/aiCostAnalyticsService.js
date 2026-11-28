"use strict";

const AiUsage = require("../models/AiUsage");
const User = require("../models/Users");
const { PRICING_VERSION, usdToInr } = require("../config/aiPricing");

// AI cost analytics for the admin dashboard.
//
// Every figure here is computed from our own AiUsage rows: provider token
// counts x the price table in config/aiPricing. That is NOT Google's invoice.
// Each total is split by costSource so the dashboard can say which part is
// metered (provider usage numbers), estimated (no usage numbers, e.g. an
// aborted hedge request), unit-priced (Cloud Vision), or legacy (rows written
// before cost tracking, which carry tokens but no cost).

const EXTRACTION_FEATURES = ["trade_vision", "trade_text", "trade_text_openai", "ocr_vision"];
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 180;

function parseRange({ from, to } = {}, now = new Date()) {
  const end = to ? new Date(to) : now;
  const validEnd = Number.isNaN(end.getTime()) ? now : end;
  // A bare date for `to` means "through the end of that day".
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(String(to))) validEnd.setUTCHours(23, 59, 59, 999);
  const start = from ? new Date(from) : new Date(validEnd.getTime() - 30 * DAY_MS);
  let validStart = Number.isNaN(start.getTime()) ? new Date(validEnd.getTime() - 30 * DAY_MS) : start;
  if (validEnd - validStart > MAX_RANGE_DAYS * DAY_MS) validStart = new Date(validEnd.getTime() - MAX_RANGE_DAYS * DAY_MS);
  if (validStart > validEnd) validStart = new Date(validEnd.getTime() - DAY_MS);
  return { start: validStart, end: validEnd };
}

const COST_SOURCE = { $ifNull: ["$costSource", "legacy"] };
const sumIf = (source) => ({ $sum: { $cond: [{ $eq: [COST_SOURCE, source] }, { $ifNull: ["$costUsd", 0] }, 0] } });

// The common totals block, reused by every grouping.
const TOTALS = {
  requests: { $sum: 1 },
  costUsd: { $sum: { $ifNull: ["$costUsd", 0] } },
  meteredUsd: sumIf("metered"),
  estimatedUsd: sumIf("estimated"),
  unitUsd: sumIf("unit"),
  legacyRows: { $sum: { $cond: [{ $eq: [COST_SOURCE, "legacy"] }, 1, 0] } },
  // An aborted hedge loser is not a failure the trader saw.
  failures: { $sum: { $cond: [{ $and: [{ $eq: ["$ok", false] }, { $ne: ["$aborted", true] }] }, 1, 0] } },
  retries: { $sum: { $cond: [{ $gt: [{ $ifNull: ["$attempt", 1] }, 1] }, 1, 0] } },
  hedgedAborted: { $sum: { $cond: [{ $eq: ["$aborted", true] }, 1, 0] } },
  inputTokens: { $sum: "$inputTokens" },
  outputTokens: { $sum: "$outputTokens" },
  thinkingTokens: { $sum: "$thinkingTokens" },
  cachedTokens: { $sum: { $ifNull: ["$cachedTokens", 0] } },
};

function shape(row = {}) {
  const inr = usdToInr();
  const requests = row.requests || 0;
  const costUsd = row.costUsd || 0;
  return {
    requests,
    costUsd,
    costInr: costUsd * inr,
    meteredUsd: row.meteredUsd || 0,
    estimatedUsd: row.estimatedUsd || 0,
    unitUsd: row.unitUsd || 0,
    legacyRows: row.legacyRows || 0,
    failures: row.failures || 0,
    retries: row.retries || 0,
    hedgedAborted: row.hedgedAborted || 0,
    inputTokens: row.inputTokens || 0,
    outputTokens: row.outputTokens || 0,
    thinkingTokens: row.thinkingTokens || 0,
    cachedTokens: row.cachedTokens || 0,
    avgCostPerRequestUsd: requests ? costUsd / requests : 0,
  };
}

function payingUserFilter(now = new Date()) {
  return {
    role: { $ne: "admin" },
    $or: [
      {
        subscriptionStatus: "active",
        subscriptionPlan: { $nin: [null, "", "free"] },
        $or: [{ subscriptionExpiry: null }, { subscriptionExpiry: { $gte: now } }],
      },
      { playEntitlementExpiry: { $gt: now } },
      { appStoreEntitlementExpiry: { $gt: now } },
    ],
  };
}

async function totalsFor(match) {
  const [row] = await AiUsage.aggregate([{ $match: match }, { $group: { _id: null, ...TOTALS } }]);
  return shape(row);
}

// Average cost of one user operation (an upload, a Coach reply), summing all
// its requests. Only rows that carry an operationId can be grouped.
async function perOperation(match, features) {
  const [row] = await AiUsage.aggregate([
    { $match: { ...match, feature: { $in: features }, operationId: { $gt: "" } } },
    { $group: { _id: "$operationId", costUsd: { $sum: { $ifNull: ["$costUsd", 0] } }, requests: { $sum: 1 } } },
    { $group: { _id: null, operations: { $sum: 1 }, costUsd: { $sum: "$costUsd" }, requests: { $sum: "$requests" } } },
  ]);
  const operations = row?.operations || 0;
  return {
    operations,
    avgCostUsd: operations ? row.costUsd / operations : 0,
    avgRequestsPerOperation: operations ? row.requests / operations : 0,
  };
}

async function getCostAnalytics({ from, to, feature } = {}, now = new Date()) {
  const { start, end } = parseRange({ from, to }, now);
  const featureMatch = feature ? { feature: String(feature) } : {};
  const match = { createdAt: { $gte: start, $lte: end }, ...featureMatch };

  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const payingFilter = payingUserFilter(now);
  const payingIds = await User.find(payingFilter, { _id: 1 }).lean().then((rows) => rows.map((r) => r._id));

  const [
    totals, today, monthToDate, byFeature, byModel, daily, monthly,
    activeUsers, payerCost, extraction, coach, topUsers,
  ] = await Promise.all([
    totalsFor(match),
    totalsFor({ createdAt: { $gte: todayStart, $lte: now }, ...featureMatch }),
    totalsFor({ createdAt: { $gte: monthStart, $lte: now }, ...featureMatch }),
    AiUsage.aggregate([{ $match: match }, { $group: { _id: "$feature", ...TOTALS } }, { $sort: { costUsd: -1 } }]),
    AiUsage.aggregate([
      { $match: match },
      { $group: { _id: { $cond: [{ $gt: [{ $ifNull: ["$servedModel", ""] }, ""] }, "$servedModel", "$model"] }, ...TOTALS } },
      { $sort: { costUsd: -1 } },
    ]),
    AiUsage.aggregate([
      { $match: match },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, ...TOTALS } },
      { $sort: { _id: 1 } },
    ]),
    AiUsage.aggregate([
      { $match: match },
      { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } }, ...TOTALS } },
      { $sort: { _id: 1 } },
    ]),
    AiUsage.distinct("user", { ...match, user: { $ne: null } }).then((ids) => ids.length),
    payingIds.length
      ? totalsFor({ ...match, user: { $in: payingIds } })
      : Promise.resolve(shape()),
    perOperation({ createdAt: { $gte: start, $lte: end } }, EXTRACTION_FEATURES),
    perOperation({ createdAt: { $gte: start, $lte: end } }, ["coach"]),
    AiUsage.aggregate([
      { $match: { ...match, user: { $ne: null } } },
      { $group: { _id: "$user", requests: { $sum: 1 }, costUsd: { $sum: { $ifNull: ["$costUsd", 0] } }, totalTokens: { $sum: "$totalTokens" } } },
      { $sort: { costUsd: -1, totalTokens: -1 } },
      { $limit: 20 },
      { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "u" } },
      { $project: { _id: 0, userId: "$_id", email: { $arrayElemAt: ["$u.email", 0] }, requests: 1, costUsd: 1, totalTokens: 1 } },
    ]),
  ]);

  const payingSubscribers = payingIds.length;
  return {
    range: { from: start.toISOString(), to: end.toISOString(), feature: feature || null },
    pricingVersion: PRICING_VERSION,
    usdToInr: usdToInr(),
    note:
      "Costs are calculated from provider token counts x the price table (config/aiPricing.js), not read from Google's invoice. " +
      "'Estimated' rows had no provider usage numbers (e.g. aborted hedge requests). 'Legacy' rows predate cost tracking and are not priced.",
    today,
    monthToDate,
    totals,
    activeUsers,
    avgCostPerActiveUserUsd: activeUsers ? totals.costUsd / activeUsers : 0,
    payingSubscribers,
    payingSubscriberCostUsd: payerCost.costUsd,
    avgCostPerPayingSubscriberUsd: payingSubscribers ? payerCost.costUsd / payingSubscribers : 0,
    extraction,
    coach,
    byFeature: byFeature.map((r) => ({ feature: r._id, ...shape(r) })),
    byModel: byModel.map((r) => ({ model: r._id || "(unknown)", ...shape(r) })),
    daily: daily.map((r) => ({ day: r._id, ...shape(r) })),
    monthly: monthly.map((r) => ({ month: r._id, ...shape(r) })),
    topUsers,
  };
}

module.exports = { EXTRACTION_FEATURES, getCostAnalytics, parseRange, payingUserFilter, shape };
