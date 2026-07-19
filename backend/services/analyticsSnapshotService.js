"use strict";

const Trade = require("../models/Trade");
const IndianTrade = require("../models/IndianTrade");
const { buildCacheKey, rememberCache } = require("../utils/cache");
const { getTradeCacheVersion } = require("../utils/cacheUtils");
const { computePatternDetection } = require("../utils/patternDetection");
const { computePsychologyCost } = require("../utils/psychologyCost");
const { computeSelfAwarenessAnalytics } = require("../utils/tradeEvaluation");
const { computeTradingDNA, enrichTradingDNAWithPatterns } = require("../utils/tradingDNA");
const { computeDisciplineAnalytics } = require("../utils/disciplineAnalytics");
const { computePsychologyTimeline } = require("../utils/psychologyTimeline");
const {
  calculatePerformanceMetrics,
  finalizePerformance,
  mergePerformanceMetrics,
} = require("../utils/metricEngine");
const { appConfig } = require("../config");
const { logger } = require("../utils/logger");

const SNAPSHOT_CACHE_TTL_SECONDS = Number(process.env.ANALYTICS_SNAPSHOT_TTL_SECONDS || 600);
// Bound CPU, memory, and response construction even if an unsafe environment
// override is supplied. The newest trades are retained when the cap is hit.
const SNAPSHOT_LIMIT = Math.min(
  10000,
  Math.max(100, Number(process.env.ANALYTICS_SNAPSHOT_LIMIT) || 10000)
);
const AGGREGATE_CACHE_TTL_SECONDS = Number(process.env.ANALYTICS_AGGREGATE_TTL_SECONDS || 300);
const SLOW_AGGREGATE_MS = Number(process.env.SLOW_ANALYTICS_AGGREGATE_MS || 750);

const SNAPSHOT_TRADE_PROJECTION = [
  "profit",
  "commission",
  "swap",
  "brokerage",
  "sttTaxes",
  "entryPrice",
  "exitPrice",
  "stopLoss",
  "takeProfit",
  "riskRewardRatio",
  "riskRewardCustom",
  "quantity",
  "lotSize",
  "pair",
  "type",
  "session",
  "strategy",
  "tradeDate",
  "effectiveTradeDate",
  "createdAt",
  "segment",
  "instrumentType",
  "optionType",
  "tradeType",
  "stockSymbol",
  "mood",
  "confidence",
  "emotionalTags",
  "mistakeTag",
  "setupScore",
  "setupRules",
  "entryBasis",
  "wouldRetake",
  "tradeQuality",
  // status is only set on the Forex Trade collection (enum: pending /
  // processing / completed / failed). Indian trades have no status field.
  // Including it here is additive — older consumers that don't read it are
  // unaffected, and consumers that DO care (Trading DNA) can filter
  // pending/processing/failed entries out of analytics.
  "status",
].join(" ");

function computePerformanceMetrics(trades, marketLabel) {
  return calculatePerformanceMetrics(trades, marketLabel);
}

function hasRecordedProfit(trade = {}) {
  if (trade.profit == null || trade.profit === "") return false;
  return Number.isFinite(Number(trade.profit));
}

function withPnlReadiness(performance, totalTrades, pnlReadyTrades) {
  const readyCount = Number(pnlReadyTrades) || 0;
  const totalCount = Number(totalTrades) || 0;
  return {
    ...performance,
    totalTrades: totalCount,
    pnlReadyTrades: readyCount,
    tradesMissingPnl: Math.max(0, totalCount - readyCount),
    analyticsTradeCount: readyCount,
  };
}

function buildDateQuery(dateRange) {
  if (!dateRange?.from && !dateRange?.to) return {};
  const range = {};
  if (dateRange.from) range.$gte = dateRange.from;
  if (dateRange.to) range.$lte = dateRange.to;
  return { effectiveTradeDate: range };
}

function buildMatchQuery({ userId, market, instrumentType, dateRange }) {
  const marketLabel = resolveMarketLabel(market);
  const dateQuery = buildDateQuery(dateRange);

  if (marketLabel === "Indian_Market") {
    const query = { user: userId, deletedAt: null, ...dateQuery };
    if (instrumentType) query.instrumentType = String(instrumentType).toUpperCase();
    return query;
  }

  return {
    user: userId,
    marketType: { $ne: "Indian_Market" },
    deletedAt: null,
    "parsedData.multiTradeGhost": { $ne: true },
    ...dateQuery,
  };
}

function getTradeModel(marketLabel) {
  return marketLabel === "Indian_Market" ? IndianTrade : Trade;
}

function getFeeExpression(marketLabel) {
  return marketLabel === "Indian_Market"
    ? { $add: [{ $ifNull: ["$brokerage", 0] }, { $ifNull: ["$sttTaxes", 0] }] }
    : { $add: [{ $ifNull: ["$commission", 0] }, { $ifNull: ["$swap", 0] }] };
}

function getPeriodUnit(period) {
  if (period === "daily") return "day";
  if (period === "monthly") return "month";
  return "week";
}

function logSlowAggregate(scope, details) {
  if (details.generationMs < SLOW_AGGREGATE_MS) return;
  logger.warn("Slow analytics aggregation", {
    scope,
    thresholdMs: SLOW_AGGREGATE_MS,
    ...details,
  });
}

function normalizeDateValue(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function resolveMarketLabel(market) {
  const raw = String(market || "").trim();
  if (raw === "Indian_Market" || raw.toLowerCase() === "indian") return "Indian_Market";
  if (raw.toLowerCase() === "combined") return "combined";
  return "Forex";
}

function getSnapshotCacheKey({ userId, marketLabel, instrumentType, dateRange, period, version }) {
  return buildCacheKey(
    "analytics_snapshot",
    userId?.toString?.() || userId,
    marketLabel,
    instrumentType || "all",
    normalizeDateValue(dateRange?.from) || "start",
    normalizeDateValue(dateRange?.to) || "end",
    period || "default",
    `v${version}`
  );
}

async function loadTrades({ userId, market, instrumentType, dateRange }) {
  const marketLabel = resolveMarketLabel(market);

  if (marketLabel === "combined") {
    const [forexTrades, indianTrades] = await Promise.all([
      loadTrades({ userId, market: "Forex", dateRange }),
      loadTrades({ userId, market: "Indian_Market", instrumentType, dateRange }),
    ]);
    return [...forexTrades, ...indianTrades]
      .sort((a, b) => {
        const left = new Date(a.effectiveTradeDate || a.tradeDate || a.createdAt || 0).getTime();
        const right = new Date(b.effectiveTradeDate || b.tradeDate || b.createdAt || 0).getTime();
        return left - right;
      })
      .slice(-SNAPSHOT_LIMIT);
  }

  if (marketLabel === "Indian_Market") {
    const query = buildMatchQuery({ userId, market: marketLabel, instrumentType, dateRange });

    const trades = await IndianTrade.find(query)
      .sort({ effectiveTradeDate: -1, _id: -1 })
      .select(SNAPSHOT_TRADE_PROJECTION)
      .lean()
      .limit(SNAPSHOT_LIMIT);
    return trades.reverse();
  }

  const trades = await Trade.find(buildMatchQuery({ userId, market: marketLabel, dateRange }))
    .sort({ effectiveTradeDate: -1, _id: -1 })
    .select(SNAPSHOT_TRADE_PROJECTION)
    .lean()
    .limit(SNAPSHOT_LIMIT);
  return trades.reverse();
}

async function aggregatePerformance({ userId, market = "Forex", instrumentType, dateRange } = {}) {
  const marketLabel = resolveMarketLabel(market);
  if (marketLabel === "combined") {
    const [forex, indian] = await Promise.all([
      aggregatePerformance({ userId, market: "Forex", dateRange }),
      aggregatePerformance({ userId, market: "Indian_Market", instrumentType, dateRange }),
    ]);
    return {
      ...mergePerformanceMetrics([forex, indian]),
      avgSetupScore: null,
    };
  }

  const Model = getTradeModel(marketLabel);
  const feeExpression = getFeeExpression(marketLabel);
  const [result = {}] = await Model.aggregate([
    { $match: buildMatchQuery({ userId, market: marketLabel, instrumentType, dateRange }) },
    {
      $project: {
        hasProfit: {
          $and: [
            { $ne: [{ $type: "$profit" }, "missing"] },
            { $ne: ["$profit", null] },
          ],
        },
        profit: { $ifNull: ["$profit", 0] },
        fee: feeExpression,
        setupScore: 1,
      },
    },
    {
      $group: {
        _id: null,
        totalTrades: { $sum: 1 },
        pnlReadyTrades: { $sum: { $cond: ["$hasProfit", 1, 0] } },
        wins: { $sum: { $cond: [{ $and: ["$hasProfit", { $gt: ["$profit", 0] }] }, 1, 0] } },
        losses: { $sum: { $cond: [{ $and: ["$hasProfit", { $lt: ["$profit", 0] }] }, 1, 0] } },
        breakEven: { $sum: { $cond: [{ $and: ["$hasProfit", { $eq: ["$profit", 0] }] }, 1, 0] } },
        grossPnL: { $sum: { $cond: ["$hasProfit", "$profit", 0] } },
        fees: { $sum: { $cond: ["$hasProfit", "$fee", 0] } },
        netPnL: { $sum: { $cond: ["$hasProfit", { $subtract: ["$profit", "$fee"] }, 0] } },
        totalVolume: { $sum: { $cond: ["$hasProfit", { $abs: "$profit" }, 0] } },
        totalWinPnL: { $sum: { $cond: [{ $and: ["$hasProfit", { $gt: ["$profit", 0] }] }, "$profit", 0] } },
        totalLossPnL: { $sum: { $cond: [{ $and: ["$hasProfit", { $lt: ["$profit", 0] }] }, "$profit", 0] } },
        avgSetupScore: { $avg: "$setupScore" },
      },
    },
  ]);

  return {
    ...withPnlReadiness(finalizePerformance({
      totalTrades: result.pnlReadyTrades || 0,
      wins: result.wins || 0,
      losses: result.losses || 0,
      breakEven: result.breakEven || 0,
      grossPnL: result.grossPnL || 0,
      fees: result.fees || 0,
      netPnL: result.netPnL || 0,
      totalVolume: result.totalVolume || 0,
      totalWinPnL: result.totalWinPnL || 0,
      totalLossPnL: result.totalLossPnL || 0,
    }), result.totalTrades || 0, result.pnlReadyTrades || 0),
    avgSetupScore: result.avgSetupScore == null ? null : Number(result.avgSetupScore.toFixed(1)),
  };
}

async function aggregateTimeline({ userId, market = "Forex", instrumentType, dateRange, period = "weekly" } = {}) {
  const marketLabel = resolveMarketLabel(market);
  if (marketLabel === "combined") {
    const [forex, indian] = await Promise.all([
      aggregateTimeline({ userId, market: "Forex", dateRange, period }),
      aggregateTimeline({ userId, market: "Indian_Market", instrumentType, dateRange, period }),
    ]);
    return [...forex, ...indian].sort((a, b) => String(a.bucket).localeCompare(String(b.bucket)));
  }

  const Model = getTradeModel(marketLabel);
  const unit = getPeriodUnit(period);
  return Model.aggregate([
    { $match: buildMatchQuery({ userId, market: marketLabel, instrumentType, dateRange }) },
    {
      $project: {
        dateValue: { $ifNull: ["$tradeDate", "$createdAt"] },
        profit: { $ifNull: ["$profit", 0] },
        mood: 1,
        setupScore: 1,
        entryBasis: 1,
        tradeQuality: 1,
        emotionalTags: 1,
      },
    },
    {
      $addFields: {
        bucketDate: { $dateTrunc: { date: "$dateValue", unit } },
        isPlan: { $eq: ["$entryBasis", "Plan"] },
        isHealthyQuality: { $in: ["$tradeQuality", ["Great", "Average"]] },
      },
    },
    {
      $group: {
        _id: "$bucketDate",
        trades: { $sum: 1 },
        pnl: { $sum: "$profit" },
        wins: { $sum: { $cond: [{ $gt: ["$profit", 0] }, 1, 0] } },
        losses: { $sum: { $cond: [{ $lt: ["$profit", 0] }, 1, 0] } },
        avgMood: { $avg: "$mood" },
        avgSetupScore: { $avg: "$setupScore" },
        planTrades: { $sum: { $cond: ["$isPlan", 1, 0] } },
        qualityTrades: { $sum: { $cond: ["$isHealthyQuality", 1, 0] } },
      },
    },
    { $sort: { _id: 1 } },
    {
      $project: {
        _id: 0,
        bucket: "$_id",
        trades: 1,
        pnl: { $round: ["$pnl", 2] },
        wins: 1,
        losses: 1,
        winRate: { $cond: [{ $gt: ["$trades", 0] }, { $round: [{ $multiply: [{ $divide: ["$wins", "$trades"] }, 100] }, 1] }, 0] },
        avgMood: { $round: ["$avgMood", 1] },
        avgSetupScore: { $round: ["$avgSetupScore", 1] },
        planAdherencePct: { $cond: [{ $gt: ["$trades", 0] }, { $round: [{ $multiply: [{ $divide: ["$planTrades", "$trades"] }, 100] }, 1] }, 0] },
        qualityPct: { $cond: [{ $gt: ["$trades", 0] }, { $round: [{ $multiply: [{ $divide: ["$qualityTrades", "$trades"] }, 100] }, 1] }, 0] },
      },
    },
  ]);
}

async function aggregateDisciplineSummary({ userId, market = "Forex", instrumentType, dateRange } = {}) {
  const marketLabel = resolveMarketLabel(market);
  if (marketLabel === "combined") {
    const [forex, indian] = await Promise.all([
      aggregateDisciplineSummary({ userId, market: "Forex", dateRange }),
      aggregateDisciplineSummary({ userId, market: "Indian_Market", instrumentType, dateRange }),
    ]);
    return { marketType: "combined", forex, indian };
  }

  const Model = getTradeModel(marketLabel);
  const baseMatch = buildMatchQuery({ userId, market: marketLabel, instrumentType, dateRange });
  const [result = {}] = await Model.aggregate([
    { $match: baseMatch },
    {
      $facet: {
        overview: [
          {
            $group: {
              _id: null,
              totalTrades: { $sum: 1 },
              avgSetupScore: { $avg: "$setupScore" },
              planTrades: { $sum: { $cond: [{ $eq: ["$entryBasis", "Plan"] }, 1, 0] } },
              emotionTrades: { $sum: { $cond: [{ $in: ["$entryBasis", ["Emotion", "Impulsive"]] }, 1, 0] } },
            },
          },
        ],
        brokenRules: [
          { $unwind: "$setupRules" },
          { $match: { "setupRules.followed": false, "setupRules.label": { $nin: [null, ""] } } },
          { $group: { _id: "$setupRules.label", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 },
          { $project: { _id: 0, label: "$_id", count: 1 } },
        ],
        followedRules: [
          { $unwind: "$setupRules" },
          { $match: { "setupRules.followed": true, "setupRules.label": { $nin: [null, ""] } } },
          { $group: { _id: "$setupRules.label", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 },
          { $project: { _id: 0, label: "$_id", count: 1 } },
        ],
      },
    },
  ]);

  const overview = result.overview?.[0] || {};
  const totalTrades = overview.totalTrades || 0;
  return {
    marketType: marketLabel,
    totalTrades,
    avgSetupScore: overview.avgSetupScore == null ? null : Number(overview.avgSetupScore.toFixed(1)),
    planAdherencePct: totalTrades ? Number(((overview.planTrades / totalTrades) * 100).toFixed(1)) : 0,
    emotionEntryPct: totalTrades ? Number(((overview.emotionTrades / totalTrades) * 100).toFixed(1)) : 0,
    topBrokenRules: result.brokenRules || [],
    topFollowedRules: result.followedRules || [],
  };
}

function formatMonthLabel(year, month) {
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${monthNames[Math.max(0, Math.min(11, Number(month) - 1))]} ${year}`;
}

async function aggregatePnlBreakdown({ userId, market = "Forex", instrumentType, dateRange } = {}) {
  const marketLabel = resolveMarketLabel(market);
  if (marketLabel === "combined") {
    const [forex, indian] = await Promise.all([
      aggregatePnlBreakdown({ userId, market: "Forex", dateRange }),
      aggregatePnlBreakdown({ userId, market: "Indian_Market", instrumentType, dateRange }),
    ]);
    return {
      daily: [...forex.daily, ...indian.daily].sort((a, b) => a.date.localeCompare(b.date)),
      weekly: [...forex.weekly, ...indian.weekly].sort((a, b) => a.week.localeCompare(b.week)),
      monthly: [...forex.monthly, ...indian.monthly].sort((a, b) => a.month.localeCompare(b.month)),
    };
  }

  const Model = getTradeModel(marketLabel);
  const dateToStringOptions = marketLabel === "Indian_Market"
    ? { format: "%Y-%m-%d", date: "$dateValue", timezone: "Asia/Kolkata" }
    : { format: "%Y-%m-%d", date: "$dateValue" };
  const yearExpression = marketLabel === "Indian_Market"
    ? { $year: { date: "$dateValue", timezone: "Asia/Kolkata" } }
    : { $year: "$dateValue" };
  const monthExpression = marketLabel === "Indian_Market"
    ? { $month: { date: "$dateValue", timezone: "Asia/Kolkata" } }
    : { $month: "$dateValue" };
  const [result = {}] = await Model.aggregate([
    { $match: buildMatchQuery({ userId, market: marketLabel, instrumentType, dateRange }) },
    { $match: { profit: { $exists: true, $ne: null } } },
    {
      $project: {
        dateValue: { $ifNull: ["$tradeDate", "$createdAt"] },
        profit: { $ifNull: ["$profit", 0] },
      },
    },
    {
      $facet: {
        daily: [
          { $group: { _id: { $dateToString: dateToStringOptions }, profit: { $sum: "$profit" } } },
          { $sort: { _id: 1 } },
          { $project: { _id: 0, date: "$_id", profit: { $round: ["$profit", 2] } } },
        ],
        weekly: [
          {
            $group: {
              _id: { year: { $isoWeekYear: "$dateValue" }, week: { $isoWeek: "$dateValue" } },
              profit: { $sum: "$profit" },
            },
          },
          { $sort: { "_id.year": 1, "_id.week": 1 } },
          {
            $project: {
              _id: 0,
              week: {
                $concat: [
                  { $toString: "$_id.year" },
                  "-W",
                  { $cond: [{ $lt: ["$_id.week", 10] }, { $concat: ["0", { $toString: "$_id.week" }] }, { $toString: "$_id.week" }] },
                ],
              },
              profit: { $round: ["$profit", 2] },
            },
          },
        ],
        monthly: [
          {
            $group: {
              _id: { year: yearExpression, month: monthExpression },
              profit: { $sum: "$profit" },
            },
          },
          { $sort: { "_id.year": 1, "_id.month": 1 } },
          { $project: { _id: 0, year: "$_id.year", monthNumber: "$_id.month", profit: { $round: ["$profit", 2] } } },
        ],
      },
    },
  ]);

  return {
    daily: result.daily || [],
    weekly: result.weekly || [],
    monthly: (result.monthly || []).map((row) => ({
      month: formatMonthLabel(row.year, row.monthNumber),
      profit: row.profit,
    })),
  };
}

function summarizeGroupRows(rows = {}, defaults = []) {
  const result = {};
  for (const key of defaults) {
    result[key] = { total: 0, wins: 0, losses: 0, profit: 0, winRate: "0.0" };
  }

  for (const row of rows || []) {
    const key = row.key || "Unspecified";
    const total = row.total || 0;
    result[key] = {
      total,
      wins: row.wins || 0,
      losses: row.losses || 0,
      profit: Number((row.profit || 0).toFixed(2)),
      winRate: total ? (((row.wins || 0) / total) * 100).toFixed(1) : "0.0",
    };
  }

  return result;
}

function groupFacet(fieldExpression) {
  return [
    {
      $group: {
        _id: fieldExpression,
        total: { $sum: 1 },
        wins: { $sum: { $cond: [{ $gt: ["$profit", 0] }, 1, 0] } },
        losses: { $sum: { $cond: [{ $lt: ["$profit", 0] }, 1, 0] } },
        profit: { $sum: "$profit" },
      },
    },
    { $sort: { total: -1, profit: -1 } },
    { $project: { _id: 0, key: "$_id", total: 1, wins: 1, losses: 1, profit: 1 } },
  ];
}

function getForexSessionExpression() {
  return {
    $ifNull: [
      "$session",
      {
        $switch: {
          branches: [
            { case: { $and: [{ $gte: ["$hourUtc", 0] }, { $lt: ["$hourUtc", 8] }] }, then: "Asia Session" },
            { case: { $and: [{ $gte: ["$hourUtc", 13] }, { $lt: ["$hourUtc", 16] }] }, then: "Overlap Session" },
            { case: { $and: [{ $gte: ["$hourUtc", 8] }, { $lt: ["$hourUtc", 16] }] }, then: "London Session" },
            { case: { $and: [{ $gte: ["$hourUtc", 16] }, { $lt: ["$hourUtc", 21] }] }, then: "NY Session" },
          ],
          default: "Other",
        },
      },
    ],
  };
}

function getIndianSessionExpression() {
  return {
    $ifNull: [
      "$session",
      {
        $switch: {
          branches: [
            { case: { $and: [{ $gte: ["$istMinuteOfDay", 555] }, { $lt: ["$istMinuteOfDay", 660] }] }, then: "Opening Bell" },
            { case: { $and: [{ $gte: ["$istMinuteOfDay", 660] }, { $lt: ["$istMinuteOfDay", 810] }] }, then: "Mid-Session" },
            { case: { $and: [{ $gte: ["$istMinuteOfDay", 810] }, { $lt: ["$istMinuteOfDay", 900] }] }, then: "Post-Lunch" },
            { case: { $and: [{ $gte: ["$istMinuteOfDay", 900] }, { $lt: ["$istMinuteOfDay", 930] }] }, then: "Closing" },
          ],
          default: "Outside Market",
        },
      },
    ],
  };
}

async function aggregateTradeDistribution({ userId, market = "Forex", instrumentType, dateRange } = {}) {
  const marketLabel = resolveMarketLabel(market);
  if (marketLabel === "combined") {
    const [forex, indian] = await Promise.all([
      aggregateTradeDistribution({ userId, market: "Forex", dateRange }),
      aggregateTradeDistribution({ userId, market: "Indian_Market", instrumentType, dateRange }),
    ]);
    return { marketType: "combined", forex, indian };
  }

  const Model = getTradeModel(marketLabel);
  const isIndian = marketLabel === "Indian_Market";
  const sessionDefaults = isIndian
    ? ["Opening Bell", "Mid-Session", "Post-Lunch", "Closing", "Outside Market"]
    : ["Asia Session", "London Session", "Overlap Session", "NY Session", "Other"];

  const [result = {}] = await Model.aggregate([
    { $match: buildMatchQuery({ userId, market: marketLabel, instrumentType, dateRange }) },
    {
      $project: {
        profit: { $ifNull: ["$profit", 0] },
        pair: { $ifNull: ["$pair", "Unspecified"] },
        underlying: {
          $ifNull: [
            "$underlying",
            { $ifNull: ["$pair", "Unspecified"] },
          ],
        },
        type: { $ifNull: ["$type", "Unspecified"] },
        strategy: { $ifNull: ["$strategy", "Unspecified"] },
        session: 1,
        tradeType: { $ifNull: ["$tradeType", "Unspecified"] },
        entryBasis: { $ifNull: ["$entryBasis", "Plan"] },
        mistakeTag: { $ifNull: ["$mistakeTag", "None"] },
        optionType: { $ifNull: ["$optionType", "Unspecified"] },
        stockSymbol: { $ifNull: ["$stockSymbol", "Unspecified"] },
        sector: { $ifNull: ["$sector", "Other"] },
        dateValue: { $ifNull: ["$tradeDate", "$createdAt"] },
      },
    },
    {
      $addFields: {
        hourUtc: { $hour: "$dateValue" },
        istParts: { $dateToParts: { date: "$dateValue", timezone: "+05:30" } },
      },
    },
    {
      $addFields: {
        istMinuteOfDay: { $add: [{ $multiply: ["$istParts.hour", 60] }, "$istParts.minute"] },
      },
    },
    {
      $addFields: {
        computedSession: isIndian ? getIndianSessionExpression() : getForexSessionExpression(),
      },
    },
    {
      $facet: {
        byPair: groupFacet("$pair"),
        byType: groupFacet("$type"),
        byStrategy: groupFacet("$strategy"),
        bySession: groupFacet("$computedSession"),
        byTradeType: groupFacet("$tradeType"),
        byEntryBasis: groupFacet("$entryBasis"),
        byMistakeTag: groupFacet("$mistakeTag"),
        byUnderlying: groupFacet("$underlying"),
        byOptionType: groupFacet("$optionType"),
        byDirection: groupFacet("$type"),
        byStockSymbol: groupFacet("$stockSymbol"),
        bySector: groupFacet("$sector"),
      },
    },
  ]);

  const byType = summarizeGroupRows(result.byType, ["BUY", "SELL"]);
  const payload = {
    byPair: summarizeGroupRows(result.byPair),
    byType,
    byStrategy: summarizeGroupRows(result.byStrategy),
    bySession: summarizeGroupRows(result.bySession, sessionDefaults),
  };

  if (!isIndian) {
    return {
      ...payload,
      longTrades: byType.BUY?.total || 0,
      shortTrades: byType.SELL?.total || 0,
      longWinRate: byType.BUY?.winRate || "0.0",
      shortWinRate: byType.SELL?.winRate || "0.0",
      longProfit: Number(byType.BUY?.profit || 0).toFixed(2),
      shortProfit: Number(byType.SELL?.profit || 0).toFixed(2),
    };
  }

  const isEquity = String(instrumentType || "").toUpperCase() === "EQUITY";
  return {
    ...payload,
    byDirection: summarizeGroupRows(result.byDirection),
    byTradeType: summarizeGroupRows(result.byTradeType),
    byEntryBasis: summarizeGroupRows(result.byEntryBasis),
    byMistakeTag: summarizeGroupRows(result.byMistakeTag),
    byUnderlying: isEquity ? {} : summarizeGroupRows(result.byUnderlying),
    byOptionType: isEquity ? {} : summarizeGroupRows(result.byOptionType),
    byStockSymbol: isEquity ? summarizeGroupRows(result.byStockSymbol) : {},
    bySector: isEquity ? summarizeGroupRows(result.bySector) : {},
  };
}

async function aggregateTradeQuality({ userId, market = "Forex", instrumentType, dateRange } = {}) {
  const marketLabel = resolveMarketLabel(market);
  if (marketLabel === "combined") {
    const [forex, indian] = await Promise.all([
      aggregateTradeQuality({ userId, market: "Forex", dateRange }),
      aggregateTradeQuality({ userId, market: "Indian_Market", instrumentType, dateRange }),
    ]);
    return { marketType: "combined", forex, indian };
  }

  const Model = getTradeModel(marketLabel);
  const [result = {}] = await Model.aggregate([
    { $match: buildMatchQuery({ userId, market: marketLabel, instrumentType, dateRange }) },
    { $project: { profit: { $ifNull: ["$profit", 0] }, tradeQuality: 1 } },
    {
      $facet: {
        total: [{ $count: "count" }],
        quality: [
          { $match: { tradeQuality: { $in: ["Great", "Average", "Poor"] } } },
          ...groupFacet("$tradeQuality"),
        ],
      },
    },
  ]);

  const grouped = summarizeGroupRows(result.quality, ["Great", "Average", "Poor"]);
  const distribution = Object.fromEntries(
    Object.entries(grouped).map(([key, row]) => [key, {
      count: row.total,
      wins: row.wins,
      losses: row.losses,
      winRate: row.winRate,
      avgPnl: row.total ? (row.profit / row.total).toFixed(2) : "0.00",
      totalPnl: row.profit.toFixed(2),
    }])
  );
  const trackedCount = Object.values(distribution).reduce((sum, row) => sum + row.count, 0);

  return {
    distribution,
    trackedCount,
    totalTrades: result.total?.[0]?.count || 0,
  };
}

function generateSnapshotFromTrades({ trades, marketLabel, period }) {
  const offsetHours = appConfig.timezoneOffsetHours || 0;
  const resolvedMarketLabel = resolveMarketLabel(marketLabel);
  const selfAwareness = computeSelfAwarenessAnalytics(trades);
  const psychologyCost = computePsychologyCost(trades);
  const patterns = computePatternDetection(trades, resolvedMarketLabel);
  const dnaRaw = computeTradingDNA(trades, resolvedMarketLabel, selfAwareness);
  const tradingDNA = enrichTradingDNAWithPatterns(dnaRaw, patterns);
  const discipline = computeDisciplineAnalytics(trades, { marketType: resolvedMarketLabel, period, offsetHours });
  const timeline = computePsychologyTimeline(trades, { marketType: resolvedMarketLabel, period, offsetHours });
  const pnlReadyTrades = trades.filter(hasRecordedProfit);
  const performance = withPnlReadiness(
    computePerformanceMetrics(pnlReadyTrades, resolvedMarketLabel),
    trades.length,
    pnlReadyTrades.length
  );

  return {
    sourceTradeCount: trades.length,
    marketType: resolvedMarketLabel,
    generatedAt: new Date().toISOString(),
    performance,
    basicStats: performance,
    psychology: {
      cost: psychologyCost,
      timelineSummary: timeline?.summary || null,
    },
    discipline,
    selfAwareness,
    psychologyCost,
    patterns,
    tradingDNA,
    timeline,
    timelineSource: timeline,
    performanceMetrics: performance,
  };
}

async function getSnapshot({
  userId,
  market = "Forex",
  instrumentType,
  dateRange,
  period,
  includeTrades = false,
  cache = true,
} = {}) {
  const marketLabel = resolveMarketLabel(market);
  const version = await getTradeCacheVersion(userId);
  const cacheKey = getSnapshotCacheKey({ userId, marketLabel, instrumentType, dateRange, period, version });

  const resolver = async () => {
    const startedAt = Date.now();
    const trades = await loadTrades({ userId, market: marketLabel, instrumentType, dateRange });
    const snapshot = generateSnapshotFromTrades({ trades, marketLabel, period });
    return {
      ...snapshot,
      cache: {
        key: cacheKey,
        version,
        hit: false,
        ttlSeconds: SNAPSHOT_CACHE_TTL_SECONDS,
        queryCount: marketLabel === "combined" ? 2 : 1,
        generationMs: Date.now() - startedAt,
      },
    };
  };

  if (!cache || includeTrades) {
    const trades = await loadTrades({ userId, market: marketLabel, instrumentType, dateRange });
    const snapshot = generateSnapshotFromTrades({ trades, marketLabel, period });
    return {
      ...snapshot,
      ...(includeTrades ? { trades } : {}),
      cache: {
        key: cacheKey,
        version,
        hit: false,
        bypassed: !cache || includeTrades,
        ttlSeconds: SNAPSHOT_CACHE_TTL_SECONDS,
        queryCount: marketLabel === "combined" ? 2 : 1,
      },
    };
  }

  const { data, cacheHit, deduped } = await rememberCache(cacheKey, SNAPSHOT_CACHE_TTL_SECONDS, resolver);
  return {
    ...data,
    cache: {
      ...(data.cache || {}),
      key: cacheKey,
      version,
      hit: cacheHit,
      deduped: Boolean(deduped),
      ttlSeconds: SNAPSHOT_CACHE_TTL_SECONDS,
    },
  };
}

async function rememberAggregate({ userId, marketLabel, instrumentType, dateRange, period, scope, resolver }) {
  const version = await getTradeCacheVersion(userId);
  const cacheKey = buildCacheKey(
    "analytics_aggregate",
    scope,
    userId?.toString?.() || userId,
    marketLabel,
    instrumentType || "all",
    normalizeDateValue(dateRange?.from) || "start",
    normalizeDateValue(dateRange?.to) || "end",
    period || "default",
    `v${version}`
  );
  const { data, cacheHit, deduped } = await rememberCache(cacheKey, AGGREGATE_CACHE_TTL_SECONDS, resolver);
  return {
    ...data,
    cache: {
      ...(data.cache || {}),
      key: cacheKey,
      version,
      hit: cacheHit,
      deduped: Boolean(deduped),
      ttlSeconds: AGGREGATE_CACHE_TTL_SECONDS,
    },
  };
}

async function getPerformanceSnapshot({ userId, market = "Forex", instrumentType, dateRange } = {}) {
  const marketLabel = resolveMarketLabel(market);
  return rememberAggregate({
    userId,
    marketLabel,
    instrumentType,
    dateRange,
    scope: "performance",
    resolver: async () => {
      const startedAt = Date.now();
      const performance = await aggregatePerformance({ userId, market: marketLabel, instrumentType, dateRange });
      const generationMs = Date.now() - startedAt;
      logSlowAggregate("performance", { userId, marketType: marketLabel, generationMs });
      return {
        marketType: marketLabel,
        performance,
        basicStats: performance,
        generatedAt: new Date().toISOString(),
        cache: { generationMs, queryCount: marketLabel === "combined" ? 2 : 1 },
      };
    },
  });
}

async function getTimelineSnapshot({ userId, market = "Forex", instrumentType, dateRange, period = "weekly" } = {}) {
  const marketLabel = resolveMarketLabel(market);
  return rememberAggregate({
    userId,
    marketLabel,
    instrumentType,
    dateRange,
    period,
    scope: "timeline",
    resolver: async () => {
      const startedAt = Date.now();
      const timeline = await aggregateTimeline({ userId, market: marketLabel, instrumentType, dateRange, period });
      const generationMs = Date.now() - startedAt;
      logSlowAggregate("timeline", { userId, marketType: marketLabel, period, generationMs, points: timeline.length });
      const timelinePayload = {
        insufficient: timeline.length === 0,
        source: "mongo_aggregation",
        period,
        buckets: timeline,
        trends: { psychology: "stable", selfAwareness: "stable", discipline: "stable" },
        milestones: [],
        stats: {
          totalBuckets: timeline.length,
          avgPsychologyScore: null,
          avgSelfAwarenessScore: null,
          avgDisciplineScore: null,
        },
        aiSummary: timeline.length
          ? "Timeline generated from MongoDB aggregation buckets."
          : "No timeline data yet. Keep logging trades to build your psychology timeline.",
      };
      return {
        marketType: marketLabel,
        period,
        timeline: timelinePayload,
        generatedAt: new Date().toISOString(),
        cache: { generationMs, queryCount: marketLabel === "combined" ? 2 : 1 },
      };
    },
  });
}

async function getDisciplineSummarySnapshot({ userId, market = "Forex", instrumentType, dateRange } = {}) {
  const marketLabel = resolveMarketLabel(market);
  return rememberAggregate({
    userId,
    marketLabel,
    instrumentType,
    dateRange,
    scope: "discipline",
    resolver: async () => {
      const startedAt = Date.now();
      const disciplineSummary = await aggregateDisciplineSummary({ userId, market: marketLabel, instrumentType, dateRange });
      const generationMs = Date.now() - startedAt;
      logSlowAggregate("discipline", { userId, marketType: marketLabel, generationMs });
      return {
        marketType: marketLabel,
        disciplineSummary,
        generatedAt: new Date().toISOString(),
        cache: { generationMs, queryCount: marketLabel === "combined" ? 2 : 1 },
      };
    },
  });
}

async function getPnlBreakdownSnapshot({ userId, market = "Forex", instrumentType, dateRange } = {}) {
  const marketLabel = resolveMarketLabel(market);
  return rememberAggregate({
    userId,
    marketLabel,
    instrumentType,
    dateRange,
    scope: "pnl_breakdown",
    resolver: async () => {
      const startedAt = Date.now();
      const breakdown = await aggregatePnlBreakdown({ userId, market: marketLabel, instrumentType, dateRange });
      const generationMs = Date.now() - startedAt;
      logSlowAggregate("pnl_breakdown", { userId, marketType: marketLabel, generationMs });
      return {
        marketType: marketLabel,
        ...breakdown,
        generatedAt: new Date().toISOString(),
        cache: { generationMs, queryCount: marketLabel === "combined" ? 2 : 1 },
      };
    },
  });
}

async function getTradeDistributionSnapshot({ userId, market = "Forex", instrumentType, dateRange } = {}) {
  const marketLabel = resolveMarketLabel(market);
  return rememberAggregate({
    userId,
    marketLabel,
    instrumentType,
    dateRange,
    scope: "trade_distribution",
    resolver: async () => {
      const startedAt = Date.now();
      const distribution = await aggregateTradeDistribution({ userId, market: marketLabel, instrumentType, dateRange });
      const generationMs = Date.now() - startedAt;
      logSlowAggregate("trade_distribution", { userId, marketType: marketLabel, generationMs });
      return {
        marketType: marketLabel,
        distribution,
        generatedAt: new Date().toISOString(),
        cache: { generationMs, queryCount: marketLabel === "combined" ? 2 : 1 },
      };
    },
  });
}

async function getTradeQualitySnapshot({ userId, market = "Forex", instrumentType, dateRange } = {}) {
  const marketLabel = resolveMarketLabel(market);
  return rememberAggregate({
    userId,
    marketLabel,
    instrumentType,
    dateRange,
    scope: "trade_quality",
    resolver: async () => {
      const startedAt = Date.now();
      const quality = await aggregateTradeQuality({ userId, market: marketLabel, instrumentType, dateRange });
      const generationMs = Date.now() - startedAt;
      logSlowAggregate("trade_quality", { userId, marketType: marketLabel, generationMs });
      return {
        marketType: marketLabel,
        quality,
        generatedAt: new Date().toISOString(),
        cache: { generationMs, queryCount: marketLabel === "combined" ? 2 : 1 },
      };
    },
  });
}

module.exports = {
  AGGREGATE_CACHE_TTL_SECONDS,
  SLOW_AGGREGATE_MS,
  SNAPSHOT_TRADE_PROJECTION,
  SNAPSHOT_CACHE_TTL_SECONDS,
  aggregateDisciplineSummary,
  aggregatePerformance,
  aggregatePnlBreakdown,
  aggregateTradeDistribution,
  aggregateTradeQuality,
  aggregateTimeline,
  computePerformanceMetrics,
  generateSnapshotFromTrades,
  getDisciplineSummarySnapshot,
  getPerformanceSnapshot,
  getPnlBreakdownSnapshot,
  getSnapshot,
  getTimelineSnapshot,
  getTradeDistributionSnapshot,
  getTradeQualitySnapshot,
  loadTrades,
};
