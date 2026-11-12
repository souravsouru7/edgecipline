"use strict";

/**
 * Mission Progress Cron
 *
 * Runs daily (default 21:30 IST) to:
 *   1. Evaluate day-based missions (no_revenge_trade, trade_logged, daily_loss_limit, no_fomo_trade)
 *   2. Send morning mission reminders to users with active missions
 *   3. Expire overdue missions
 *
 * Uses the DailyDisciplineEntry + DailyReflection collections to reconstruct
 * each user's trading day without re-running heavy analytics.
 */

const cron = require("node-cron");
const User = require("../models/Users");
const MissionAssignment = require("../models/MissionAssignment");
const DailyDisciplineEntry = require("../models/DailyDisciplineEntry");
const Trade = require("../models/Trade");
const IndianTrade = require("../models/IndianTrade");
const { evaluateDayBasedMissions } = require("../services/missionProgressService");
const { sendMorningMissionReminders } = require("../services/missionNotificationService");
const { expireOldMissions, getActiveMissions } = require("../services/missionService");
const { logger } = require("../utils/logger");
const { appConfig } = require("../config");
const { withCronLock } = require("../utils/distributedLock");
const { getDayRange, zonedTimeToUtc } = require("../utils/timezone");

const DEFAULT_TIMEZONE = "Asia/Kolkata";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dayKeyInTz(date, tz = DEFAULT_TIMEZONE) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date instanceof Date ? date : new Date(date));
}

function previousDayKey(tz = DEFAULT_TIMEZONE) {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return dayKeyInTz(yesterday, tz);
}

// The day key is an IST calendar date, so its bounds must be IST midnight to
// midnight. They used to be UTC midnights, putting 00:00–05:30 IST trades on
// the wrong day.
function dayBoundsInTz(dayKey, tz = DEFAULT_TIMEZONE) {
  const [year, month, day] = dayKey.split("-").map(Number);
  return getDayRange(zonedTimeToUtc({ year, month, day, hour: 12, minute: 0, second: 0 }, tz), tz);
}

async function buildDayData(userId, dayKey) {
  const { start, end } = dayBoundsInTz(dayKey);
  const inRange = { $gte: start, $lt: end };
  // When the trade happened; fall back to when it was saved only if no
  // tradeDate (a back-dated trade saved yesterday belongs to its own day).
  const dateFilter = { $or: [{ tradeDate: inRange }, { tradeDate: null, createdAt: inRange }] };

  const [forexTrades, indianTrades, disciplineEntries, limitsDoc] = await Promise.all([
    Trade.find({ user: userId, deletedAt: null, "parsedData.multiTradeGhost": { $ne: true }, ...dateFilter })
      .select("profit notes stopLoss riskPercent tradeDate createdAt").lean(),
    IndianTrade.find({ user: userId, deletedAt: null, ...dateFilter })
      .select("profit notes stopLoss riskPercent tradeDate createdAt").lean(),
    DailyDisciplineEntry.find({ user: userId, day: dayKey }).lean(),
    // A failed read must not fail the whole day's evaluation.
    User.findById(userId).select("riskLimits").lean().catch(() => null),
  ]);

  const sumPnl = (list) => list.reduce((s, t) => s + (Number.isFinite(t.profit) ? t.profit : 0), 0);
  const limitOf = (market) => {
    const n = Number(limitsDoc?.riskLimits?.[market]?.dailyLossLimit);
    return limitsDoc?.riskLimits?.[market]?.dailyLossLimit != null && Number.isFinite(n) && n > 0 ? n : null;
  };
  // Each market against its own limit, in its own currency.
  const marketChecks = [
    { market: "Forex", tradeCount: forexTrades.length, pnl: sumPnl(forexTrades), limit: limitOf("Forex") },
    { market: "Indian_Market", tradeCount: indianTrades.length, pnl: sumPnl(indianTrades), limit: limitOf("Indian_Market") },
  ];

  const trades = [...forexTrades, ...indianTrades];
  const tradeCount = trades.length;
  const satOut = disciplineEntries.some(e => e.noTradeToday);

  // Revenge trade detection: trade placed < 30 min after a losing trade
  const sorted = trades.sort((a, b) => {
    const da = new Date(a.tradeDate || a.createdAt).getTime();
    const db = new Date(b.tradeDate || b.createdAt).getTime();
    return da - db;
  });
  let hasRevengeTrade = false;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    if (Number.isFinite(prev.profit) && prev.profit < 0) {
      const prevTime = new Date(prev.tradeDate || prev.createdAt).getTime();
      const currTime = new Date(sorted[i].tradeDate || sorted[i].createdAt).getTime();
      if (currTime - prevTime < 30 * 60 * 1000) {
        hasRevengeTrade = true;
        break;
      }
    }
  }

  const hasFomoTrade = trades.some(t => t.notes && /\bfomo\b/i.test(t.notes));
  const dailyPnl = trades.reduce((s, t) => s + (Number.isFinite(t.profit) ? t.profit : 0), 0);

  return { tradeCount, satOut, hasRevengeTrade, hasFomoTrade, dailyPnl, dailyLossLimit: null, marketChecks };
}

// ─── Daily evaluation sweep ───────────────────────────────────────────────────

async function runDailyEvaluation() {
  logger.info("[MissionCron] Starting daily evaluation");
  let processed = 0;
  let errors = 0;

  // Find all users with active day-based missions
  const dayMissionUsers = await MissionAssignment.distinct("user", {
    status: "active",
    "missionSnapshot.progressMode": { $in: ["consecutive_days", "total_days"] },
  });

  const dayKey = previousDayKey(DEFAULT_TIMEZONE);

  for (const userId of dayMissionUsers) {
    try {
      const dayData = await buildDayData(userId, dayKey);
      await evaluateDayBasedMissions(userId, dayKey, dayData);
      processed++;
    } catch (err) {
      errors++;
      logger.error("[MissionCron] Day evaluation error", { userId, dayKey, error: err.message });
    }
  }

  logger.info("[MissionCron] Daily evaluation complete", { processed, errors, dayKey });
}

// ─── Morning mission reminders ────────────────────────────────────────────────

async function sendMorningReminders() {
  logger.info("[MissionCron] Sending morning mission reminders");
  let sent = 0;

  const usersWithMissions = await MissionAssignment.distinct("user", { status: "active" });

  for (const userId of usersWithMissions) {
    try {
      const missions = await getActiveMissions(userId);
      if (missions.length > 0) {
        await sendMorningMissionReminders(userId, missions);
        sent++;
      }
    } catch (err) {
      logger.warn("[MissionCron] Morning reminder error", { userId, error: err.message });
    }
  }

  logger.info("[MissionCron] Morning reminders sent", { sent });
}

// ─── Cron registration ────────────────────────────────────────────────────────

let dailyJob = null;
let morningJob = null;

// One run per job per IST day across instances, held for the day: the mission
// cron had no lock, and a duplicate evaluation run is exactly what produced
// the false "Mission Reset" pushes.
const MISSION_LOCK_TTL_SECONDS = 20 * 60 * 60;

async function runLocked(name, fn) {
  const lockSuffix = new Intl.DateTimeFormat("en-CA", { timeZone: DEFAULT_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const result = await withCronLock({ name, lockSuffix, ttlSeconds: MISSION_LOCK_TTL_SECONDS, holdUntilExpiry: true }, fn);
  if (result.skipped) logger.info(`[MissionCron] ${name} already ran today; skipping`, { key: result.key });
  return result;
}

function startMissionProgressCron() {
  if (!appConfig.missions?.enabled) {
    logger.info("[MissionCron] disabled by ENABLE_MISSION_CRON");
    return { dailyJob: null, morningJob: null };
  }
  // Daily evaluation at 21:30 IST (16:00 UTC)
  dailyJob = cron.schedule(
    "0 30 21 * * *",
    async () => {
      try {
        await runLocked("mission-daily", async () => {
          await runDailyEvaluation();
          await expireOldMissions();
        });
      } catch (err) {
        logger.error("[MissionCron] Daily job error", { error: err.message });
      }
    },
    { timezone: DEFAULT_TIMEZONE }
  );

  // Morning reminders at 7:30 IST
  morningJob = cron.schedule(
    "0 30 7 * * *",
    async () => {
      try {
        await runLocked("mission-morning", () => sendMorningReminders());
      } catch (err) {
        logger.error("[MissionCron] Morning reminder job error", { error: err.message });
      }
    },
    { timezone: DEFAULT_TIMEZONE }
  );

  logger.info("[MissionCron] Mission cron jobs started");
  return { dailyJob, morningJob };
}

function stopMissionProgressCron() {
  if (dailyJob) { dailyJob.stop(); dailyJob = null; }
  if (morningJob) { morningJob.stop(); morningJob = null; }
}

module.exports = {
  startMissionProgressCron,
  stopMissionProgressCron,
  runDailyEvaluation,
  sendMorningReminders,
  buildDayData,
};
