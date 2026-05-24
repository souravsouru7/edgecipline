const Trade = require("../models/Trade");
const IndianTrade = require("../models/IndianTrade");
const notificationService = require("./notificationService");
const { appConfig } = require("../config");
const { logger } = require("../utils/logger");

const RISK_TAGS = new Set(["fomo", "revenge", "fear", "frustrated", "stressed"]);

// ─── Date helpers ─────────────────────────────────────────────────────────────
function asDate(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function getLocalDateKey(date = new Date()) {
  const shifted = new Date(asDate(date).getTime() + (appConfig.timezoneOffsetHours || 0) * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function getDayRange(date = new Date()) {
  const shiftMs = (appConfig.timezoneOffsetHours || 0) * 60 * 60 * 1000;
  const shifted = new Date(asDate(date).getTime() + shiftMs);
  shifted.setUTCHours(0, 0, 0, 0);
  const start = new Date(shifted.getTime() - shiftMs);
  const end   = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

function getWeekStart(date = new Date()) {
  const { start } = getDayRange(date);
  const day  = start.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  return new Date(start.getTime() - diff * 24 * 60 * 60 * 1000);
}

function getWeekKey(date = new Date()) {
  return getLocalDateKey(getWeekStart(date));
}

function normalizeMistake(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function humanize(value) {
  return String(value || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function hasNoStopLoss(trade) {
  const sl = Number(trade.stopLoss);
  return trade.stopLoss === null || trade.stopLoss === undefined || trade.stopLoss === "" || !Number.isFinite(sl) || sl <= 0;
}

function getTradeModel(collection) {
  return collection === "indian" ? IndianTrade : Trade;
}

function baseTradeQuery(userId, collection, marketType) {
  if (collection === "indian") return { user: userId };
  return { user: userId, marketType: marketType || "Forex", "parsedData.multiTradeGhost": { $ne: true } };
}

function getDeepLinks(trade, collection) {
  const id = trade._id?.toString?.();
  if (collection === "indian") {
    return {
      view:      `/indian-market/trades/view?id=${id}`,
      edit:      `/indian-market/trades/edit?id=${id}`,
      listToday: "/indian-market/trades?filter=today",
      analytics: "/indian-market/analytics",
    };
  }
  return {
    view:      `/trades/view?id=${id}`,
    edit:      `/trades/edit?id=${id}`,
    listToday: "/trades?filter=today",
    analytics: "/analytics",
  };
}

async function safeNotify(userId, payload) {
  try {
    return await notificationService.notifyUser(userId, payload);
  } catch (error) {
    logger.warn("Smart notification failed to notify", {
      userId: userId?.toString?.(),
      type:   payload.type,
      error:  error.message,
    });
    return null;
  }
}

// ─── 1. No Stop Loss ──────────────────────────────────────────────────────────
async function checkNoStopLoss({ userId, trade, collection }) {
  if (!hasNoStopLoss(trade)) return;
  const links = getDeepLinks(trade, collection);
  await safeNotify(userId, {
    type:       "no_stop_loss",
    title:      "Trade entered without a stop loss.",
    body:       "A trade with no stop loss is a trade with no plan. Add your SL now.",
    sourceType: "trade",
    sourceId:   trade._id,
    dedupeKey:  `no-stop-loss:${trade._id}`,
    deepLink:   links.edit,
    priority:   "high",
    data: {
      screen:  collection === "indian" ? "indian-trade-edit" : "trade-edit",
      tradeId: trade._id?.toString?.(),
    },
  });
}

// ─── 2. Setup Discipline Drop ─────────────────────────────────────────────────
async function checkSetupDisciplineDrop({ userId, trade, collection, marketType }) {
  const score = Number(trade.setupScore);
  if (!Number.isFinite(score) || score >= 60) return;

  const Model = getTradeModel(collection);
  const { start, end } = getDayRange(trade.tradeDate || trade.createdAt);
  const lowScoreToday = await Model.countDocuments({
    ...baseTradeQuery(userId, collection, marketType),
    tradeDate:  { $gte: start, $lt: end },
    setupScore: { $lt: 60 },
  });

  if (lowScoreToday < 2 && Number(trade.profit) >= 0) return;

  const dateKey    = getLocalDateKey(trade.tradeDate || trade.createdAt);
  const windowKey  = Math.floor(new Date().getUTCHours() / 6);
  const links      = getDeepLinks(trade, collection);

  await safeNotify(userId, {
    type:       "setup_discipline",
    title:      "Your edge is slipping.",
    body:       `Checklist score ${score}% — below your minimum. You're entering without confirmation. Wait for your A+ setup.`,
    sourceType: "trade",
    sourceId:   trade._id,
    dedupeKey:  `setup-discipline:${userId}:${marketType}:${dateKey}:${windowKey}`,
    deepLink:   links.view,
    data: {
      screen:     collection === "indian" ? "indian-trade" : "trade",
      tradeId:    trade._id?.toString?.(),
      setupScore: score,
    },
  });
}

// ─── 3. Mood / Emotional Risk ─────────────────────────────────────────────────
async function checkMoodBasedRisk({ userId, trade, collection }) {
  const mood          = Number(trade.mood);
  const lowMood       = Number.isFinite(mood) && mood > 0 && mood <= 2;
  const tags          = Array.isArray(trade.emotionalTags) ? trade.emotionalTags : [];
  const hasRiskTag    = tags.some((t) => RISK_TAGS.has(String(t || "").trim().toLowerCase()));
  const overconfident = String(trade.confidence || "") === "Overconfident";
  if (!lowMood && !hasRiskTag && !overconfident) return;

  const dateKey = getLocalDateKey(trade.tradeDate || trade.createdAt);
  await safeNotify(userId, {
    type:       "mood_risk",
    title:      "Your mind is your biggest risk right now.",
    body:       "You logged low focus or high emotion today. Cut your position size in half until your state improves.",
    sourceType: "trade",
    sourceId:   trade._id,
    dedupeKey:  `mood-risk:${userId}:${dateKey}`,
    deepLink:   "/checklist/psychology",
    data: {
      screen:  "psychology",
      tradeId: trade._id?.toString?.(),
      mood:    Number.isFinite(mood) ? mood : "",
    },
  });
}

// ─── 4. Revenge Trading Warning ───────────────────────────────────────────────
async function checkRevengeTrading({ userId, trade, collection, marketType }) {
  if (!(Number(trade.profit) < 0)) return;

  const Model = getTradeModel(collection);
  const { start, end } = getDayRange(trade.tradeDate || trade.createdAt);

  const recentTrades = await Model.find({
    ...baseTradeQuery(userId, collection, marketType),
    tradeDate: { $gte: start, $lt: end },
    profit:    { $ne: null },
  })
    .sort({ tradeDate: -1, createdAt: -1 })
    .limit(3)
    .select("profit tradeDate createdAt")
    .lean();

  if (recentTrades.length !== 3 || !recentTrades.every((t) => Number(t.profit) < 0)) return;

  const newest = asDate(recentTrades[0].tradeDate || recentTrades[0].createdAt);
  const oldest = asDate(recentTrades[2].tradeDate || recentTrades[2].createdAt);
  if (newest.getTime() - oldest.getTime() > 4 * 60 * 60 * 1000) return;

  const dateKey = getLocalDateKey(trade.tradeDate || trade.createdAt);
  const links   = getDeepLinks(trade, collection);
  const totalLoss = recentTrades.reduce((sum, t) => sum + Number(t.profit), 0).toFixed(2);

  await safeNotify(userId, {
    type:       "revenge_trading",
    title:      "Stop. Breathe. Think.",
    body:       `3 consecutive losses (${totalLoss}). The market will still be here tomorrow. Your capital might not be. Step away now.`,
    sourceType: "trade",
    sourceId:   trade._id,
    dedupeKey:  `revenge-warning:${userId}:${marketType}:${dateKey}`,
    deepLink:   links.listToday,
    priority:   "high",
    data: {
      screen:    collection === "indian" ? "indian-trades" : "trades",
      filter:    "today",
      totalLoss: String(totalLoss),
    },
  });
}

// ─── 5. Overtrading Alert ─────────────────────────────────────────────────────
async function checkOvertrading({ userId, trade, collection, marketType }) {
  const Model = getTradeModel(collection);
  const now   = asDate(trade.tradeDate || trade.createdAt);
  const since = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

  const dailyCounts = await Model.aggregate([
    { $match: { ...baseTradeQuery(userId, collection, marketType), tradeDate: { $gte: since, $lt: now } } },
    { $group: { _id: { y: { $year: "$tradeDate" }, m: { $month: "$tradeDate" }, d: { $dayOfMonth: "$tradeDate" } }, count: { $sum: 1 } } },
    { $sort: { "_id.y": -1, "_id.m": -1, "_id.d": -1 } },
    { $limit: 30 },
  ]);

  if (dailyCounts.length < 3) return;

  const average   = dailyCounts.reduce((sum, item) => sum + item.count, 0) / dailyCounts.length;
  const threshold = Math.max(Math.ceil(average * 1.5), Math.ceil(average + 2), 5);
  const { start, end } = getDayRange(now);
  const todayCount = await Model.countDocuments({ ...baseTradeQuery(userId, collection, marketType), tradeDate: { $gte: start, $lt: end } });

  if (todayCount <= threshold) return;

  const dateKey = getLocalDateKey(now);
  const links   = getDeepLinks(trade, collection);

  await safeNotify(userId, {
    type:       "overtrading",
    title:      "Quality over quantity.",
    body:       `${todayCount} trades today — ${todayCount - Math.ceil(average)} above your average. Every extra trade is now emotional, not strategic. Protect what you've built.`,
    sourceType: "trade",
    sourceId:   trade._id,
    dedupeKey:  `overtrading:${userId}:${marketType}:${dateKey}`,
    deepLink:   links.listToday,
    data: {
      screen:     collection === "indian" ? "indian-trades" : "trades",
      filter:     "today",
      todayCount: String(todayCount),
      threshold:  String(threshold),
    },
  });
}

// ─── 6. Repeated Mistake ──────────────────────────────────────────────────────
async function checkRepeatedMistake({ userId, trade, collection, marketType }) {
  const mistake = normalizeMistake(trade.mistakeTag);
  if (!mistake) return;

  const Model   = getTradeModel(collection);
  const weekStart = getWeekStart(trade.tradeDate || trade.createdAt);
  const regex   = new RegExp(`^${String(trade.mistakeTag).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
  const count   = await Model.countDocuments({
    ...baseTradeQuery(userId, collection, marketType),
    tradeDate:  { $gte: weekStart },
    mistakeTag: regex,
  });
  if (count < 3) return;

  const weekKey     = getWeekKey(trade.tradeDate || trade.createdAt);
  const mistakeLabel = humanize(mistake);

  await safeNotify(userId, {
    type:       "repeated_mistake",
    title:      "Pattern detected. Time to break it.",
    body:       `"${mistakeLabel}" has appeared ${count}× this week. Top traders eliminate one error pattern per week. This is yours.`,
    sourceType: "trade",
    sourceId:   trade._id,
    dedupeKey:  `repeated-mistake:${userId}:${marketType}:${weekKey}:${mistake}`,
    deepLink:   `/analytics?insight=mistakes&tag=${encodeURIComponent(mistake)}`,
    data: {
      screen:  "analytics",
      insight: "mistakes",
      tag:     mistake,
      count:   String(count),
    },
  });
}

// ─── 7. Daily Loss / Risk Management Warning ──────────────────────────────────
async function checkDailyLossWarning({ userId, trade, collection, marketType }) {
  if (Number(trade.profit) >= 0) return;

  const Model = getTradeModel(collection);
  const { start, end } = getDayRange(trade.tradeDate || trade.createdAt);

  const dayTrades = await Model.find({
    ...baseTradeQuery(userId, collection, marketType),
    tradeDate: { $gte: start, $lt: end },
    profit:    { $ne: null },
  }).select("profit").lean();

  if (dayTrades.length < 2) return;

  const totalLoss  = dayTrades.reduce((sum, t) => sum + Number(t.profit), 0);
  if (totalLoss >= 0) return;

  // Warn when today's drawdown exceeds 2× the average single-trade loss
  const losses     = dayTrades.map((t) => Number(t.profit)).filter((p) => p < 0);
  if (losses.length < 2) return;
  const avgLoss    = losses.reduce((s, v) => s + v, 0) / losses.length;
  const threshold  = avgLoss * 2; // threshold is negative
  if (totalLoss > threshold) return; // not bad enough yet

  const dateKey = getLocalDateKey(trade.tradeDate || trade.createdAt);
  const links   = getDeepLinks(trade, collection);

  await safeNotify(userId, {
    type:       "daily_loss_warning",
    title:      "Capital protection mode.",
    body:       `Today's drawdown: ${totalLoss.toFixed(2)}. You're approaching your daily limit. One more bad trade could set back a week of gains. Consider stopping here.`,
    sourceType: "trade",
    sourceId:   trade._id,
    dedupeKey:  `daily-loss:${userId}:${marketType}:${dateKey}`,
    deepLink:   links.listToday,
    priority:   "high",
    data: {
      screen:     collection === "indian" ? "indian-trades" : "trades",
      filter:     "today",
      totalLoss:  String(totalLoss.toFixed(2)),
    },
  });
}

// ─── 8. Confidence / Patience Reminder ───────────────────────────────────────
async function checkConfidenceReminder({ userId, trade, collection, marketType }) {
  // Fire after a winning trade to reinforce discipline — not every win, ~1 per session
  if (Number(trade.profit) <= 0) return;

  const score = Number(trade.setupScore);
  // Only reinforce when the user followed their checklist well
  if (!Number.isFinite(score) || score < 70) return;

  const { start, end } = getDayRange(trade.tradeDate || trade.createdAt);
  const Model = getTradeModel(collection);
  const winCount = await Model.countDocuments({
    ...baseTradeQuery(userId, collection, marketType),
    tradeDate: { $gte: start, $lt: end },
    profit:    { $gt: 0 },
    setupScore: { $gte: 70 },
  });

  // Send once per session after the 2nd disciplined win
  if (winCount !== 2) return;

  const dateKey = getLocalDateKey(trade.tradeDate || trade.createdAt);
  const links   = getDeepLinks(trade, collection);

  await safeNotify(userId, {
    type:       "confidence_reminder",
    title:      "Discipline is working.",
    body:       "2 quality setups followed perfectly today. Good setups need patience, not speed. Keep this standard.",
    sourceType: "trade",
    sourceId:   trade._id,
    dedupeKey:  `confidence:${userId}:${marketType}:${dateKey}`,
    deepLink:   links.analytics,
    data: {
      screen:   collection === "indian" ? "indian-trades" : "trades",
      winCount: String(winCount),
    },
  });
}

// ─── Main evaluator ───────────────────────────────────────────────────────────
async function evaluateSmartNotifications({ userId, trade, marketType = "Forex", collection = "forex" }) {
  if (!userId || !trade || !trade._id) return;
  const plainTrade = typeof trade.toObject === "function" ? trade.toObject() : trade;

  await Promise.allSettled([
    checkNoStopLoss          ({ userId, trade: plainTrade, collection, marketType }),
    checkSetupDisciplineDrop ({ userId, trade: plainTrade, collection, marketType }),
    checkMoodBasedRisk       ({ userId, trade: plainTrade, collection, marketType }),
    checkRevengeTrading      ({ userId, trade: plainTrade, collection, marketType }),
    checkOvertrading         ({ userId, trade: plainTrade, collection, marketType }),
    checkRepeatedMistake     ({ userId, trade: plainTrade, collection, marketType }),
    checkDailyLossWarning    ({ userId, trade: plainTrade, collection, marketType }),
    checkConfidenceReminder  ({ userId, trade: plainTrade, collection, marketType }),
  ]);
}

// ─── Weekly insight (called from weeklyReport service) ───────────────────────
async function notifyWeeklyInsight({ userId, report, marketType = "Forex" }) {
  if (!userId || !report?._id) return null;

  const feedback = report.aiFeedback || {};
  const winRateChange = report.winRateChange; // e.g. 12 (percent points)
  const focus = feedback.weeklyFocus
    || feedback.topFocus
    || feedback.psychologyFeedback?.weeklyFocus
    || feedback.improvements?.[0]?.title
    || "Follow only your highest-quality setups this week.";

  const body = winRateChange > 0
    ? `Win rate improved ${winRateChange}% this week. Consistency is building. This week's focus: ${focus}`
    : `This week's focus: ${focus}`;

  return safeNotify(userId, {
    type:       "weekly_ai_insight",
    title:      "Your week in numbers.",
    body,
    sourceType: "weekly_report",
    sourceId:   report._id,
    dedupeKey:  `weekly-insight:${userId}:${marketType}:${report.weekStart?.toISOString?.() || report._id}`,
    deepLink:   `/weekly-reports?id=${report._id}`,
    data: {
      screen:   "weekly-report",
      reportId: report._id?.toString?.(),
      marketType,
    },
  });
}

module.exports = {
  evaluateSmartNotifications,
  notifyWeeklyInsight,
};
