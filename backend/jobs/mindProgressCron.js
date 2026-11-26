const cron = require("node-cron");
const { appConfig } = require("../config");
const MindProfile = require("../models/MindProfile");
const MindMilestone = require("../models/MindMilestone");
const MindTarget = require("../models/MindTarget");
const notificationService = require("../services/notificationService");
const mindProgressService = require("../services/mindProgress.service");
const copy = require("../utils/mindProgressCopy");
const { addDays } = require("../utils/mindProgress");
const { runLocalTimeJob } = require("../services/localTimeJobRunner");
const { LOCAL_TIME_TICK, parseLocalTime } = require("../utils/localTimeSchedule");
const { getLocalDateKey } = require("../utils/timezone");
const { logger } = require("../utils/logger");

const CRON_NAME = "mindProgressCron";
const LOCK_NAME = "mind-progress";
const DEFAULT_TARGET = { hour: 8, minute: 0 };
const ACTIVE_WITHIN_DAYS = 30;
const FRESH_START_ACTIVE_DAYS = 14;
const WIN_PUSH_MAX_AGE_DAYS = 3;

let isRunning = false;

// Highest-signal event first. Only one Mind push per user per local day, and
// never for a slip, a score drop or a missed day: those stay in the app.
const WIN_PRIORITY = (m) => (/^level_/.test(m.key) ? 0 : m.key === "first_report" ? 2 : 1);

function isMonday(dayKey) {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 1;
}

async function send(userId, type, rendered, dedupeKey, data) {
  if (!rendered) return null;
  // No deepLink: older app builds have no /progress page. They resolve the
  // unknown `screen` to their dashboard; current builds map it to /progress.
  return notificationService.notifyUser(userId, {
    type,
    title: rendered.title,
    body: rendered.body,
    sourceType: "mind",
    dedupeKey,
    data: { screen: "mind-progress", ...data },
  });
}

async function pickAndSendPush(userId, today) {
  const profile = await MindProfile.findOne({ user: userId }).lean();
  if (!profile || profile.lastPushDay === today) return { skipped: "already_pushed_today" };

  const since = addDays(today, -WIN_PUSH_MAX_AGE_DAYS);
  const unseen = await MindMilestone.find({
    user: userId, silent: false, seenAt: null, notifiedAt: null, day: { $gte: since },
  }).limit(20).lean();
  unseen.sort((a, b) => WIN_PRIORITY(a) - WIN_PRIORITY(b) || String(a.earnedAt).localeCompare(String(b.earnedAt)));

  let sent = null;
  let kind = null;
  const win = unseen[0];
  if (win) {
    const level = /^level_(\d)$/.exec(win.key);
    const type = level ? "mind_level_up" : win.key === "first_report" ? "mind_report_ready" : "mind_win";
    const rendered = level ? copy.renderPush("mind_level_up", win.evidence) : win.key === "first_report"
      ? copy.renderPush("mind_report_ready") : copy.renderPush("mind_win", win);
    sent = await send(userId, type, rendered, `mind:${userId}:${win.key}:${win.periodKey}`, { kind: type, milestoneId: String(win._id) });
    if (sent) await MindMilestone.updateOne({ _id: win._id }, { $set: { notifiedAt: new Date() } });
    kind = type;
  } else {
    const target = await MindTarget.findOne({ user: userId, status: "active" }).lean();
    if (target && target.endDay >= today && target.cleanDays === (target.goal || 5) - 1) {
      const label = copy.renderTargetLabel(target.preset, target.params);
      sent = await send(userId, "mind_target", copy.renderPush("mind_target", { label, cleanDays: target.cleanDays, goal: target.goal }),
        `mind:${userId}:target-near:${target._id}`, { kind: "target_near", targetId: String(target._id) });
      kind = "target_near";
    } else if (!target && isMonday(today) && profile.lastJournaledDay && profile.lastJournaledDay >= addDays(today, -FRESH_START_ACTIVE_DAYS)) {
      let suggestion = null;
      try {
        const { suggestions } = await mindProgressService.getSuggestions(userId);
        suggestion = suggestions[0]?.label || null;
      } catch { /* the generic variant still works */ }
      sent = await send(userId, "mind_target", copy.renderPush("mind_fresh_start", { suggestion }, `${userId}:${today}`),
        `mind:${userId}:fresh-start:${today}`, { kind: "fresh_start" });
      kind = "fresh_start";
    }
  }

  if (sent) await MindProfile.updateOne({ user: userId }, { $set: { lastPushDay: today } });
  return { sent: Boolean(sent), kind };
}

async function processUser(user, { timezone, now }) {
  const userId = String(user._id);
  const today = getLocalDateKey(now, timezone);
  await mindProgressService.recompute(userId, { source: "cron", now });
  try {
    await mindProgressService.ensureInsight(userId, { now });
  } catch (error) {
    logger.warn(`[${CRON_NAME}] insight failed`, { userId, error: error?.message });
  }
  return pickAndSendPush(userId, today);
}

// Only users who journaled recently: everyone else has nothing new to finalise.
async function filterActiveUsers(users) {
  if (!users.length) return users;
  const cutoff = new Date(Date.now() - ACTIVE_WITHIN_DAYS * 86400000);
  const active = await MindProfile.distinct("user", {
    user: { $in: users.map((u) => u._id) },
    lastComputedAt: { $gte: cutoff },
  });
  const ids = new Set(active.map(String));
  return users.filter((u) => ids.has(String(u._id)));
}

async function runMindProgressJob(now = new Date()) {
  if (isRunning) {
    logger.warn(`[${CRON_NAME}] previous run still in progress; skipping`);
    return null;
  }
  isRunning = true;
  try {
    return await runLocalTimeJob({
      name: CRON_NAME,
      lockName: LOCK_NAME,
      target: parseLocalTime(appConfig.mindProgress?.localTime, DEFAULT_TARGET),
      filterUsers: filterActiveUsers,
      // Low on purpose: the API box has <1 GB RAM and each user loads up to
      // ~44 days of trades.
      concurrency: appConfig.mindProgress?.concurrency || 10,
      now,
      work: processUser,
    });
  } finally {
    isRunning = false;
  }
}

function startMindProgressCron() {
  if (!appConfig.mindProgress?.enabled || !appConfig.mindProgress?.cronEnabled) {
    logger.info(`[${CRON_NAME}] disabled`);
    return;
  }
  cron.schedule(LOCAL_TIME_TICK, () => {
    runMindProgressJob().catch((error) =>
      logger.error(`[${CRON_NAME}] job error`, { error: error?.message, stack: error?.stack })
    );
  });
  logger.info(`[${CRON_NAME}] scheduled`, { tick: LOCAL_TIME_TICK, localTime: appConfig.mindProgress?.localTime || "08:00" });
}

module.exports = {
  filterActiveUsers,
  pickAndSendPush,
  processUser,
  runMindProgressJob,
  startMindProgressCron,
};
