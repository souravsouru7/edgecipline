
const mongoose = require("mongoose");
const DailyReflection = require("../models/DailyReflection");
const Trade = require("../models/Trade");
const IndianTrade = require("../models/IndianTrade");
const streakService = require("./streak.service");
const ApiError = require("../utils/ApiError");
const { logger } = require("../utils/logger");

const WEEKLY_WINDOW_DAYS = 7;
const HISTORY_HARD_CAP_DAYS = 90;

// ─── Day helpers (delegate to streak service so timezones stay aligned) ──────
const { dayKeyInTz, addDays } = streakService;

function isValidDayKey(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function resolveDay(userId, requestedDay) {
  if (isValidDayKey(requestedDay)) return { day: requestedDay, tz: null };
  // streak.service.getStreakSnapshot already resolves the user's TZ + todayKey
  // using the same precedence chain (NotificationPreference → User.streaks).
  const snapshot = await streakService.getStreakSnapshot(userId);
  return {
    day: snapshot?.todayKey || dayKeyInTz(new Date()),
    tz: snapshot?.timezone || null,
  };
}

// ─── Trade context — what happened on this day? ──────────────────────────────
async function loadTradeContextForDay(userId, day, tz) {
  // We bucket trades by user-local day, matching the streak/daily-discipline
  // convention. UTC ranges are widened by one calendar day each side so
  // boundary trades show up regardless of timezone offset.
  const [y, m, d] = day.split("-").map(Number);
  const utcMid = Date.UTC(y, m - 1, d);
  const start = new Date(utcMid - 24 * 60 * 60 * 1000);
  const end = new Date(utcMid + 2 * 24 * 60 * 60 * 1000);

  const fields = {
    profit: 1,
    tradeDate: 1,
    createdAt: 1,
    setupRules: 1,
  };

  const baseQuery = {
    user: userId,
    deletedAt: null,
    $or: [
      { tradeDate: { $gte: start, $lt: end } },
      { tradeDate: null, createdAt: { $gte: start, $lt: end } },
    ],
  };

  const [forex, indian] = await Promise.all([
    Trade.find(
      { ...baseQuery, "parsedData.multiTradeGhost": { $ne: true } },
      fields
    ).lean(),
    IndianTrade.find(baseQuery, fields).lean(),
  ]);

  const allTrades = [...forex, ...indian];

  // Filter to the user-local day. Trades whose tradeDate maps to a different
  // local day are dropped (handles back-logged trades + UTC-skew boundaries).
  const inDay = allTrades.filter((trade) => {
    const moment = trade.tradeDate || trade.createdAt;
    return dayKeyInTz(moment, tz || undefined) === day;
  });

  const grossPnL = Math.round(
    inDay.reduce((sum, trade) => sum + (Number(trade.profit) || 0), 0) * 100
  ) / 100;

  const followedChecklist = inDay.some(
    (trade) => Array.isArray(trade.setupRules) && trade.setupRules.length > 0
  );

  return {
    tradeCount: inDay.length,
    hadTrades: inDay.length > 0,
    grossPnL,
    followedChecklist,
  };
}

// ─── Reads ───────────────────────────────────────────────────────────────────
async function getReflectionForDay(userId, day) {
  return DailyReflection.findOne({ user: userId, day }).lean();
}

async function getTodayContext(userId) {
  const { day, tz } = await resolveDay(userId);
  const [reflection, context] = await Promise.all([
    getReflectionForDay(userId, day),
    loadTradeContextForDay(userId, day, tz),
  ]);
  return {
    day,
    timezone: tz,
    context,
    reflection: reflection || null,
    completed: Boolean(reflection && !reflection.skipped),
    skipped: Boolean(reflection?.skipped),
  };
}

async function getRecentReflections(userId, days = 14) {
  const lookback = Math.min(Math.max(Number(days) || 14, 1), HISTORY_HARD_CAP_DAYS);
  const snapshot = await streakService.getStreakSnapshot(userId);
  const today = snapshot?.todayKey || dayKeyInTz(new Date());
  const earliest = addDays(today, -(lookback - 1));

  const items = await DailyReflection.find({
    user: userId,
    day: { $gte: earliest, $lte: today },
  })
    .sort({ day: -1 })
    .lean();

  return { items, range: { from: earliest, to: today }, days: lookback };
}

// ─── Weekly score ────────────────────────────────────────────────────────────
// 0–100 composite over the rolling 7-day window. Weights chosen so a single
// great day cannot mask a missed week, and so skipping isn't punished as
// harshly as logging "I broke my plan":
//
//   plan adherence (40)   yes=10 | partly=5 | no=0 | no_trades=8 | skipped/missing=0
//   would-repeat   (20)   yes=10 | partly=5 | no=0 | missing=0
//   mood/conf avg  (20)   normalised 1–5 → 0–10
//   completion     (20)   submitted-not-skipped days / 7
//
// We always divide by 7 (not "days with data") so users see real progress when
// they reflect more often.
function computeWeeklyScore(reflections) {
  const window = reflections.slice(0, WEEKLY_WINDOW_DAYS);
  if (window.length === 0) {
    return {
      score: 0,
      completionRate: 0,
      submittedDays: 0,
      skippedDays: 0,
      window: WEEKLY_WINDOW_DAYS,
      breakdown: { plan: 0, repeat: 0, mood: 0, completion: 0 },
    };
  }

  let planSum = 0, planCount = 0;
  let repeatSum = 0, repeatCount = 0;
  let moodConfSum = 0, moodConfCount = 0;
  let submitted = 0, skipped = 0;

  for (const r of window) {
    if (r.skipped) { skipped += 1; continue; }
    submitted += 1;

    const plan = ({ yes: 10, partly: 5, no: 0, no_trades: 8 })[r.followedPlan];
    if (plan !== undefined) { planSum += plan; planCount += 1; }

    const repeat = ({ yes: 10, partly: 5, no: 0 })[r.wouldRepeat];
    if (repeat !== undefined) { repeatSum += repeat; repeatCount += 1; }

    const mood = Number(r.mood);
    const conf = Number(r.confidence);
    if (Number.isFinite(mood)) { moodConfSum += ((mood - 1) / 4) * 10; moodConfCount += 1; }
    if (Number.isFinite(conf)) { moodConfSum += ((conf - 1) / 4) * 10; moodConfCount += 1; }
  }

  const plan       = planCount   ? planSum   / planCount   : 0;             // 0–10
  const repeat     = repeatCount ? repeatSum / repeatCount : 0;             // 0–10
  const moodConf   = moodConfCount ? moodConfSum / moodConfCount : 0;       // 0–10
  const completion = submitted / WEEKLY_WINDOW_DAYS;                        // 0–1

  const score = Math.round(
    (plan / 10) * 40 +
    (repeat / 10) * 20 +
    (moodConf / 10) * 20 +
    completion * 20
  );

  return {
    score: Math.max(0, Math.min(100, score)),
    completionRate: Math.round(completion * 100),
    submittedDays: submitted,
    skippedDays: skipped,
    window: WEEKLY_WINDOW_DAYS,
    breakdown: {
      plan:       Math.round(plan * 10) / 10,
      repeat:     Math.round(repeat * 10) / 10,
      mood:       Math.round(moodConf * 10) / 10,
      completion: Math.round(completion * 100),
    },
  };
}

async function getWeeklySummary(userId) {
  const { items } = await getRecentReflections(userId, WEEKLY_WINDOW_DAYS);
  const weekly = computeWeeklyScore(items);
  const latestWithInsight = items.find((r) => r.aiInsight);
  return {
    weekly,
    latestInsight: latestWithInsight
      ? {
          day: latestWithInsight.day,
          insight: latestWithInsight.aiInsight,
          model: latestWithInsight.aiInsightModel || null,
          fallback: Boolean(latestWithInsight.aiInsightFallback),
          generatedAt: latestWithInsight.aiInsightGeneratedAt || null,
        }
      : null,
  };
}

// ─── Writes ──────────────────────────────────────────────────────────────────
function sanitizeUpdateFields(payload) {
  const update = {};
  if (payload.followedPlan !== undefined) update.followedPlan = payload.followedPlan;
  if (payload.mood !== undefined)         update.mood = payload.mood;
  if (payload.confidence !== undefined)   update.confidence = payload.confidence;
  if (payload.wouldRepeat !== undefined)  update.wouldRepeat = payload.wouldRepeat;
  if (payload.improvement !== undefined)  update.improvement = String(payload.improvement || "").slice(0, 280);
  if (payload.market !== undefined)       update.market = payload.market;
  return update;
}

async function upsertReflection({ userId, payload = {} }) {
  if (!userId) throw new ApiError(400, "userId required", "VALIDATION_ERROR");
  const { day, tz } = await resolveDay(userId, payload.day);
  const context = await loadTradeContextForDay(userId, day, tz);

  const updates = sanitizeUpdateFields(payload);
  if (Object.keys(updates).length === 0 && payload.followedPlan === undefined) {
    throw new ApiError(400, "Reflection must include at least one field", "VALIDATION_ERROR");
  }

  // Backfill followedPlan='no_trades' when the user didn't trade and didn't
  // explicitly answer — keeps the weekly score honest about quiet days.
  if (!updates.followedPlan && !context.hadTrades) {
    updates.followedPlan = "no_trades";
  }

  const source = payload.source === "notification" ? "notification" : "manual";

  const reflection = await DailyReflection.findOneAndUpdate(
    { user: userId, day },
    {
      $set: {
        ...updates,
        context,
        skipped: false,
        source,
      },
      $setOnInsert: { user: userId, day },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true, lean: true }
  );

  logger.info("REFLECTION_SUBMITTED", {
    userId: String(userId),
    day,
    followedPlan: reflection.followedPlan || null,
    hadTrades: context.hadTrades,
    source,
  });

  return { reflection, context, day, timezone: tz };
}

async function skipReflection({ userId, payload = {} }) {
  if (!userId) throw new ApiError(400, "userId required", "VALIDATION_ERROR");
  const { day, tz } = await resolveDay(userId, payload.day);
  const context = await loadTradeContextForDay(userId, day, tz);
  const source = payload.source === "notification" ? "notification" : "manual";

  const reflection = await DailyReflection.findOneAndUpdate(
    { user: userId, day },
    {
      $set: { skipped: true, context, source },
      $setOnInsert: { user: userId, day, market: payload.market || "any" },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true, lean: true }
  );

  logger.info("REFLECTION_SKIPPED", { userId: String(userId), day, source });
  return { reflection, context, day, timezone: tz };
}

async function attachAiInsight(reflectionId, { insight, model, fallback }) {
  if (!mongoose.Types.ObjectId.isValid(reflectionId)) return null;
  const trimmed = String(insight || "").slice(0, 280);
  if (!trimmed) return null;
  return DailyReflection.findByIdAndUpdate(
    reflectionId,
    {
      $set: {
        aiInsight: trimmed,
        aiInsightModel: model || "",
        aiInsightFallback: Boolean(fallback),
        aiInsightGeneratedAt: new Date(),
      },
    },
    { new: true, lean: true }
  );
}

module.exports = {
  WEEKLY_WINDOW_DAYS,
  attachAiInsight,
  computeWeeklyScore,
  getRecentReflections,
  getReflectionForDay,
  getTodayContext,
  getWeeklySummary,
  loadTradeContextForDay,
  resolveDay,
  skipReflection,
  upsertReflection,
};
