/**
 * Mind Score service: loads the journal, runs the pure engine
 * (utils/mindProgress), persists the result, and builds the views the app
 * reads (instant reward sheet, dashboard card, progress page).
 *
 * Write path: `recompute(userId)` rebuilds the trailing RECOMPUTE_DAYS of
 * daily rows from source data on every journal event. Rebuilding a bounded
 * window (instead of patching "the affected day") is what makes backdated
 * trades, edits, deletes and bulk imports correct without bookkeeping.
 *
 * Nothing here may decide whether a trade save succeeds: hooks call in after
 * the response (mindProgressHooks) and every caller tolerates failure.
 */

const mongoose = require("mongoose");
const Trade = require("../models/Trade");
const IndianTrade = require("../models/IndianTrade");
const DailyReflection = require("../models/DailyReflection");
const MindScoreDaily = require("../models/MindScoreDaily");
const MindProfile = require("../models/MindProfile");
const MindMilestone = require("../models/MindMilestone");
const MindTarget = require("../models/MindTarget");
const MindInsight = require("../models/MindInsight");
const streakService = require("./streak.service");
const engine = require("../utils/mindProgress");
const copy = require("../utils/mindProgressCopy");
const { appConfig } = require("../config");
const { withTimeout } = require("../utils/withTimeout");
const { acquireLock, releaseLock } = require("../utils/distributedLock");
const { logger } = require("../utils/logger");
const { getNetPnL } = require("../utils/metricEngine");
const ApiError = require("../utils/ApiError");

const FIRST_RUN_LOOKBACK_DAYS = 90;
const TRADE_LOAD_CAP = 3000;
const LOCK_TTL_SECONDS = 30;
const REDIS_BUDGET_MS = 1000;
const MICRO_BUDGET_MS = 2500;
const SERIES_DAYS = 30;
const CELEBRATION_WINDOW_DAYS = 3;
// Popups per visit. More than this is noise; the rest surface on later visits
// (inside the window) and always sit on the progress-page shelf.
const CELEBRATIONS_PER_VIEW = 2;

const TRADE_FIELDS = {
  _id: 1, pair: 1, underlying: 1, stockSymbol: 1, profit: 1, tradeDate: 1, effectiveTradeDate: 1,
  createdAt: 1, emotionalTags: 1, mistakeTag: 1, entryBasis: 1, confidence: 1, mood: 1,
  setupScore: 1, setupRules: 1, tradeQuality: 1, wouldRetake: 1, marketType: 1,
  // Needed for NET P&L: Indian `profit` is stored gross (see getNetPnL).
  brokerage: 1, sttTaxes: 1, commission: 1, swap: 1,
};

// ─── Time helpers (user-local day keys, aligned with streaks/reflections) ───

const { dayKeyInTz } = streakService;
const { addDays, diffDays } = engine;

function localMinutes(date, timezone) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(date);
    const h = Number(parts.find((p) => p.type === "hour")?.value);
    const m = Number(parts.find((p) => p.type === "minute")?.value);
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
  } catch {
    return null;
  }
}

function isoDayToUtcStart(dayKey) {
  // Earliest instant any timezone could call this day: UTC midnight minus 14h.
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - 14 * 3600 * 1000);
}

// ─── Normalisation ───────────────────────────────────────────────────────────

function normaliseTags(list) {
  const tags = [];
  const tagLabels = {};
  for (const raw of Array.isArray(list) ? list : []) {
    const label = String(raw || "").trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (!tagLabels[key]) {
      tags.push(key);
      tagLabels[key] = label;
    }
  }
  return { tags, tagLabels };
}

function normaliseTrade(doc, market, timezone, today) {
  const when = doc.effectiveTradeDate || doc.tradeDate || doc.createdAt;
  const date = when ? new Date(when) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  const day = dayKeyInTz(date, timezone);
  if (!day || day > today) return null;
  const minutes = localMinutes(date, timezone);
  const { tags, tagLabels } = normaliseTags(doc.emotionalTags);
  const indian = market === "Indian_Market";
  const instrument = indian
    ? String(doc.underlying || doc.stockSymbol || doc.pair || "").trim().toUpperCase()
    : String(doc.pair || "").trim().toUpperCase();
  // Net, per the app-wide P&L convention: Forex profit is already net at save
  // time; Indian profit is gross, so brokerage + STT come off here. A missing
  // profit stays null — never invent a loss on a trade with no P&L recorded.
  const hasProfit = doc.profit !== null && doc.profit !== undefined && doc.profit !== "" && Number.isFinite(Number(doc.profit));
  const profit = hasProfit ? getNetPnL(doc, market) : null;
  return {
    id: String(doc._id),
    day,
    ts: date.getTime(),
    createdTs: doc.createdAt ? new Date(doc.createdAt).getTime() : 0,
    // Date-only entries land on local midnight; their order within the day is
    // unknown, so the 15-minute re-entry rule must not use them.
    hasTime: minutes != null && minutes !== 0,
    market,
    currency: indian ? "INR" : "USD",
    profit: Number.isFinite(profit) ? Math.round(profit * 100) / 100 : null,
    instrument: instrument || null,
    tags,
    tagLabels,
    mistake: String(doc.mistakeTag || "").trim().toLowerCase(),
    entryBasis: doc.entryBasis || "",
    confidence: doc.confidence || "",
    mood: Number.isFinite(Number(doc.mood)) && doc.mood != null ? Number(doc.mood) : null,
    setupScore: Number.isFinite(Number(doc.setupScore)) && doc.setupScore != null ? Number(doc.setupScore) : null,
    rules: Array.isArray(doc.setupRules) ? doc.setupRules.map((r) => ({ label: r?.label, followed: Boolean(r?.followed) })) : [],
    raw: {
      tradeQuality: doc.tradeQuality, setupScore: doc.setupScore, entryBasis: doc.entryBasis,
      mood: doc.mood, emotionalTags: doc.emotionalTags, wouldRetake: doc.wouldRetake,
      confidence: doc.confidence, profit: Number.isFinite(profit) ? profit : null,
    },
  };
}

function normaliseReflection(doc) {
  return {
    day: doc.day,
    followedPlan: doc.followedPlan || null,
    mood: doc.mood ?? null,
    skipped: Boolean(doc.skipped),
  };
}

/**
 * Completed, visible trades from both markets + reflections, for local days
 * fromDay … today. Mirrors the visibility rules of the trade log: soft-deleted,
 * OCR drafts (pending/processing/failed) and legacy multi-trade ghosts are out.
 */
async function loadJournal(userId, fromDay, today, timezone) {
  const since = isoDayToUtcStart(fromDay);
  const user = new mongoose.Types.ObjectId(String(userId));
  const dateMatch = {
    $or: [
      { effectiveTradeDate: { $gte: since } },
      { effectiveTradeDate: null, tradeDate: { $gte: since } },
    ],
  };
  const [forex, indian, reflections] = await Promise.all([
    Trade.find({
      user,
      deletedAt: null,
      marketType: { $ne: "Indian_Market" },
      "parsedData.multiTradeGhost": { $ne: true },
      status: { $nin: ["pending", "processing", "failed"] },
      ...dateMatch,
    }).select(TRADE_FIELDS).sort({ effectiveTradeDate: -1 }).limit(TRADE_LOAD_CAP).lean(),
    IndianTrade.find({ user, deletedAt: null, ...dateMatch })
      .select(TRADE_FIELDS).sort({ effectiveTradeDate: -1 }).limit(TRADE_LOAD_CAP).lean(),
    DailyReflection.find({ user, day: { $gte: fromDay, $lte: today } })
      .select({ day: 1, followedPlan: 1, mood: 1, skipped: 1 }).lean(),
  ]);
  const trades = [];
  for (const doc of forex) {
    const t = normaliseTrade(doc, "Forex", timezone, today);
    if (t && t.day >= fromDay) trades.push(t);
  }
  for (const doc of indian) {
    const t = normaliseTrade(doc, "Indian_Market", timezone, today);
    if (t && t.day >= fromDay) trades.push(t);
  }
  return { trades, reflections: reflections.map(normaliseReflection) };
}

// ─── Redis lock (best-effort; Redis down → just run) ────────────────────────

function redis() {
  return require("../config/redis");
}

async function tryLock(userId) {
  try {
    return await withTimeout(acquireLock(`mind:lock:${userId}`, LOCK_TTL_SECONDS), "mindLockAcquire", REDIS_BUDGET_MS);
  } catch {
    return { acquired: true, token: null, degraded: true };
  }
}

async function markDirty(userId) {
  try {
    const { client, isRedisReady } = redis();
    if (!isRedisReady()) return;
    await withTimeout(client.set(`mind:dirty:${userId}`, "1", "EX", 120), "mindMarkDirty", REDIS_BUDGET_MS);
  } catch { /* the lock holder's run, or the next event, will catch up */ }
}

async function takeDirty(userId) {
  try {
    const { client, isRedisReady } = redis();
    if (!isRedisReady()) return false;
    return (await withTimeout(client.del(`mind:dirty:${userId}`), "mindTakeDirty", REDIS_BUDGET_MS)) > 0;
  } catch {
    return false;
  }
}

async function unlock(userId, token) {
  if (!token) return;
  try {
    await withTimeout(releaseLock(`mind:lock:${userId}`, token), "mindLockRelease", REDIS_BUDGET_MS);
  } catch { /* expires on its own */ }
}

// ─── Recompute ───────────────────────────────────────────────────────────────

function isDisabled() {
  return !appConfig.mindProgress?.enabled;
}

async function insertMilestone(userId, m) {
  try {
    const doc = await MindMilestone.create({ user: userId, ...m });
    return doc;
  } catch (error) {
    if (error?.code === 11000) return null; // already earned (or a concurrent run got there first)
    throw error;
  }
}

/**
 * Rebuild the trailing window for one user. Idempotent; safe to call from
 * hooks, the micro endpoint and the cron at the same time (lock + dirty flag).
 *
 * @returns {Promise<{skipped?: boolean, rows?: number}>}
 */
async function recompute(userId, { source = "unknown", now = new Date() } = {}) {
  if (isDisabled()) return { skipped: true, reason: "disabled" };
  const uid = String(userId);
  if (!mongoose.Types.ObjectId.isValid(uid)) throw new TypeError("valid userId required");

  const lock = await tryLock(uid);
  if (!lock.acquired) {
    await markDirty(uid);
    return { skipped: true, reason: "locked" };
  }
  try {
    let result = await recomputeUnlocked(uid, { source, now });
    // Another event landed while we were computing: run once more so the last
    // write always reflects the newest data.
    if (await takeDirty(uid)) result = await recomputeUnlocked(uid, { source: `${source}:dirty`, now: new Date() });
    return result;
  } finally {
    await unlock(uid, lock.token);
  }
}

async function recomputeUnlocked(uid, { source, now }) {
  const started = Date.now();
  const timezone = await streakService.getUserTimezone(uid);
  const today = dayKeyInTz(now, timezone);
  const profile = await MindProfile.findOne({ user: uid }).lean();
  const firstRun = !profile;
  const fromDay = addDays(today, -((firstRun ? FIRST_RUN_LOOKBACK_DAYS : engine.RECOMPUTE_DAYS) - 1));

  const prevRow = await MindScoreDaily.findOne({ user: uid, day: { $lt: fromDay } }).sort({ day: -1 }).lean();
  const { trades, reflections } = await loadJournal(uid, addDays(fromDay, -(engine.WINDOW_DAYS - 1)), today, timezone);

  const unlockedBefore = profile?.unlockedDay && profile.unlockedDay < fromDay ? profile.unlockedDay : null;
  const prev = prevRow
    ? {
      score: prevRow.score,
      level: prevRow.level,
      journaledDays: prevRow.journaledDays,
      unlockedDay: unlockedBefore,
      headlineType: prevRow.headlineType,
    }
    : { journaledDays: 0, unlockedDay: unlockedBefore };

  const { rows, state } = engine.buildDailyRows({ trades, reflections, fromDay, toDay: today, prev });

  // ── Persist daily rows (upsert computed days, drop days no longer journaled)
  const ops = rows.map((row) => ({
    updateOne: {
      filter: { user: uid, day: row.day },
      update: {
        $set: {
          score: row.score, raw: row.raw, delta: row.delta, level: row.level,
          components: row.components, coverage: row.coverage, missing: row.missing,
          reasons: row.reasons, headline: row.headline, headlineType: row.headlineType,
          trend: row.trend, stats: row.stats, journaledDays: row.journaledDays,
        },
        $setOnInsert: { user: uid, day: row.day },
      },
      upsert: true,
    },
  }));
  if (ops.length) await MindScoreDaily.bulkWrite(ops, { ordered: false });
  await MindScoreDaily.deleteMany({ user: uid, day: { $gte: fromDay, $lte: today, $nin: rows.map((r) => r.day) } });

  const lastRow = rows.length ? rows[rows.length - 1] : prevRow;
  const recentCutoff = addDays(today, -1);
  const silentFor = (day) => firstRun || day < recentCutoff;

  // ── Level-ups (first time each level is reached)
  let highest = profile?.highestLevel || 0;
  const unlockScore = rows.find((r) => r.unlockedToday)?.score ?? profile?.startingScore ?? null;
  for (const row of rows) {
    if (!row.level || row.level <= highest) continue;
    for (let lvl = Math.max(highest + 1, 2); lvl <= row.level; lvl += 1) {
      await insertMilestone(uid, {
        key: `level_${lvl}`, periodKey: "once", day: row.day,
        // The level you unlock AT is your starting point, not a level-up: it
        // goes on the shelf quietly and the unlock itself is the celebration.
        silent: row.unlockedToday || silentFor(row.day),
        evidence: { level: lvl, fromLevel: lvl - 1, startingScore: unlockScore, score: row.score },
      });
    }
    highest = row.level;
  }

  // ── Unlock ("first report")
  const unlockRow = rows.find((r) => r.unlockedToday);
  const startingScore = unlockRow ? unlockRow.score : profile?.startingScore ?? null;
  if (unlockRow) {
    await insertMilestone(uid, {
      key: "first_report", periodKey: "once", day: unlockRow.day,
      // On a first-ever compute over existing history, the unlock is still the
      // moment they meet the feature — celebrate it with their real numbers.
      silent: firstRun ? false : unlockRow.day < recentCutoff,
      evidence: { journaledDays: lastRow?.journaledDays || unlockRow.journaledDays, startingScore, score: lastRow?.score ?? unlockRow.score },
    });
  }

  // ── Personal-baseline wins, as of the latest journaled day
  let baselines = profile?.baselines || {};
  if (lastRow && rows.length && state.unlockedDay && lastRow.day >= recentCutoff) {
    const trend = engine.computeTrend(trades, reflections, lastRow.day);
    const detected = engine.detectWins({
      trades: trades.filter((t) => t.day <= lastRow.day),
      reflections: reflections.filter((r) => r.day <= lastRow.day),
      today: lastRow.day,
      trend,
      baselines,
      selfAwareness: lastRow.stats?.selfAwareness || null,
      recoveryRate: lastRow.stats?.recoveryRate ?? null,
    });
    for (const win of detected.wins) {
      await insertMilestone(uid, { ...win, day: lastRow.day, silent: firstRun });
    }
    baselines = detected.baselines;
  }

  // ── Active target progress
  const target = await MindTarget.findOne({ user: uid, status: "active" }).lean();
  if (target) {
    const progress = engine.evaluateTarget(target, trades, reflections, today);
    await MindTarget.updateOne(
      { _id: target._id, status: "active" },
      { $set: { cleanDays: progress.cleanDays, activeDays: progress.activeDays, dayResults: progress.dayResults, status: progress.status, completedDay: progress.completedDay } }
    );
    if (progress.status === "completed") {
      await insertMilestone(uid, {
        key: "target_completed", periodKey: String(target._id), day: progress.completedDay,
        silent: progress.completedDay < recentCutoff,
        evidence: { label: copy.renderTargetLabel(target.preset, target.params), cleanDays: progress.cleanDays, preset: target.preset },
      });
    }
  }

  // ── Profile ($max keeps best/highest monotonic under concurrent runs)
  const maxScore = rows.reduce((m, r) => (Number.isFinite(r.score) && r.score > m ? r.score : m), -1);
  const update = {
    $set: {
      unlockedDay: state.unlockedDay || null,
      startingScore: state.unlockedDay ? startingScore : null,
      currentScore: lastRow?.score ?? null,
      currentLevel: lastRow?.level ?? null,
      lastJournaledDay: lastRow?.day || profile?.lastJournaledDay || null,
      lastComputedAt: new Date(),
    },
    $max: {
      highestLevel: highest,
      "baselines.bestPlanRun": baselines.bestPlanRun || 0,
    },
    $setOnInsert: { user: uid },
  };
  if (maxScore >= 0) update.$max.personalBest = maxScore;
  if (Number.isFinite(baselines.bestSelfAwareness)) update.$max["baselines.bestSelfAwareness"] = baselines.bestSelfAwareness;
  if (Number.isFinite(baselines.bestRecoveryRate)) update.$max["baselines.bestRecoveryRate"] = baselines.bestRecoveryRate;
  await MindProfile.updateOne({ user: uid }, update, { upsert: true });

  logger.info("MIND_SCORE_RECOMPUTED", {
    userId: uid, source, firstRun, rows: rows.length, score: lastRow?.score ?? null,
    level: lastRow?.level ?? null, ms: Date.now() - started,
  });
  return { rows: rows.length, today, timezone };
}

// ─── Views ───────────────────────────────────────────────────────────────────

function levelView(level, score) {
  if (!level) return null;
  const info = engine.levelInfo(level);
  const next = engine.nextLevelInfo(level);
  const s = Math.round(score);
  const span = next ? next.min - info.min : 100 - info.min;
  return {
    level: info.level,
    name: info.name,
    emoji: info.emoji,
    min: info.min,
    next: next ? { level: next.level, name: next.name, emoji: next.emoji, min: next.min, pointsTo: Math.max(0, next.min - s) } : null,
    progressPct: next ? Math.max(0, Math.min(100, Math.round(((s - info.min) / span) * 100))) : 100,
  };
}

function renderReasons(reasons, seed, limit = 3) {
  const positives = (reasons || []).filter((r) => r.sign > 0);
  const negatives = (reasons || []).filter((r) => r.sign < 0);
  // Positive-first, at most one slip on the card.
  const chosen = [...positives.slice(0, limit - Math.min(1, negatives.length)), ...negatives.slice(0, 1)].slice(0, limit);
  return chosen
    .map((r) => ({ type: r.type, sign: r.sign, points: r.points ?? null, text: copy.renderReason(r, seed) }))
    .filter((r) => r.text);
}

function renderCelebration(m) {
  const { title, body } = copy.renderWin(m);
  const isLevel = /^level_\d$/.test(m.key);
  return {
    id: String(m._id),
    key: m.key,
    kind: isLevel ? "level_up" : m.key === "first_report" ? "unlock" : "win",
    level: isLevel ? Number(m.key.slice(6)) : null,
    title,
    body,
    day: m.day,
  };
}

const CELEBRATION_PRIORITY = (m) => (/^level_/.test(m.key) ? 0 : m.key === "first_report" ? 1 : 2);

async function loadCelebrations(uid, today) {
  const since = addDays(today, -CELEBRATION_WINDOW_DAYS);
  const docs = await MindMilestone.find({ user: uid, seenAt: null, silent: false, day: { $gte: since } })
    .sort({ earnedAt: 1 }).limit(10).lean();
  return docs
    .sort((a, b) => CELEBRATION_PRIORITY(a) - CELEBRATION_PRIORITY(b))
    .slice(0, CELEBRATIONS_PER_VIEW)
    .map(renderCelebration);
}

function targetView(target) {
  if (!target) return null;
  return {
    id: String(target._id),
    preset: target.preset,
    params: target.params || {},
    label: copy.renderTargetLabel(target.preset, target.params),
    startDay: target.startDay,
    endDay: target.endDay,
    goal: target.goal,
    cleanDays: target.cleanDays || 0,
    activeDays: target.activeDays || 0,
    dayResults: target.dayResults || {},
    status: target.status,
  };
}

/**
 * Everything the dashboard card needs, from persisted rows only (no trade
 * scan). `full` adds the progress-page extras.
 */
async function buildView(userId, { full = false, now = new Date() } = {}) {
  const uid = String(userId);
  const timezone = await streakService.getUserTimezone(uid);
  const today = dayKeyInTz(now, timezone);
  const seed = `${uid}:${today}`;

  const [profile, rows, target, insight, celebrations] = await Promise.all([
    MindProfile.findOne({ user: uid }).lean(),
    MindScoreDaily.find({ user: uid }).sort({ day: -1 }).limit(full ? SERIES_DAYS : 2).lean(),
    MindTarget.findOne({ user: uid, status: "active" }).lean(),
    MindInsight.findOne({ user: uid, day: today }).lean(),
    loadCelebrations(uid, today),
  ]);

  if (!profile) return { status: "calibrating", unlockDays: engine.UNLOCK_DAYS, today };

  const latest = rows[0] || null;
  const journaledDays = latest?.journaledDays || 0;
  const base = {
    today,
    unlockDays: engine.UNLOCK_DAYS,
    journaledDays,
    target: targetView(target),
    celebrations,
  };

  if (!latest || !Number.isFinite(latest.score)) {
    return {
      ...base,
      status: "locked",
      journaledToday: latest?.day === today,
      lockedLine: copy.renderLocked({ journaledDays, needed: engine.UNLOCK_DAYS, journaledToday: latest?.day === today }, seed),
    };
  }

  const daysAway = latest.day ? diffDays(today, latest.day) : 0;
  const isToday = latest.day === today;
  const headlineText = copy.renderHeadline(latest.headline, `${uid}:${latest.day}`);
  const view = {
    ...base,
    status: daysAway >= engine.STALE_AFTER_DAYS ? "stale" : "active",
    score: Math.round(latest.score),
    // "Today" delta only when the latest row is today; otherwise the score held.
    delta: isToday ? latest.delta : 0,
    lastJournaledDay: latest.day,
    daysAway,
    level: levelView(latest.level, latest.score),
    reasons: isToday ? renderReasons(latest.reasons, `${uid}:${latest.day}`) : [],
    headline: headlineText,
    staleLine: daysAway >= engine.STALE_AFTER_DAYS ? copy.renderStale({ daysAway }, seed) : null,
    coverage: latest.coverage,
    earlyRead: latest.coverage < 0.5,
    earlyReadHint: latest.coverage < 0.5 ? copy.renderEarlyRead(latest.missing || []) : null,
    insight: insight?.text || null,
    startingScore: Number.isFinite(profile.startingScore) ? Math.round(profile.startingScore) : null,
    personalBest: Number.isFinite(profile.personalBest) ? Math.round(profile.personalBest) : null,
  };

  if (full) {
    const [earned, history] = await Promise.all([
      MindMilestone.find({ user: uid }).sort({ earnedAt: -1 }).limit(60).lean(),
      MindTarget.find({ user: uid, status: { $ne: "active" } }).sort({ createdAt: -1 }).limit(5).lean(),
    ]);
    const earnedKeys = new Set(earned.map((m) => m.key));
    view.series = rows.filter((r) => Number.isFinite(r.score)).map((r) => ({ day: r.day, score: Math.round(r.score), level: r.level })).reverse();
    view.components = latest.components || {};
    view.missing = latest.missing || [];
    view.trend = (latest.trend || []).map((f) => ({ type: f.type, sign: f.sign, text: copy.renderHeadline(f, `${uid}:${latest.day}:t`) })).filter((f) => f.text);
    view.wins = earned.map((m) => ({ ...renderCelebration(m), earnedAt: m.earnedAt }));
    view.lockedWins = copy.WIN_TEASERS.filter((t) => !earnedKeys.has(t.key)).map((t) => ({ key: t.key, hint: t.hint }));
    view.levels = engine.LEVELS.map((l) => ({ ...l, reached: l.level <= (profile.highestLevel || 0) || l.level <= (latest.level || 0) }));
    view.targetHistory = history.map(targetView);
  }
  return view;
}

/** Dashboard card. Never scans trades; first sight of a user kicks a build. */
async function getCard(userId) {
  if (isDisabled()) return { status: "disabled" };
  const view = await buildView(userId);
  if (view.status === "calibrating") {
    require("../utils/postCommit").runAfterResponse("MIND_FIRST_BUILD_FAILED", () => recompute(userId, { source: "first_view" }));
  } else if (view.status !== "locked" && !view.insight) {
    require("../utils/postCommit").runAfterResponse("MIND_INSIGHT_FAILED", () => ensureInsight(userId));
  }
  return view;
}

async function getProgress(userId) {
  if (isDisabled()) return { status: "disabled" };
  const existing = await MindProfile.exists({ user: String(userId) });
  if (!existing) await recompute(userId, { source: "progress_first_view" });
  const view = await buildView(userId, { full: true });
  if (view.status === "active" && !view.insight) {
    require("../utils/postCommit").runAfterResponse("MIND_INSIGHT_FAILED", () => ensureInsight(userId));
  }
  return view;
}

/**
 * Instant reward sheet right after a save. Recomputes inline under a budget;
 * returns null on timeout so the client falls back to its plain toast.
 */
async function getMicro(userId) {
  if (isDisabled()) return null;
  // Was today already a journal day before this save? Then this entry adds
  // no day toward the unlock, and the sheet must not imply it did.
  const before = await MindScoreDaily.findOne({ user: String(userId) }).sort({ day: -1 }).select({ day: 1 }).lean();
  try {
    await withTimeout(recompute(userId, { source: "micro" }), "mindMicroRecompute", MICRO_BUDGET_MS);
  } catch (error) {
    logger.warn("MIND_MICRO_RECOMPUTE_SLOW", { userId: String(userId), error: error?.message });
    return null;
  }
  const view = await buildView(userId);
  if (view.status === "locked" || view.status === "calibrating") {
    return {
      status: "locked",
      journaledDays: view.journaledDays || 0,
      unlockDays: engine.UNLOCK_DAYS,
      line: before?.day === view.today && view.journaledDays > 0
        ? copy.renderAlreadyCounted({ journaledDays: view.journaledDays, needed: engine.UNLOCK_DAYS })
        : view.lockedLine || copy.renderLocked({ journaledDays: 0, needed: engine.UNLOCK_DAYS }, String(userId)),
      celebrations: view.celebrations || [],
    };
  }
  const unlockedToday = (view.celebrations || []).some((c) => c.kind === "unlock" && c.day === view.today);
  const rawTop = await MindScoreDaily.findOne({ user: String(userId), day: view.today }).select({ reasons: 1 }).lean();
  const topReason = (rawTop?.reasons || []).find((r) => (view.delta >= 0 ? r.sign > 0 : r.sign < 0)) || null;
  return {
    status: "scored",
    score: view.score,
    before: view.score - (view.delta || 0),
    delta: view.delta || 0,
    level: view.level,
    reasons: view.reasons,
    line: copy.renderMicroLine({ delta: view.delta || 0, topReason, unlockedToday, seed: `${userId}:${view.today}` }),
    celebrations: view.celebrations || [],
  };
}

async function markSeen(userId, ids) {
  const valid = (Array.isArray(ids) ? ids : []).filter((id) => mongoose.Types.ObjectId.isValid(String(id))).slice(0, 20);
  if (!valid.length) return { updated: 0 };
  const res = await MindMilestone.updateMany({ user: String(userId), _id: { $in: valid }, seenAt: null }, { $set: { seenAt: new Date() } });
  return { updated: res.modifiedCount || 0 };
}

// ─── Targets ─────────────────────────────────────────────────────────────────

async function getSuggestions(userId, { now = new Date() } = {}) {
  const uid = String(userId);
  const timezone = await streakService.getUserTimezone(uid);
  const today = dayKeyInTz(now, timezone);
  const { trades, reflections } = await loadJournal(uid, addDays(today, -13), today, timezone);
  return {
    today,
    timezone,
    suggestions: engine.suggestTargets(trades, reflections).map((s) => ({
      ...s,
      label: copy.renderTargetLabel(s.preset, s.params),
      why: copy.renderTargetWhy(s),
    })),
  };
}

function sameParams(preset, a = {}, b = {}) {
  switch (preset) {
    case "no_tag": return String(a.tag || "").toLowerCase() === String(b.tag || "").toLowerCase();
    case "follow_rule": return String(a.rule || "").trim() === String(b.rule || "").trim();
    case "stop_after_losses": return Number(a.n) === Number(b.n);
    default: return true;
  }
}

/** Starts a 7-day target. Only presets the trader's data suggested are accepted. */
async function setTarget(userId, { preset, params } = {}) {
  if (isDisabled()) throw new ApiError(404, "Mind Score is not available", "MIND_PROGRESS_DISABLED");
  if (!MindTarget.PRESETS.includes(preset)) throw new ApiError(400, "Unknown target", "VALIDATION_ERROR");
  if (params != null && (typeof params !== "object" || Array.isArray(params))) {
    throw new ApiError(400, "params must be an object", "VALIDATION_ERROR");
  }
  const uid = String(userId);
  const { suggestions, today } = await getSuggestions(uid);
  const match = suggestions.find((s) => s.preset === preset && sameParams(preset, s.params, params || {}));
  if (!match) throw new ApiError(400, "That target isn't available for your data right now", "MIND_TARGET_NOT_SUGGESTED");

  await MindTarget.updateMany({ user: uid, status: "active" }, { $set: { status: "cancelled" } });
  let target;
  try {
    target = await MindTarget.create({
      user: uid,
      preset,
      params: match.params,
      startDay: today,
      endDay: addDays(today, engine.TARGET_DAYS - 1),
      goal: engine.TARGET_GOAL,
    });
  } catch (error) {
    if (error?.code === 11000) throw new ApiError(409, "A target was just set — refresh and try again", "MIND_TARGET_CONFLICT");
    throw error;
  }
  // Today's trades may already count toward it.
  require("../utils/postCommit").runAfterResponse("MIND_TARGET_RECOMPUTE_FAILED", () => recompute(uid, { source: "target_set" }));
  return targetView(target.toObject());
}

async function cancelTarget(userId) {
  const res = await MindTarget.updateMany({ user: String(userId), status: "active" }, { $set: { status: "cancelled" } });
  return { cancelled: res.modifiedCount || 0 };
}

// ─── AI coach line ───────────────────────────────────────────────────────────

const MAX_INSIGHT_CHARS = 200;

function trimInsight(text) {
  const clean = String(text || "").replace(/\s+/g, " ").replace(/^["'`]+|["'`]+$/g, "").trim();
  if (clean.length <= MAX_INSIGHT_CHARS) return clean;
  const cut = clean.slice(0, MAX_INSIGHT_CHARS);
  const space = cut.lastIndexOf(" ");
  return `${(space > 0 ? cut.slice(0, space) : cut).trim()}…`;
}

function buildInsightPrompt(facts) {
  return `You are a friendly trading-psychology buddy inside a journaling app.
Write ONE short line (max ${MAX_INSIGHT_CHARS} characters) for this trader's Mind Score card.

Rules:
- Casual, warm, buddy tone ("bro" is fine, one or two emojis max).
- Mention exactly ONE concrete fact from the JSON, using its real number or name.
- Never invent numbers, trades, instruments or feelings not in the JSON.
- It's about behaviour and mindset only: no buy/sell calls, prices, targets or predictions.
- If there's a slip, frame it as a pattern to watch, never as blame.

Trader facts JSON:
${JSON.stringify(facts)}

Return plain text only.`;
}

/**
 * Generates (once per user per local day) the AI line shown on the card.
 * Falls back to the deterministic headline when Gemini is off, over budget,
 * failing, or returns anything that looks like trade advice.
 */
async function ensureInsight(userId, { now = new Date(), premium = false } = {}) {
  if (isDisabled()) return null;
  const uid = String(userId);
  const timezone = await streakService.getUserTimezone(uid);
  const today = dayKeyInTz(now, timezone);
  const existing = await MindInsight.findOne({ user: uid, day: today }).lean();
  if (existing) return existing;

  // One in-flight generation per user-day across instances.
  try {
    const { client, isRedisReady } = redis();
    if (isRedisReady()) {
      const ok = await withTimeout(client.set(`mind:ai:${uid}:${today}`, "1", "NX", "EX", 600), "mindInsightGuard", REDIS_BUDGET_MS);
      if (ok !== "OK") return null;
    }
  } catch { /* fail open: the unique index still caps it at one row */ }

  const [profile, latest, target] = await Promise.all([
    MindProfile.findOne({ user: uid }).lean(),
    MindScoreDaily.findOne({ user: uid }).sort({ day: -1 }).lean(),
    MindTarget.findOne({ user: uid, status: "active" }).lean(),
  ]);
  if (!profile || !latest || !Number.isFinite(latest.score)) return null;

  const facts = {
    mindScore: Math.round(latest.score),
    level: engine.levelInfo(latest.level).name,
    changeToday: latest.day === today ? latest.delta : 0,
    startingScore: Number.isFinite(profile.startingScore) ? Math.round(profile.startingScore) : null,
    headline: latest.headline ? { type: latest.headline.type, ...latest.headline.evidence } : null,
    weekVsLastWeek: (latest.trend || []).slice(0, 3).map((f) => ({ type: f.type, ...f.evidence })),
    lastJournalDay: (latest.reasons || []).slice(0, 3).map((r) => ({ type: r.type, ...r.evidence })),
    weeklyFocus: target ? copy.renderTargetLabel(target.preset, target.params) : null,
  };
  const fallbackText = trimInsight(copy.renderHeadline(latest.headline, `${uid}:${today}:ai`) || copy.renderMicroLine({ delta: 0, seed: uid }));

  let text = fallbackText;
  let model = "fallback-copy";
  let fallback = true;
  const { isOverDailyBudget } = require("../utils/aiUsage");
  if (appConfig.mindProgress?.aiEnabled && appConfig.ai.geminiApiKey && (premium || !(await isOverDailyBudget()))) {
    try {
      const { GoogleGenerativeAI } = require("@google/generative-ai");
      const { guardedCall } = require("../utils/geminiCircuit");
      const { containsProhibitedFinancialAdvice } = require("./geminiService");
      const genModel = new GoogleGenerativeAI(appConfig.ai.geminiApiKey).getGenerativeModel({ model: appConfig.ai.geminiModel });
      const result = await guardedCall({
        feature: "mind_progress",
        userId: uid,
        model: appConfig.ai.geminiModel,
        call: () => genModel.generateContent({
          contents: [{ role: "user", parts: [{ text: buildInsightPrompt(facts) }] }],
          generationConfig: { temperature: 0.6, maxOutputTokens: 160 },
        }),
      });
      const cand = result?.response?.candidates?.[0];
      const raw = cand?.content?.parts ? cand.content.parts.map((p) => p.text || "").join("") : result?.response?.text?.() || "";
      const cleaned = trimInsight(raw);
      if (cleaned && !containsProhibitedFinancialAdvice(cleaned)) {
        text = cleaned;
        model = appConfig.ai.geminiModel;
        fallback = false;
      } else if (cleaned) {
        logger.warn("MIND_INSIGHT_ADVICE_FILTERED", { userId: uid });
      }
    } catch (error) {
      logger.warn("MIND_INSIGHT_GEMINI_FAILED", { userId: uid, error: error?.message });
    }
  }
  if (!text) return null;

  try {
    return (await MindInsight.create({ user: uid, day: today, text, model, fallback })).toObject();
  } catch (error) {
    if (error?.code === 11000) return MindInsight.findOne({ user: uid, day: today }).lean();
    throw error;
  }
}

module.exports = {
  buildInsightPrompt,
  buildView,
  cancelTarget,
  ensureInsight,
  getCard,
  getMicro,
  getProgress,
  getSuggestions,
  loadJournal,
  markSeen,
  normaliseTrade,
  recompute,
  setTarget,
};
