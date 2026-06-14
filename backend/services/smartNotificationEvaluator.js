const Trade = require("../models/Trade");
const IndianTrade = require("../models/IndianTrade");
const notificationService = require("./notificationService");
const { logger } = require("../utils/logger");
const {
  DEFAULT_NOTIFICATION_TIMEZONE,
  asDate,
  formatLocalTime,
  getDayRange,
  getLocalDateKey,
  getWeekKey,
  getWeekStart,
  getWindowKey,
  resolveTimeZone,
} = require("../utils/timezone");

const RISK_TAGS = new Set(["fomo", "revenge", "fear", "frustrated", "stressed"]);

// ─── Date helpers ─────────────────────────────────────────────────────────────
function getNotificationTimezone(timezone) {
  const configuredTimezone = timezone || process.env.SMART_NOTIFICATION_TIMEZONE || DEFAULT_NOTIFICATION_TIMEZONE;
  const resolvedTimezone = resolveTimeZone(configuredTimezone);

  if (configuredTimezone !== resolvedTimezone) {
    logger.warn("[TimezoneDedup] invalid notification timezone; falling back to Asia/Kolkata", {
      timezone: configuredTimezone,
      fallbackTimezone: resolvedTimezone,
    });
  }

  return resolvedTimezone;
}

function getTradeTimestamp(trade) {
  return asDate(trade.tradeDate || trade.createdAt);
}

function logDedupeKey({ userId, type, timezone, timestamp, dateKey, dedupeKey, windowKey }) {
  logger.info("[TimezoneDedup] dedupe key generated", {
    userId: userId?.toString?.(),
    type,
    timezone,
    utcTime: timestamp.toISOString(),
    localTime: formatLocalTime(timestamp, timezone),
    dateKey,
    windowKey,
    dedupeKey,
  });
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
  if (collection === "indian") return { user: userId, deletedAt: null };
  return { user: userId, marketType: marketType || "Forex", deletedAt: null, "parsedData.multiTradeGhost": { $ne: true } };
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

// runAsyncChecks runs all post-save checks for a single trade. Called by the
// BullMQ worker (backend/workers/smartNotificationWorker.js) — never call
// this directly from request handlers; always enqueue so failures survive
// restart and get retried with exponential backoff.
async function runAsyncChecks(payload) {
  const results = await Promise.allSettled([
    checkRevengeTrading(payload),
    checkOvertrading(payload),
    checkRepeatedMistake(payload),
    checkDailyLossWarning(payload),
    checkConfidenceReminder(payload),
  ]);

  const summary = {
    revengeTrading:      results[0].status,
    overtrading:         results[1].status,
    repeatedMistake:     results[2].status,
    dailyLossWarning:    results[3].status,
    confidenceReminder:  results[4].status,
  };

  // Surface any rejection so the worker can decide whether to retry.
  // We throw on ANY rejection — BullMQ retries with exponential backoff;
  // checks that succeed on first attempt won't run again because each
  // notification is dedup'd at notifyUser via dedupeKey + unique index.
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    const first = failed[0].reason;
    const err = new Error(`smart notification check(s) failed: ${failed.length}/${results.length}`);
    err.checks = summary;
    err.firstError = first?.message || String(first);
    throw err;
  }

  return summary;
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
async function checkSetupDisciplineDrop({ userId, trade, collection, marketType, timezone }) {
  const score   = Number(trade.setupScore);
  const profit  = Number(trade.profit);
  const tradeId = trade._id?.toString?.();
  const userIdStr = userId?.toString?.();
  const resolvedTimezone = timezone || DEFAULT_NOTIFICATION_TIMEZONE;

  const timestamp = getTradeTimestamp(trade);
  const dateKey   = getLocalDateKey(timestamp, resolvedTimezone);
  const windowKey = getWindowKey(timestamp, resolvedTimezone);

  // Gate 1: score must be a finite number below 60
  const gate1Passed = Number.isFinite(score) && score < 60;
  logger.info("[SD] Gate1", {
    userId: userIdStr,
    tradeId,
    setupScore: trade.setupScore,
    parsedScore: score,
    profit,
    dateKey,
    windowKey,
    timezone: resolvedTimezone,
    passed: gate1Passed,
  });
  if (!gate1Passed) return upsertDebugLog(userId, { tradeId, marketType, trade, score, profit, gate1Passed: false });

  const Model = getTradeModel(collection);
  const { start, end } = getDayRange(timestamp, resolvedTimezone);

  // $ne: null excludes documents where setupScore was never set; otherwise
  // MongoDB matches missing-field docs against {$lt: 60} and inflates the count.
  const lowScoreToday = await Model.countDocuments({
    ...baseTradeQuery(userId, collection, marketType),
    tradeDate:  { $gte: start, $lt: end },
    setupScore: { $ne: null, $lt: 60 },
  });

  logger.info("[SD] DailyCount", {
    userId: userIdStr,
    tradeId,
    lowScoreToday,
    start: start.toISOString(),
    end:   end.toISOString(),
    dateKey,
    timezone: resolvedTimezone,
  });

  // Gate 3: critical score (< 40) always notifies; otherwise require 2+ bad trades OR a loss
  const criticalScore = score < 40;
  const gate3Passed = criticalScore || lowScoreToday >= 2 || profit < 0;
  logger.info("[SD] Gate3", {
    userId: userIdStr,
    tradeId,
    setupScore: score,
    profit,
    criticalScore,
    lowScoreToday,
    dateKey,
    windowKey,
    passed: gate3Passed,
  });

  const debugBase = { tradeId, marketType, trade, score, profit, lowScoreToday, gate1Passed: true, gate3Passed };
  if (!gate3Passed) return upsertDebugLog(userId, debugBase);

  const links     = getDeepLinks(trade, collection);
  const dedupeKey = `setup-discipline:${userId}:${marketType}:${dateKey}:${windowKey}`;

  logDedupeKey({ userId, type: "setup_discipline", timezone: resolvedTimezone, timestamp, dateKey, windowKey, dedupeKey });
  logger.info("[SD] Dedupe", {
    userId: userIdStr,
    tradeId,
    dedupeKey,
    dateKey,
    windowKey,
    tradeTimestamp: timestamp.toISOString(),
    timezone: resolvedTimezone,
  });

  const notification = await safeNotify(userId, {
    type:       "setup_discipline",
    title:      "Your edge is slipping.",
    body:       `Checklist score ${score}% — below your minimum. You're entering without confirmation. Wait for your A+ setup.`,
    sourceType: "trade",
    sourceId:   trade._id,
    dedupeKey,
    deepLink:   links.view,
    data: {
      screen:     collection === "indian" ? "indian-trade" : "trade",
      tradeId,
      setupScore: score,
    },
  });

  const dedupeBlocked       = notification === null;
  const notificationCreated = Boolean(notification?._id);
  const pushSent            = ["sent", "partial"].includes(notification?.status);
  const pushSuccessCount    = notification?.delivery?.successCount ?? 0;
  const pushFailureCount    = notification?.delivery?.failureCount ?? 0;

  logger.info("[SD] PushResult", {
    userId: userIdStr,
    tradeId,
    notificationId:   notification?._id?.toString?.(),
    status:           notification?.status,
    dedupeBlocked,
    delivered:        pushSuccessCount > 0,
    successCount:     pushSuccessCount,
    failureCount:     pushFailureCount,
  });
  logger.info("[SD] Complete", {
    userId: userIdStr,
    tradeId,
    setupScore: score,
    profit,
    lowScoreToday,
    dateKey,
    windowKey,
    dedupeBlocked,
    notificationCreated,
    notificationSent: pushSent,
  });

  return upsertDebugLog(userId, {
    ...debugBase,
    dedupeKey,
    dedupeBlocked,
    notificationCreated,
    notificationId:    notification?._id,
    pushSent,
    pushSuccessCount,
    pushFailureCount,
  });
}

// Fire-and-forget — never throws, never blocks the main eval path
function upsertDebugLog(userId, fields) {
  const NotificationDebugLog = require("../models/NotificationDebugLog");
  const tradeDate = fields.trade?.tradeDate || fields.trade?.createdAt || new Date();
  NotificationDebugLog.findOneAndUpdate(
    { user: userId, type: "setup_discipline" },
    {
      $set: {
        user:                userId,
        type:                "setup_discipline",
        tradeId:             fields.tradeId,
        marketType:          fields.marketType || "Forex",
        tradeDate:           tradeDate,
        setupScore:          fields.score ?? null,
        profit:              fields.profit ?? null,
        lowScoreToday:       fields.lowScoreToday ?? null,
        gate1Passed:         fields.gate1Passed ?? false,
        gate3Passed:         fields.gate3Passed ?? false,
        dedupeKey:           fields.dedupeKey || null,
        dedupeBlocked:       fields.dedupeBlocked ?? false,
        notificationCreated: fields.notificationCreated ?? false,
        notificationId:      fields.notificationId || null,
        pushSent:            fields.pushSent ?? false,
        pushSuccessCount:    fields.pushSuccessCount ?? 0,
        pushFailureCount:    fields.pushFailureCount ?? 0,
        evaluatedAt:         new Date(),
      },
    },
    { upsert: true }
  ).catch((err) => {
    logger.warn("[SD] debugLog upsert failed", { userId: userId?.toString?.(), error: err.message });
  });
}

// ─── 3. Mood / Emotional Risk ─────────────────────────────────────────────────
async function checkMoodBasedRisk({ userId, trade, collection, timezone }) {
  const mood          = Number(trade.mood);
  const lowMood       = Number.isFinite(mood) && mood > 0 && mood <= 2;
  const tags          = Array.isArray(trade.emotionalTags) ? trade.emotionalTags : [];
  const hasRiskTag    = tags.some((t) => RISK_TAGS.has(String(t || "").trim().toLowerCase()));
  const overconfident = String(trade.confidence || "") === "Overconfident";
  if (!lowMood && !hasRiskTag && !overconfident) return;

  const timestamp = getTradeTimestamp(trade);
  const dateKey = getLocalDateKey(timestamp, timezone);
  const dedupeKey = `mood-risk:${userId}:${dateKey}`;

  logDedupeKey({ userId, type: "mood_risk", timezone, timestamp, dateKey, dedupeKey });

  await safeNotify(userId, {
    type:       "mood_risk",
    title:      "Your mind is your biggest risk right now.",
    body:       "You logged low focus or high emotion today. Cut your position size in half until your state improves.",
    sourceType: "trade",
    sourceId:   trade._id,
    dedupeKey,
    deepLink:   "/checklist/psychology",
    data: {
      screen:  "psychology",
      tradeId: trade._id?.toString?.(),
      mood:    Number.isFinite(mood) ? mood : "",
    },
  });
}

// ─── 4. Revenge Trading Warning ───────────────────────────────────────────────
async function checkRevengeTrading({ userId, trade, collection, marketType, timezone }) {
  if (!(Number(trade.profit) < 0)) return;

  const Model = getTradeModel(collection);
  const timestamp = getTradeTimestamp(trade);
  const { start, end } = getDayRange(timestamp, timezone);

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

  const dateKey = getLocalDateKey(timestamp, timezone);
  const links   = getDeepLinks(trade, collection);
  const totalLoss = recentTrades.reduce((sum, t) => sum + Number(t.profit), 0).toFixed(2);
  const dedupeKey = `revenge-warning:${userId}:${marketType}:${dateKey}`;

  logDedupeKey({ userId, type: "revenge_trading", timezone, timestamp, dateKey, dedupeKey });

  await safeNotify(userId, {
    type:       "revenge_trading",
    title:      "Stop. Breathe. Think.",
    body:       `3 consecutive losses (${totalLoss}). The market will still be here tomorrow. Your capital might not be. Step away now.`,
    sourceType: "trade",
    sourceId:   trade._id,
    dedupeKey,
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
async function checkOvertrading({ userId, trade, collection, marketType, timezone }) {
  const Model = getTradeModel(collection);
  const now   = getTradeTimestamp(trade);
  const since = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

  const dailyCounts = await Model.aggregate([
    { $match: { ...baseTradeQuery(userId, collection, marketType), tradeDate: { $gte: since, $lt: now } } },
    { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$tradeDate", timezone } }, count: { $sum: 1 } } },
    { $sort: { _id: -1 } },
    { $limit: 30 },
  ]);

  if (dailyCounts.length < 3) return;

  const average   = dailyCounts.reduce((sum, item) => sum + item.count, 0) / dailyCounts.length;
  const threshold = Math.max(Math.ceil(average * 1.5), Math.ceil(average + 2), 5);
  const { start, end } = getDayRange(now, timezone);
  const todayCount = await Model.countDocuments({ ...baseTradeQuery(userId, collection, marketType), tradeDate: { $gte: start, $lt: end } });

  if (todayCount <= threshold) return;

  const dateKey = getLocalDateKey(now, timezone);
  const links   = getDeepLinks(trade, collection);
  const dedupeKey = `overtrading:${userId}:${marketType}:${dateKey}`;

  logDedupeKey({ userId, type: "overtrading", timezone, timestamp: now, dateKey, dedupeKey });

  await safeNotify(userId, {
    type:       "overtrading",
    title:      "Quality over quantity.",
    body:       `${todayCount} trades today — ${todayCount - Math.ceil(average)} above your average. Every extra trade is now emotional, not strategic. Protect what you've built.`,
    sourceType: "trade",
    sourceId:   trade._id,
    dedupeKey,
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
async function checkRepeatedMistake({ userId, trade, collection, marketType, timezone }) {
  const mistake = normalizeMistake(trade.mistakeTag);
  if (!mistake) return;

  const Model   = getTradeModel(collection);
  const timestamp = getTradeTimestamp(trade);
  const weekStart = getWeekStart(timestamp, timezone);
  const regex   = new RegExp(`^${String(trade.mistakeTag).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
  const count   = await Model.countDocuments({
    ...baseTradeQuery(userId, collection, marketType),
    tradeDate:  { $gte: weekStart },
    mistakeTag: regex,
  });
  if (count < 3) return;

  const weekKey     = getWeekKey(timestamp, timezone);
  const mistakeLabel = humanize(mistake);
  const dedupeKey = `repeated-mistake:${userId}:${marketType}:${weekKey}:${mistake}`;

  logDedupeKey({ userId, type: "repeated_mistake", timezone, timestamp, dateKey: weekKey, dedupeKey });

  await safeNotify(userId, {
    type:       "repeated_mistake",
    title:      "Pattern detected. Time to break it.",
    body:       `"${mistakeLabel}" has appeared ${count}× this week. Top traders eliminate one error pattern per week. This is yours.`,
    sourceType: "trade",
    sourceId:   trade._id,
    dedupeKey,
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
async function checkDailyLossWarning({ userId, trade, collection, marketType, timezone }) {
  if (Number(trade.profit) >= 0) return;

  const Model = getTradeModel(collection);
  const timestamp = getTradeTimestamp(trade);
  const { start, end } = getDayRange(timestamp, timezone);

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

  const dateKey = getLocalDateKey(timestamp, timezone);
  const links   = getDeepLinks(trade, collection);
  const dedupeKey = `daily-loss:${userId}:${marketType}:${dateKey}`;

  logDedupeKey({ userId, type: "daily_loss_warning", timezone, timestamp, dateKey, dedupeKey });

  await safeNotify(userId, {
    type:       "daily_loss_warning",
    title:      "Capital protection mode.",
    body:       `Today's drawdown: ${totalLoss.toFixed(2)}. You're approaching your daily limit. One more bad trade could set back a week of gains. Consider stopping here.`,
    sourceType: "trade",
    sourceId:   trade._id,
    dedupeKey,
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
async function checkConfidenceReminder({ userId, trade, collection, marketType, timezone }) {
  // Fire after a winning trade to reinforce discipline — not every win, ~1 per session
  if (Number(trade.profit) <= 0) return;

  const score = Number(trade.setupScore);
  // Only reinforce when the user followed their checklist well
  if (!Number.isFinite(score) || score < 70) return;

  const timestamp = getTradeTimestamp(trade);
  const { start, end } = getDayRange(timestamp, timezone);
  const Model = getTradeModel(collection);
  const winCount = await Model.countDocuments({
    ...baseTradeQuery(userId, collection, marketType),
    tradeDate: { $gte: start, $lt: end },
    profit:    { $gt: 0 },
    setupScore: { $gte: 70 },
  });

  // Send once per session after the 2nd disciplined win
  if (winCount !== 2) return;

  const dateKey = getLocalDateKey(timestamp, timezone);
  const links   = getDeepLinks(trade, collection);
  const dedupeKey = `confidence:${userId}:${marketType}:${dateKey}`;

  logDedupeKey({ userId, type: "confidence_reminder", timezone, timestamp, dateKey, dedupeKey });

  await safeNotify(userId, {
    type:       "confidence_reminder",
    title:      "Discipline is working.",
    body:       "2 quality setups followed perfectly today. Good setups need patience, not speed. Keep this standard.",
    sourceType: "trade",
    sourceId:   trade._id,
    dedupeKey,
    deepLink:   links.analytics,
    data: {
      screen:   collection === "indian" ? "indian-trades" : "trades",
      winCount: String(winCount),
    },
  });
}

// ─── Main evaluator ───────────────────────────────────────────────────────────
async function evaluateSmartNotifications({ userId, trade, marketType = "Forex", collection = "forex", timezone }) {
  if (!userId || !trade || !trade._id) return;
  const plainTrade = typeof trade.toObject === "function" ? trade.toObject() : trade;
  const notificationTimezone = getNotificationTimezone(timezone);
  const payload = { userId, trade: plainTrade, collection, marketType, timezone: notificationTimezone };

  // Synchronous checks — fast, no DB-heavy aggregations; run before responding.
  await Promise.allSettled([
    checkNoStopLoss(payload),
    checkSetupDisciplineDrop(payload),
    checkMoodBasedRisk(payload),
  ]);

  // Heavy async checks — handed off to BullMQ. Survives restart, retries on
  // failure, exposes queue depth + failure metrics. Lazy-required to avoid
  // forcing the queue connection in test environments that import this file.
  try {
    const { enqueueSmartNotificationChecks } = require("../queues/smartNotificationQueue");
    await enqueueSmartNotificationChecks({
      userId,
      tradeId:    plainTrade._id?.toString?.() || plainTrade._id,
      collection,
      marketType,
      timezone:   notificationTimezone,
    });
  } catch (error) {
    // Never block the trade-save path on queue failure. The notification miss
    // is logged; trade still saves successfully.
    logger.error("SMART_QUEUE_ENQUEUE_FAILED", {
      userId: userId?.toString?.(),
      tradeId: plainTrade._id?.toString?.(),
      error: error?.message,
    });
  }
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
  runAsyncChecks,
  notifyWeeklyInsight,
};
