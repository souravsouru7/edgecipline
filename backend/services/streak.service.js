const mongoose = require("mongoose");
const DailyDisciplineEntry = require("../models/DailyDisciplineEntry");
const User = require("../models/Users");
const NotificationPreference = require("../models/NotificationPreference");
const ApiError = require("../utils/ApiError");
const { logger } = require("../utils/logger");

const DEFAULT_TIMEZONE = "Asia/Kolkata";
const DEFAULT_RULE_THRESHOLD = 70;

// Days of streak length at which we fire a milestone push. Crossing a
// milestone notifies once and is recorded on User.streaks.lastMilestoneNotified
// so a dip-and-recover won't re-fire the same level.
const MILESTONE_DAYS = [3, 7, 14, 30, 60, 100, 180, 365];

// Grace recovery: a ≥GRACE_MIN_STREAK streak that breaks by exactly one
// missed day can be restored if the user logs the next day. Capped at one
// recovery per GRACE_WINDOW_DAYS to prevent gaming.
const GRACE_MIN_STREAK = 7;
const GRACE_WINDOW_DAYS = 30;

// Hard cap on history we read when recomputing. 366 covers a year-long
// streak and bounds query cost. Realistically <30 docs are touched.
const RECOMPUTE_LOOKBACK_DAYS = 366;

// ─── Timezone day-key helpers ────────────────────────────────────────────────

// Convert a Date to a 'YYYY-MM-DD' string in the supplied IANA timezone.
// Intl.DateTimeFormat with en-CA locale yields ISO-style YYYY-MM-DD parts
// — the only reliable way to do TZ-aware day math without pulling in moment.
function dayKeyInTz(date, timezone = DEFAULT_TIMEZONE) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: DEFAULT_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  }
}

function addDays(dayKey, delta) {
  // Parse 'YYYY-MM-DD' as a UTC date, shift by delta, format back as
  // 'YYYY-MM-DD'. Pure string-to-string day math, no TZ involved.
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function diffDays(aKey, bKey) {
  const [ay, am, ad] = aKey.split("-").map(Number);
  const [by, bm, bd] = bKey.split("-").map(Number);
  const aMs = Date.UTC(ay, am - 1, ad);
  const bMs = Date.UTC(by, bm - 1, bd);
  return Math.round((aMs - bMs) / (24 * 60 * 60 * 1000));
}

async function getUserTimezone(userId) {
  // Prefer the user's notification quiet-hours TZ (already shown in settings)
  // and fall back to the streaks-local default. We never throw — bad TZ
  // strings just degrade to Asia/Kolkata in dayKeyInTz.
  const pref = await NotificationPreference.findOne({ user: userId })
    .select({ "quietHours.timezone": 1 })
    .lean();
  const tz = pref?.quietHours?.timezone;
  if (tz && typeof tz === "string") return tz;
  const user = await User.findById(userId).select({ "streaks.timezone": 1 }).lean();
  return user?.streaks?.timezone || DEFAULT_TIMEZONE;
}

// ─── Daily entry writes ──────────────────────────────────────────────────────

// Upsert today's discipline entry from a single trade save. Idempotent —
// re-saving the same trade or saving a second trade on the same day produces
// one document with merged metadata.
async function recordTradeEvent(userId, trade, { timezone } = {}) {
  if (!userId || !trade) return null;
  const tz = timezone || (await getUserTimezone(userId));
  // Use tradeDate when provided; otherwise the create time. Both are valid
  // because the user may back-log a trade that happened earlier today.
  const tradeMoment = trade.tradeDate || trade.createdAt || trade.effectiveTradeDate || new Date();
  const day = dayKeyInTz(tradeMoment, tz);
  if (!day) return null;

  const market = trade.marketType || "Forex";
  const setupScore = Number.isFinite(trade.setupScore) ? Number(trade.setupScore) : null;
  const hasChecklist = Array.isArray(trade.setupRules) && trade.setupRules.length > 0;

  const threshold = await getUserRuleThreshold(userId);
  const ruleHit = setupScore !== null && setupScore >= threshold;

  const update = {
    $setOnInsert: { user: userId, day, market },
    $inc: { tradeCount: 1 },
    $set: {
      "meta.lastTradeAt": new Date(tradeMoment),
    },
    $min: { "meta.firstTradeAt": new Date(tradeMoment) },
  };
  if (hasChecklist) update.$set.checklistUsed = true;
  if (ruleHit) update.$set.ruleHit = true;
  if (setupScore !== null) {
    update.$push = { "meta.setupScores": { $each: [setupScore], $slice: -50 } };
  }
  // Trading a day clears the explicit "no trade" flag — actual trades win.
  update.$set.noTradeToday = false;

  await DailyDisciplineEntry.findOneAndUpdate(
    { user: userId, day, market },
    update,
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return { day, market, tz };
}

// Mark today as a "sat out" day. Idempotent. Stores under market='any' so
// the journal streak counts it regardless of which market the user
// otherwise trades.
async function markNoTradeToday(userId, { market = "any", note = "" } = {}) {
  const tz = await getUserTimezone(userId);
  const day = dayKeyInTz(new Date(), tz);
  if (!day) throw new ApiError(500, "Failed to resolve user timezone", "STREAK_TIMEZONE");

  // Reject if the user already has actual trades on this day — a real trade
  // is stronger evidence than a "sat out" mark.
  const existing = await DailyDisciplineEntry.findOne({ user: userId, day }).lean();
  if (existing && existing.tradeCount > 0) {
    return { day, alreadyTraded: true };
  }

  await DailyDisciplineEntry.findOneAndUpdate(
    { user: userId, day, market },
    {
      $setOnInsert: { user: userId, day, market, tradeCount: 0 },
      $set: { noTradeToday: true, "meta.note": String(note || "").slice(0, 280) },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return { day, alreadyTraded: false };
}

// Some flows call us just to know "did the user use a checklist for this
// non-trade interaction" (e.g., the standalone checklist tracker). Treats
// it as a checklist-used signal without bumping tradeCount.
async function recordChecklistEvent(userId, { market = "Forex" } = {}) {
  const tz = await getUserTimezone(userId);
  const day = dayKeyInTz(new Date(), tz);
  await DailyDisciplineEntry.findOneAndUpdate(
    { user: userId, day, market },
    {
      $setOnInsert: { user: userId, day, market, tradeCount: 0 },
      $set: { checklistUsed: true },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return { day };
}

// ─── Recompute (source-of-truth → denormalized counters) ─────────────────────

// Walks the user's recent DailyDisciplineEntry rows and produces the three
// streak summaries. Pure function — caller decides whether to persist.
function computeStreaksFromEntries(entries, { todayKey, ruleThreshold }) {
  // Index entries by day for O(1) lookup, taking the max across markets.
  const byDay = new Map();
  for (const e of entries) {
    const prev = byDay.get(e.day) || { tradeCount: 0, noTradeToday: false, checklistUsed: false, ruleHit: false };
    byDay.set(e.day, {
      tradeCount:    prev.tradeCount + (e.tradeCount || 0),
      noTradeToday:  prev.noTradeToday || !!e.noTradeToday,
      checklistUsed: prev.checklistUsed || !!e.checklistUsed,
      ruleHit:       prev.ruleHit || !!e.ruleHit,
    });
  }

  function qualifies(kind, agg) {
    if (kind === "journal")   return agg.tradeCount > 0 || agg.noTradeToday;
    if (kind === "checklist") return agg.tradeCount > 0 && agg.checklistUsed;
    return false;
  }

  function streakFor(kind) {
    // Anchor: the most recent day with a qualifying event in the lookback
    // window. If that day is today or yesterday, current is alive; if older,
    // the streak is considered broken.
    let anchor = null;
    const sortedDays = Array.from(byDay.keys()).sort().reverse(); // desc
    for (const day of sortedDays) {
      if (qualifies(kind, byDay.get(day))) {
        anchor = day;
        break;
      }
    }

    // Walk backwards from anchor and count contiguous qualifying days.
    let current = 0;
    let longest = 0;
    let run = 0;
    let lastDay = null;
    const allDays = sortedDays.slice().reverse(); // chronological asc
    for (const day of allDays) {
      const q = qualifies(kind, byDay.get(day));
      if (!q) {
        if (run > longest) longest = run;
        run = 0;
        lastDay = day;
        continue;
      }
      // For "checklist" we skip non-trading days entirely — they don't
      // count for or against the checklist streak (we only require the
      // checklist on days the user actually traded).
      if (kind === "checklist" && byDay.get(day).tradeCount === 0) {
        continue;
      }
      if (lastDay === null) {
        run = 1;
      } else {
        const gap = diffDays(day, lastDay);
        if (kind === "checklist") {
          // For checklist, gaps over non-trading days are fine.
          run += 1;
        } else if (gap === 1) {
          run += 1;
        } else {
          if (run > longest) longest = run;
          run = 1;
        }
      }
      lastDay = day;
    }
    if (run > longest) longest = run;

    // Determine current: only alive if anchor is today or yesterday (journal)
    // — checklist uses the same liveness rule but anchored on the last
    // trading day rather than calendar day.
    let isAlive = false;
    if (anchor) {
      if (kind === "journal") {
        const gap = diffDays(todayKey, anchor);
        isAlive = gap === 0 || gap === 1;
      } else if (kind === "checklist") {
        // Alive if the last trading day in the window had checklist used —
        // we don't penalize the streak for non-trading days.
        const lastTradingDay = sortedDays.find((d) => byDay.get(d).tradeCount > 0);
        isAlive = lastTradingDay === anchor;
      }
    }

    if (isAlive) {
      // Count back from anchor while contiguous qualifying.
      let walking = anchor;
      let alive = 0;
      while (byDay.has(walking) && qualifies(kind, byDay.get(walking))) {
        // For checklist, only count days where tradeCount > 0.
        if (kind !== "checklist" || byDay.get(walking).tradeCount > 0) {
          alive += 1;
        }
        const prevDay = addDays(walking, -1);
        if (kind === "journal") {
          if (!byDay.has(prevDay) || !qualifies("journal", byDay.get(prevDay))) break;
          walking = prevDay;
        } else if (kind === "checklist") {
          // Jump back to the previous *trading* day in the index.
          const prevTrading = sortedDays.find((d) => d < walking && byDay.get(d).tradeCount > 0);
          if (!prevTrading) break;
          if (!byDay.get(prevTrading).checklistUsed) break;
          walking = prevTrading;
        }
      }
      current = alive;
    } else {
      current = 0;
    }

    if (current > longest) longest = current;

    return { current, longest, lastQualifyingDate: anchor };
  }

  function ruleStreakFromEntries() {
    // Rule streak is trade-indexed: walk all setupScores chronologically and
    // count the trailing run with score >= threshold.
    const chronological = entries.slice().sort((a, b) => {
      const ta = a.meta?.firstTradeAt ? new Date(a.meta.firstTradeAt).getTime() : 0;
      const tb = b.meta?.firstTradeAt ? new Date(b.meta.firstTradeAt).getTime() : 0;
      if (ta !== tb) return ta - tb;
      return a.day < b.day ? -1 : 1;
    });
    let current = 0;
    let longest = 0;
    let lastTradeAt = null;
    for (const e of chronological) {
      const scores = Array.isArray(e.meta?.setupScores) ? e.meta.setupScores : [];
      for (const score of scores) {
        if (score >= ruleThreshold) {
          current += 1;
          if (current > longest) longest = current;
        } else {
          current = 0;
        }
      }
      if (e.meta?.lastTradeAt) lastTradeAt = e.meta.lastTradeAt;
    }
    return { current, longest, lastTradeAt };
  }

  return {
    journal:   streakFor("journal"),
    checklist: streakFor("checklist"),
    rule:      ruleStreakFromEntries(),
  };
}

async function getUserRuleThreshold(userId) {
  const user = await User.findById(userId).select({ "streaks.rule.threshold": 1 }).lean();
  const v = user?.streaks?.rule?.threshold;
  return Number.isFinite(v) ? v : DEFAULT_RULE_THRESHOLD;
}

async function loadRecentEntries(userId, days = RECOMPUTE_LOOKBACK_DAYS) {
  const now = new Date();
  const tz = await getUserTimezone(userId);
  const today = dayKeyInTz(now, tz);
  const earliest = addDays(today, -days);
  return DailyDisciplineEntry.find({
    user: userId,
    day: { $gte: earliest, $lte: today },
  })
    .sort({ day: 1 })
    .lean();
}

// Recompute and persist denormalized counters on the User document.
// Returns the new streak summary plus any milestone events that should fire.
async function recomputeStreaks(userId, { now = new Date() } = {}) {
  if (!userId) throw new ApiError(400, "userId required", "VALIDATION_ERROR");
  const tz = await getUserTimezone(userId);
  const todayKey = dayKeyInTz(now, tz);

  const user = await User.findById(userId).select({ streaks: 1 }).lean();
  if (!user) throw new ApiError(404, "User not found", "NOT_FOUND");
  const before = user.streaks || {};
  const ruleThreshold = before?.rule?.threshold ?? DEFAULT_RULE_THRESHOLD;

  const entries = await loadRecentEntries(userId);
  const computed = computeStreaksFromEntries(entries, { todayKey, ruleThreshold });

  // ── Grace recovery handling for journal streak ─────────────────────────
  // If the prior current was strong (≥ GRACE_MIN_STREAK) and is now zero,
  // and the user already has a qualifying event today (so they came back
  // immediately), award one recovery (capped per window).
  let recoveryApplied = false;
  const priorCurrent = before?.journal?.current || 0;
  const priorBroken  = before?.journal?.lastBrokenAt ? new Date(before.journal.lastBrokenAt) : null;
  const lastRecovery = before?.journal?.lastRecoveryAt ? new Date(before.journal.lastRecoveryAt) : null;
  const recoveryStillAvailable = !lastRecovery
    || (now.getTime() - lastRecovery.getTime()) > GRACE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  if (
    priorCurrent >= GRACE_MIN_STREAK &&
    computed.journal.current === 1 &&
    computed.journal.lastQualifyingDate === todayKey &&
    recoveryStillAvailable
  ) {
    computed.journal.current = priorCurrent + 1;
    if (computed.journal.current > computed.journal.longest) {
      computed.journal.longest = computed.journal.current;
    }
    recoveryApplied = true;
  }

  const broken =
    priorCurrent >= GRACE_MIN_STREAK &&
    computed.journal.current < priorCurrent &&
    !recoveryApplied;

  const updates = {
    "streaks.journal.current":            computed.journal.current,
    "streaks.journal.longest":            Math.max(before?.journal?.longest || 0, computed.journal.longest),
    "streaks.journal.lastQualifyingDate": computed.journal.lastQualifyingDate || null,
    "streaks.checklist.current":          computed.checklist.current,
    "streaks.checklist.longest":          Math.max(before?.checklist?.longest || 0, computed.checklist.longest),
    "streaks.checklist.lastQualifyingDate": computed.checklist.lastQualifyingDate || null,
    "streaks.rule.current":               computed.rule.current,
    "streaks.rule.longest":               Math.max(before?.rule?.longest || 0, computed.rule.longest),
    "streaks.rule.lastTradeAt":           computed.rule.lastTradeAt || null,
    "streaks.timezone":                   tz,
  };
  if (recoveryApplied) {
    updates["streaks.journal.lastRecoveryAt"] = now;
    // Reset the broken marker — recovery cleared it.
    updates["streaks.journal.lastBrokenAt"] = null;
  }
  if (broken) {
    updates["streaks.journal.lastBrokenAt"] = priorBroken || now;
  }

  // Milestone detection — fire only when crossing a threshold UP for the
  // first time. Persist the highest milestone notified to suppress repeats.
  const lastNotified = before?.lastMilestoneNotified || 0;
  const newMilestone = MILESTONE_DAYS.find(
    (m) => computed.journal.current >= m && m > lastNotified
  );
  if (newMilestone) {
    updates["streaks.lastMilestoneNotified"] = newMilestone;
  }

  await User.updateOne({ _id: userId }, { $set: updates });

  return {
    streaks: {
      journal:   { ...computed.journal, current: updates["streaks.journal.current"], longest: updates["streaks.journal.longest"] },
      checklist: { ...computed.checklist, current: updates["streaks.checklist.current"], longest: updates["streaks.checklist.longest"] },
      rule:      { ...computed.rule, current: updates["streaks.rule.current"], longest: updates["streaks.rule.longest"], threshold: ruleThreshold },
    },
    events: {
      recovered: recoveryApplied,
      broken,
      brokenLength: broken ? priorCurrent : 0,
      newMilestone: newMilestone || null,
    },
    timezone: tz,
    todayKey,
  };
}

// Convenience: record an event AND recompute, returning the resulting events.
// Callers that want to fire notifications use the `events` from the return.
async function recordTradeAndRecompute(userId, trade) {
  await recordTradeEvent(userId, trade);
  return recomputeStreaks(userId);
}

async function markNoTradeAndRecompute(userId, opts) {
  const result = await markNoTradeToday(userId, opts);
  const recompute = await recomputeStreaks(userId);
  return { ...recompute, alreadyTraded: result.alreadyTraded };
}

// ─── Reads ───────────────────────────────────────────────────────────────────

async function getStreakSnapshot(userId) {
  const user = await User.findById(userId).select({ streaks: 1 }).lean();
  if (!user) return null;
  const streaks = user.streaks || {};
  const ruleThreshold = streaks?.rule?.threshold ?? DEFAULT_RULE_THRESHOLD;
  const tz = streaks?.timezone || (await getUserTimezone(userId));
  const todayKey = dayKeyInTz(new Date(), tz);
  const journalLast = streaks?.journal?.lastQualifyingDate || null;
  const atRisk =
    (streaks?.journal?.current || 0) >= 3 &&
    journalLast !== todayKey;
  return {
    journal: {
      current: streaks?.journal?.current || 0,
      longest: streaks?.journal?.longest || 0,
      lastQualifyingDate: journalLast,
      atRisk,
      recoveryAvailable: isRecoveryAvailable(streaks?.journal),
    },
    checklist: {
      current: streaks?.checklist?.current || 0,
      longest: streaks?.checklist?.longest || 0,
      lastQualifyingDate: streaks?.checklist?.lastQualifyingDate || null,
    },
    rule: {
      current: streaks?.rule?.current || 0,
      longest: streaks?.rule?.longest || 0,
      threshold: ruleThreshold,
    },
    timezone: tz,
    todayKey,
  };
}

function isRecoveryAvailable(journal) {
  if (!journal) return true;
  if (!journal.lastRecoveryAt) return true;
  const elapsed = Date.now() - new Date(journal.lastRecoveryAt).getTime();
  return elapsed > GRACE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

async function getStreakDetail(userId, { days = 90 } = {}) {
  const snapshot = await getStreakSnapshot(userId);
  if (!snapshot) return null;
  const tz = snapshot.timezone;
  const today = snapshot.todayKey;
  const lookback = Math.min(Math.max(Number(days) || 90, 7), 366);
  const earliest = addDays(today, -(lookback - 1));

  const entries = await DailyDisciplineEntry.find({
    user: userId,
    day: { $gte: earliest, $lte: today },
  })
    .sort({ day: 1 })
    .lean();

  // Aggregate per day across markets for the calendar.
  const byDay = new Map();
  for (const e of entries) {
    const cur = byDay.get(e.day) || { tradeCount: 0, noTradeToday: false, checklistUsed: false, ruleHit: false };
    byDay.set(e.day, {
      tradeCount:    cur.tradeCount + (e.tradeCount || 0),
      noTradeToday:  cur.noTradeToday || !!e.noTradeToday,
      checklistUsed: cur.checklistUsed || !!e.checklistUsed,
      ruleHit:       cur.ruleHit || !!e.ruleHit,
    });
  }
  const calendar = [];
  for (let i = lookback - 1; i >= 0; i--) {
    const day = addDays(today, -i);
    const agg = byDay.get(day);
    calendar.push({
      day,
      tradeCount: agg?.tradeCount || 0,
      noTradeToday: !!agg?.noTradeToday,
      checklistUsed: !!agg?.checklistUsed,
      ruleHit: !!agg?.ruleHit,
      qualifiesJournal: !!agg && (agg.tradeCount > 0 || agg.noTradeToday),
    });
  }

  const milestones = MILESTONE_DAYS.map((days) => ({
    days,
    earned: snapshot.journal.longest >= days,
    isNext: !MILESTONE_DAYS.some((d) => d < days && snapshot.journal.longest >= d)
      ? false
      : snapshot.journal.current < days,
  }));

  // Identify the "next milestone" — the lowest milestone above current.
  const nextMilestoneDays = MILESTONE_DAYS.find((d) => d > snapshot.journal.current) || null;

  return {
    ...snapshot,
    calendar,
    milestones,
    nextMilestoneDays,
    tz,
  };
}

module.exports = {
  // Constants exposed for tests + cron
  MILESTONE_DAYS,
  GRACE_MIN_STREAK,
  GRACE_WINDOW_DAYS,
  DEFAULT_RULE_THRESHOLD,
  // Time helpers
  dayKeyInTz,
  addDays,
  diffDays,
  // Writes
  recordTradeEvent,
  markNoTradeToday,
  recordChecklistEvent,
  recordTradeAndRecompute,
  markNoTradeAndRecompute,
  // Recompute
  recomputeStreaks,
  computeStreaksFromEntries,
  // Reads
  getStreakSnapshot,
  getStreakDetail,
};
