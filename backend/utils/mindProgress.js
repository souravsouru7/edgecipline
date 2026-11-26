/**
 * Mind Score engine — pure functions only (no Mongo, no Redis, no clock).
 *
 * The Mind Score is a 0-100 read on the trader's *psychology*, never on P&L:
 * a losing trader who stays calm and honest can climb, a profitable one who
 * revenge-trades does not. It is rebuilt from journal entries (completed
 * trades in either market + daily reflections) by mindProgress.service, which
 * hands this module already-normalised entries:
 *
 *   trade = {
 *     id, day: "YYYY-MM-DD" (user's local day), ts (ms), createdTs (ms),
 *     hasTime (false when the trade only carries a date — timing rules skip it),
 *     market: "Forex" | "Indian_Market", currency: "USD" | "INR",
 *     profit (number | null), instrument,
 *     tags: [lowercased emotional tags], tagLabels: { lower: "Original" },
 *     mistake: lowercased mistake tag, entryBasis, confidence, mood,
 *     setupScore (number | null), rules: [{ label, followed }],
 *     raw: original fields needed by computeSelfAwarenessAnalytics
 *   }
 *   reflection = { day, followedPlan, mood, skipped }
 *
 * Design rules this module enforces (they are product decisions, not tuning):
 *   - Missing data is excluded, never scored as zero (weights renormalise).
 *   - The daily score is smoothed and a single day can cost at most MAX_DROP.
 *   - A journaling day without any slip always moves the score up (FLOOR).
 *   - No journal entry → no row → the score holds. Absence never decays it.
 *   - Every reason/win carries its evidence; copy is rendered elsewhere.
 */

const { computeSelfAwarenessAnalytics } = require("./tradeEvaluation");
const { NEGATIVE_TAGS: NEG_TAGS, POSITIVE_TAGS: POS_TAGS } = require("./metricEngine");

// ─── Constants ───────────────────────────────────────────────────────────────

const UNLOCK_DAYS = 3;
const WINDOW_DAYS = 14;
const RECOMPUTE_DAYS = 30;
const ALPHA = 0.35;
const MAX_DROP = 4;
const FLOOR = 1;
const LEVEL_HYSTERESIS = 3;
// A day contributes at most this many trades' worth of weight, so twenty spam
// trades tagged "Calm" can't drown out the rest of the window.
const DAY_TRADE_CAP = 10;
const TILT_REENTRY_MS = 15 * 60 * 1000;
const STALE_AFTER_DAYS = 14;

const WEIGHTS = Object.freeze({
  emotional: 25,
  discipline: 25,
  recovery: 20,
  selfAwareness: 15,
  journaling: 15,
});

const COMPONENT_MIN = Object.freeze({
  emotionalTrades: 3,
  setupTrades: 3,
  planReflections: 2,
  recoveryLosses: 2,
});

const LEVELS = Object.freeze([
  { level: 1, min: 0, name: "Rookie Mind", emoji: "🌱" },
  { level: 2, min: 30, name: "Aware Trader", emoji: "👀" },
  { level: 3, min: 50, name: "Focused Trader", emoji: "🧊" },
  { level: 4, min: 70, name: "Disciplined", emoji: "🔥" },
  { level: 5, min: 85, name: "Calm Pro", emoji: "🧘" },
  { level: 6, min: 95, name: "Mind Master", emoji: "👑" },
]);

const NEGATIVE = new Set([...NEG_TAGS].map((t) => t.toLowerCase()));
const POSITIVE = new Set([...POS_TAGS].map((t) => t.toLowerCase()));
const PLAN_VALUE = { yes: 1, partly: 0.5, no: 0, no_trades: 1 };

// Importance of each day-level fact when the day's delta is split into
// "why it moved" points. Negative facts are behaviour slips.
const FACT_WEIGHT = Object.freeze({
  calm_after_loss: 20,
  plan_followed: 15,
  clean_entries: 12,
  sat_out: 10,
  rule_kept: 10,
  positive_tags: 8,
  honest_tags: 6,
  reflection_done: 5,
  journal_logged: 4,
  revenge: 25,
  tilt_after_loss: 20,
  neg_tag: 15,
  impulsive: 12,
  plan_missed: 12,
  rule_broken: 10,
  overconfident: 8,
  window_shift: 1,
});

// ─── Small helpers ───────────────────────────────────────────────────────────

const round1 = (n) => Math.round(n * 10) / 10;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

function addDays(dayKey, delta) {
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function diffDays(aKey, bKey) {
  const [ay, am, ad] = aKey.split("-").map(Number);
  const [by, bm, bd] = bKey.split("-").map(Number);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86400000);
}

// ISO-8601 week of a day key, e.g. "2026-W48". Used as the repeat period for
// weekly Mind Wins so each can be earned at most once per week.
function isoWeekOfDay(dayKey) {
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function inRange(day, from, to) {
  return day >= from && day <= to;
}

function sortTrades(trades) {
  return [...trades].sort((a, b) => (a.ts - b.ts) || (a.createdTs - b.createdTs) || String(a.id).localeCompare(String(b.id)));
}

function groupByDay(items) {
  const map = new Map();
  for (const item of items) {
    if (!map.has(item.day)) map.set(item.day, []);
    map.get(item.day).push(item);
  }
  return map;
}

// ─── Trade classification ───────────────────────────────────────────────────

function isRevenge(t) {
  return t.tags.includes("revenge") || /revenge/.test(t.mistake || "");
}
function negTagsOf(t) {
  return t.tags.filter((tag) => NEGATIVE.has(tag));
}
function posTagsOf(t) {
  return t.tags.filter((tag) => POSITIVE.has(tag));
}
function isImpulsive(t) {
  return t.entryBasis === "Emotion" || t.entryBasis === "Impulsive";
}
function isOverconfident(t) {
  return t.confidence === "Overconfident";
}
function hasPsych(t) {
  return t.tags.length > 0 || Boolean(t.entryBasis) || Boolean(t.confidence) || isNum(t.mood);
}
function isSlip(t) {
  return negTagsOf(t).length > 0 || isRevenge(t) || isImpulsive(t) || isOverconfident(t);
}
function isLoss(t) {
  return isNum(t.profit) && t.profit < 0;
}
function labelFor(t, tag) {
  return (t.tagLabels && t.tagLabels[tag]) || tag.charAt(0).toUpperCase() + tag.slice(1);
}

// Per-trade weight so no single day dominates a window (see DAY_TRADE_CAP).
function dayWeights(trades) {
  const counts = new Map();
  for (const t of trades) counts.set(t.day, (counts.get(t.day) || 0) + 1);
  return (t) => Math.min(1, DAY_TRADE_CAP / counts.get(t.day));
}

function weightedRate(trades, predicate, weightOf) {
  let num = 0;
  let den = 0;
  for (const t of trades) {
    const w = weightOf(t);
    den += w;
    if (predicate(t)) num += w;
  }
  return den > 0 ? num / den : null;
}

/**
 * What happened right after each losing trade, per day:
 *   calm      — the next trade that day shows no slip
 *   tilt      — the next trade is a slip, or a same-instrument re-entry within
 *               15 minutes (only when both trades carry a real time of day;
 *               date-only trades would all look simultaneous)
 *   walkAway  — no further trade that day (good, but not counted toward the
 *               recovery *rate*, which needs an actual follow-up decision)
 */
function computeRecovery(trades) {
  const out = { calm: 0, tilt: 0, walkAway: 0, losses: 0, tiltRevenge: 0, instruments: [], tiltMinutes: [] };
  for (const [, dayTrades] of groupByDay(trades)) {
    const ordered = sortTrades(dayTrades);
    for (let i = 0; i < ordered.length; i += 1) {
      const t = ordered[i];
      if (!isLoss(t)) continue;
      out.losses += 1;
      const next = ordered[i + 1];
      if (!next) {
        out.walkAway += 1;
        if (t.instrument) out.instruments.push(t.instrument);
        continue;
      }
      const gap = next.ts - t.ts;
      const quickReentry = t.hasTime && next.hasTime && gap > 0 && gap <= TILT_REENTRY_MS &&
        t.instrument && next.instrument && t.instrument === next.instrument;
      if (isSlip(next) || quickReentry) {
        out.tilt += 1;
        if (isRevenge(next)) out.tiltRevenge += 1;
        if (quickReentry) out.tiltMinutes.push(Math.max(1, Math.round(gap / 60000)));
        if (next.instrument) out.instruments.push(next.instrument);
      } else {
        out.calm += 1;
        if (t.instrument) out.instruments.push(t.instrument);
      }
    }
  }
  out.evaluated = out.calm + out.tilt;
  return out;
}

// ─── Components ──────────────────────────────────────────────────────────────

/**
 * @returns {{ components, raw, coverage, missing: string[] }}
 *   components[k] is 0-100 or null (not enough data).
 */
function computeComponents(trades, reflections) {
  const weightOf = dayWeights(trades);
  const components = { emotional: null, discipline: null, recovery: null, selfAwareness: null, journaling: null };

  const psych = trades.filter(hasPsych);
  if (psych.length >= COMPONENT_MIN.emotionalTrades) {
    const slipRate = weightedRate(psych, isSlip, weightOf);
    components.emotional = round1(100 * (1 - slipRate));
  }

  const setupTrades = trades.filter((t) => isNum(t.setupScore));
  const planned = reflections.filter((r) => !r.skipped && PLAN_VALUE[r.followedPlan] !== undefined);
  const setupPart = setupTrades.length >= COMPONENT_MIN.setupTrades
    ? (() => {
      let num = 0;
      let den = 0;
      for (const t of setupTrades) {
        const w = weightOf(t);
        num += clamp(t.setupScore, 0, 100) * w;
        den += w;
      }
      return num / den;
    })()
    : null;
  const planPart = planned.length >= COMPONENT_MIN.planReflections
    ? (100 * planned.reduce((s, r) => s + PLAN_VALUE[r.followedPlan], 0)) / planned.length
    : null;
  if (setupPart != null && planPart != null) components.discipline = round1(0.6 * setupPart + 0.4 * planPart);
  else if (setupPart != null) components.discipline = round1(setupPart);
  else if (planPart != null) components.discipline = round1(planPart);

  const recovery = computeRecovery(trades);
  if (recovery.evaluated >= COMPONENT_MIN.recoveryLosses) {
    components.recovery = round1((100 * recovery.calm) / recovery.evaluated);
  }

  const sa = computeSelfAwarenessAnalytics(trades.map((t) => t.raw || {}));
  if (sa && !sa.insufficient && isNum(sa.score)) components.selfAwareness = sa.score;

  const journaledReflections = reflections.filter((r) => !r.skipped);
  if (trades.length > 0) {
    const tagRate = weightedRate(trades, hasPsych, weightOf) || 0;
    const tradedDays = new Set(trades.map((t) => t.day));
    const reflectedDays = new Set(journaledReflections.map((r) => r.day));
    let reflectedTradeDays = 0;
    for (const d of tradedDays) if (reflectedDays.has(d)) reflectedTradeDays += 1;
    const reflRate = reflectedTradeDays / tradedDays.size;
    // Logging a trade at all is worth 40: an untagged screenshot import is
    // still a journal entry, and scoring it 0 would punish the trader for
    // using the fastest input path.
    components.journaling = round1(100 * (0.4 + 0.6 * (0.7 * tagRate + 0.3 * reflRate)));
  } else if (journaledReflections.length > 0) {
    components.journaling = 100;
  }

  let num = 0;
  let den = 0;
  const missing = [];
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    if (components[key] == null) {
      missing.push(key);
      continue;
    }
    num += weight * components[key];
    den += weight;
  }
  return {
    components,
    raw: den > 0 ? round1(num / den) : null,
    coverage: Math.round(den) / 100, // weights sum to 100, so this is exact to 2dp
    missing,
    recovery,
    selfAwareness: sa && !sa.insufficient ? { score: sa.score, tracked: sa.trackedCount } : null,
  };
}

// ─── Levels ──────────────────────────────────────────────────────────────────

function levelFor(score) {
  if (!isNum(score)) return null;
  const s = Math.round(score);
  let current = LEVELS[0];
  for (const lvl of LEVELS) if (s >= lvl.min) current = lvl;
  return current.level;
}

/** Up as soon as a bound is crossed; down only LEVEL_HYSTERESIS below it. */
function applyLevel(prevLevel, score) {
  const natural = levelFor(score);
  if (natural == null) return prevLevel ?? null;
  if (!prevLevel || natural >= prevLevel) return natural;
  const floor = LEVELS[prevLevel - 1].min - LEVEL_HYSTERESIS;
  return Math.round(score) < floor ? natural : prevLevel;
}

function levelInfo(level) {
  return LEVELS[(level || 1) - 1] || LEVELS[0];
}

function nextLevelInfo(level) {
  return level && level < LEVELS.length ? LEVELS[level] : null;
}

// ─── Smoothing ───────────────────────────────────────────────────────────────

function smoothScore(prev, raw, { slips = false } = {}) {
  if (!isNum(raw)) return prev;
  if (!isNum(prev)) return round1(clamp(raw, 0, 100));
  let delta = ALPHA * (raw - prev);
  if (delta < -MAX_DROP) delta = -MAX_DROP;
  if (!slips && delta < FLOOR) delta = FLOOR;
  return round1(clamp(prev + delta, 0, 100));
}

// ─── Day facts (the "why") ───────────────────────────────────────────────────

function topCount(map) {
  let best = null;
  for (const [key, count] of map) {
    if (!best || count > best[1] || (count === best[1] && key < best[0])) best = [key, count];
  }
  return best;
}

/**
 * Facts about ONE day's journal, each tied to evidence from that day.
 * `weekTrades` (last 7 days incl. this one) only enriches evidence.
 */
function computeDayFacts(dayTrades, dayReflection, weekTrades = []) {
  const facts = [];
  const push = (type, sign, evidence = {}) => facts.push({ type, sign, weight: FACT_WEIGHT[type] || 1, evidence });

  const ordered = sortTrades(dayTrades);
  const recovery = computeRecovery(ordered);
  const revengeTrades = ordered.filter(isRevenge);

  // Walking away only counts as composure on a day without tilt: praising
  // "you stopped after that loss" right after a revenge trade reads as false.
  const calmCount = recovery.calm + (recovery.tilt === 0 ? recovery.walkAway : 0);
  if (calmCount > 0) {
    push("calm_after_loss", 1, {
      count: calmCount,
      losses: recovery.losses,
      walkedAway: recovery.tilt === 0 && recovery.walkAway > 0,
      instrument: recovery.instruments[0] || null,
    });
  }
  if (revengeTrades.length > 0) {
    push("revenge", -1, { count: revengeTrades.length, instrument: revengeTrades[0].instrument || null });
  }
  const tiltNotRevenge = recovery.tilt - recovery.tiltRevenge;
  if (tiltNotRevenge > 0) {
    push("tilt_after_loss", -1, {
      count: tiltNotRevenge,
      instrument: recovery.instruments[0] || null,
      minutes: recovery.tiltMinutes[0] || null,
    });
  }

  const negCounts = new Map();
  const posCounts = new Map();
  const labels = {};
  for (const t of ordered) {
    for (const tag of negTagsOf(t)) {
      if (tag === "revenge") continue;
      negCounts.set(tag, (negCounts.get(tag) || 0) + 1);
      labels[tag] = labelFor(t, tag);
    }
    for (const tag of posTagsOf(t)) {
      posCounts.set(tag, (posCounts.get(tag) || 0) + 1);
      labels[tag] = labelFor(t, tag);
    }
  }
  const topNeg = topCount(negCounts);
  if (topNeg) {
    const weekCount = weekTrades.filter((t) => t.tags.includes(topNeg[0])).length;
    push("neg_tag", -1, { tag: labels[topNeg[0]], count: topNeg[1], weekCount: Math.max(weekCount, topNeg[1]) });
    // Naming a bad emotion honestly is the habit we want: it earns credit
    // even on the day it costs points.
    push("honest_tags", 1, { tag: labels[topNeg[0]], count: topNeg[1] });
  }
  const topPos = topCount(posCounts);
  if (topPos) push("positive_tags", 1, { tag: labels[topPos[0]], count: topPos[1] });

  const impulsive = ordered.filter(isImpulsive).length;
  if (impulsive > 0) push("impulsive", -1, { count: impulsive, total: ordered.length });
  const overconfident = ordered.filter(isOverconfident).length;
  if (overconfident > 0) push("overconfident", -1, { count: overconfident });

  const clean = ordered.filter((t) => t.entryBasis === "Plan" && !isSlip(t)).length;
  if (clean > 0) push("clean_entries", 1, { count: clean, total: ordered.length });

  const ruleStats = new Map();
  for (const t of ordered) {
    for (const rule of t.rules || []) {
      if (!rule || !rule.label) continue;
      const key = rule.label.trim();
      if (!key) continue;
      const s = ruleStats.get(key) || { kept: 0, broken: 0 };
      if (rule.followed) s.kept += 1;
      else s.broken += 1;
      ruleStats.set(key, s);
    }
  }
  let kept = null;
  let broken = null;
  for (const [label, s] of ruleStats) {
    if (s.broken === 0 && s.kept > 0 && (!kept || s.kept > kept.count || (s.kept === kept.count && label < kept.rule))) {
      kept = { rule: label, count: s.kept };
    }
    if (s.broken > 0 && (!broken || s.broken > broken.count || (s.broken === broken.count && label < broken.rule))) {
      broken = { rule: label, count: s.broken };
    }
  }
  if (kept) push("rule_kept", 1, kept);
  if (broken) push("rule_broken", -1, broken);

  const refl = dayReflection && !dayReflection.skipped ? dayReflection : null;
  if (refl) {
    if (refl.followedPlan === "yes") push("plan_followed", 1, {});
    else if (refl.followedPlan === "no_trades" && ordered.length === 0) push("sat_out", 1, {});
    else if (refl.followedPlan === "no") push("plan_missed", -1, {});
    else push("reflection_done", 1, {});
  }

  if (!facts.some((f) => f.sign > 0)) {
    push("journal_logged", 1, { trades: ordered.length, reflected: Boolean(refl) });
  }
  return facts;
}

/**
 * Split the day's (rounded) score change across its facts so the card can say
 * "+2 calm after loss · +1 tagged honestly · -1 FOMO" and the parts add up to
 * the headline number. Positives are listed first (positive-first rule).
 */
function apportionReasons(facts, delta) {
  const pos = facts.filter((f) => f.sign > 0).sort((a, b) => b.weight - a.weight).slice(0, 3);
  let neg = facts.filter((f) => f.sign < 0).sort((a, b) => b.weight - a.weight).slice(0, 2);
  const D = Math.round(delta);

  if (D < 0 && neg.length === 0) {
    // Score fell without a slip today: older strong days left the window.
    neg = [{ type: "window_shift", sign: -1, weight: FACT_WEIGHT.window_shift, evidence: {} }];
  }

  const split = (items, total) => {
    if (items.length === 0 || total <= 0) return items.map(() => 0);
    const shown = items.slice(0, Math.min(items.length, total));
    const sum = shown.reduce((s, f) => s + f.weight, 0);
    const exact = shown.map((f) => (total * f.weight) / sum);
    const pts = exact.map((e) => Math.max(1, Math.floor(e)));
    let used = pts.reduce((a, b) => a + b, 0);
    // Largest remainder, then trim from the smallest if the max(1) floor overshot.
    const order = exact.map((e, i) => [e - Math.floor(e), i]).sort((a, b) => b[0] - a[0]);
    for (let k = 0; used < total && k < order.length; k += 1, used += 1) pts[order[k][1]] += 1;
    for (let i = pts.length - 1; used > total && i >= 0; i -= 1) {
      while (pts[i] > 1 && used > total) { pts[i] -= 1; used -= 1; }
    }
    return items.map((_, i) => (i < shown.length ? pts[i] : 0));
  };

  let posPts;
  let negPts;
  if (D >= 0) {
    negPts = neg.map(() => 1);
    posPts = split(pos, D + negPts.length);
  } else {
    posPts = pos.map(() => 1);
    negPts = split(neg, posPts.length - D);
  }

  const reasons = [
    ...pos.map((f, i) => ({ type: f.type, sign: 1, points: posPts[i], evidence: f.evidence })),
    ...neg.map((f, i) => ({ type: f.type, sign: -1, points: -negPts[i], evidence: f.evidence })),
  ];
  return reasons.filter((r) => r.points !== 0 || r.sign > 0);
}

// ─── Headline selection ─────────────────────────────────────────────────────

/**
 * The card's lead line for a day. Positive week-over-week facts first, then
 * the day's own wins; a slip only leads when there is no win at all, and only
 * as a week-level "pattern spotted". Never the same fact type two journal
 * days running (variable reward), unless it is the only candidate.
 */
function selectHeadline(trendFacts, reasons, prevType) {
  const dayWins = reasons
    .filter((r) => r.sign > 0)
    .sort((a, b) => (b.points || 0) - (a.points || 0) || (FACT_WEIGHT[b.type] || 0) - (FACT_WEIGHT[a.type] || 0));
  const candidates = [
    ...trendFacts.filter((f) => f.sign > 0).map((f) => ({ type: f.type, sign: 1, kind: "trend", evidence: f.evidence })),
    ...dayWins.map((r) => ({ type: r.type, sign: 1, kind: "day", evidence: r.evidence })),
    ...trendFacts.filter((f) => f.sign < 0).map((f) => ({ type: f.type, sign: -1, kind: "trend", evidence: f.evidence })),
  ];
  if (!candidates.length) return null;
  return candidates.find((c) => c.type !== prevType) || candidates[0];
}

// ─── Daily series ────────────────────────────────────────────────────────────

function journaledDaySet(trades, reflections) {
  const days = new Set(trades.map((t) => t.day));
  for (const r of reflections) if (!r.skipped) days.add(r.day);
  return days;
}

/**
 * Rebuild the daily rows for every journaled day in [fromDay, toDay].
 *
 * @param {object}   args
 * @param {object[]} args.trades       normalised trades covering fromDay-13 … toDay
 * @param {object[]} args.reflections  normalised reflections, same range
 * @param {string}   args.fromDay
 * @param {string}   args.toDay
 * @param {object}   args.prev         state as of the last journaled day before fromDay:
 *                                     { score, level, journaledDays, unlockedDay }
 * @returns {{ rows: object[], state: object }}
 */
function buildDailyRows({ trades, reflections, fromDay, toDay, prev = {} }) {
  const tradesByDay = groupByDay(trades);
  const reflByDay = new Map(reflections.map((r) => [r.day, r]));
  const days = [...journaledDaySet(trades, reflections)].filter((d) => inRange(d, fromDay, toDay)).sort();

  const state = {
    score: isNum(prev.score) ? prev.score : null,
    level: prev.level || null,
    journaledDays: prev.journaledDays || 0,
    unlockedDay: prev.unlockedDay || null,
    headlineType: prev.headlineType || null,
  };
  const rows = [];

  for (const day of days) {
    const windowStart = addDays(day, -(WINDOW_DAYS - 1));
    const weekStart = addDays(day, -6);
    const wTrades = trades.filter((t) => inRange(t.day, windowStart, day));
    const wRefl = reflections.filter((r) => inRange(r.day, windowStart, day));
    const result = computeComponents(wTrades, wRefl);
    const dayTrades = tradesByDay.get(day) || [];
    const dayRefl = reflByDay.get(day) || null;
    const facts = computeDayFacts(dayTrades, dayRefl, wTrades.filter((t) => t.day >= weekStart));
    const slips = facts.some((f) => f.sign < 0);

    state.journaledDays += 1;
    let score = null;
    let delta = null;
    if (!state.unlockedDay && state.journaledDays >= UNLOCK_DAYS && isNum(result.raw)) {
      state.unlockedDay = day;
      score = round1(clamp(result.raw, 0, 100));
    } else if (state.unlockedDay && isNum(result.raw)) {
      score = smoothScore(state.score, result.raw, { slips });
      delta = isNum(state.score) ? round1(score - state.score) : null;
    } else if (state.unlockedDay) {
      score = state.score;
      delta = 0;
    }

    const level = isNum(score) ? applyLevel(state.level, score) : null;
    const displayDelta = isNum(delta) ? Math.round(score) - Math.round(state.score) : null;
    const reasons = isNum(displayDelta)
      ? apportionReasons(facts, displayDelta)
      : facts.map((f) => ({ type: f.type, sign: f.sign, points: null, evidence: f.evidence }));
    const trend = computeTrend(trades, reflections, day);
    const headline = selectHeadline(trend.facts, reasons, state.headlineType);
    rows.push({
      day,
      score,
      raw: result.raw,
      delta: displayDelta,
      level,
      components: result.components,
      coverage: result.coverage,
      missing: result.missing,
      reasons,
      trend: trend.facts.slice(0, 4),
      headline,
      headlineType: headline ? headline.type : null,
      unlocked: Boolean(state.unlockedDay),
      unlockedToday: state.unlockedDay === day,
      journaledDays: state.journaledDays,
      stats: {
        trades: dayTrades.length,
        reflected: Boolean(dayRefl && !dayRefl.skipped),
        slips,
        selfAwareness: result.selfAwareness,
        recoveryRate: result.recovery.evaluated >= COMPONENT_MIN.recoveryLosses
          ? round1(result.recovery.calm / result.recovery.evaluated) : null,
      },
    });

    if (isNum(score)) state.score = score;
    if (level) state.level = level;
    if (headline) state.headlineType = headline.type;
  }

  return { rows, state };
}

// ─── Week-over-week trend facts ──────────────────────────────────────────────

function windowSummary(trades, reflections) {
  const psych = trades.filter(hasPsych);
  const negTags = new Map();
  const labels = {};
  for (const t of trades) {
    for (const tag of negTagsOf(t)) {
      if (tag === "revenge") continue;
      negTags.set(tag, (negTags.get(tag) || 0) + 1);
      labels[tag] = labelFor(t, tag);
    }
  }
  const costByCurrency = {};
  for (const t of trades) {
    if (!isSlip(t) || !isLoss(t)) continue;
    const cur = t.currency || "USD";
    costByCurrency[cur] = (costByCurrency[cur] || 0) + Math.abs(t.profit);
  }
  const planned = reflections.filter((r) => !r.skipped && PLAN_VALUE[r.followedPlan] !== undefined);
  return {
    trades: trades.length,
    psych: psych.length,
    revenge: trades.filter(isRevenge).length,
    impulsive: trades.filter(isImpulsive).length,
    negTags,
    labels,
    recovery: computeRecovery(trades),
    costByCurrency,
    planTotal: planned.length,
    planRate: planned.length ? planned.reduce((s, r) => s + PLAN_VALUE[r.followedPlan], 0) / planned.length : null,
    tagRate: trades.length ? psych.length / trades.length : null,
  };
}

/**
 * Compares the last 7 days with the 7 before. Only claims a change when both
 * weeks carry enough logged psychology to make the comparison honest.
 */
function computeTrend(trades, reflections, today) {
  const aFrom = addDays(today, -6);
  const bFrom = addDays(today, -13);
  const bTo = addDays(today, -7);
  const A = windowSummary(trades.filter((t) => inRange(t.day, aFrom, today)), reflections.filter((r) => inRange(r.day, aFrom, today)));
  const B = windowSummary(trades.filter((t) => inRange(t.day, bFrom, bTo)), reflections.filter((r) => inRange(r.day, bFrom, bTo)));
  const facts = [];
  const enough = A.psych >= 3 && B.psych >= 3;
  const conf = Math.min(1, (A.psych + B.psych) / 20);
  const add = (type, sign, magnitude, evidence) => facts.push({ type, sign, score: round1(magnitude * (0.5 + 0.5 * conf) * 100) / 100, evidence });

  if (enough) {
    if (B.revenge >= 1 && A.revenge < B.revenge) add("revenge_down", 1, (B.revenge - A.revenge) / B.revenge + 0.3, { before: B.revenge, after: A.revenge });
    if (A.revenge >= 2 && A.revenge > B.revenge) add("revenge_up", -1, (A.revenge - B.revenge) / A.revenge, { before: B.revenge, after: A.revenge });

    let bestDown = null;
    let bestUp = null;
    for (const tag of new Set([...A.negTags.keys(), ...B.negTags.keys()])) {
      const a = A.negTags.get(tag) || 0;
      const b = B.negTags.get(tag) || 0;
      const label = A.labels[tag] || B.labels[tag];
      if (b >= 2 && a <= b - 1 && (b - a) / b >= 0.33) {
        const m = (b - a) / b;
        if (!bestDown || m > bestDown.m) bestDown = { m, tag: label, before: b, after: a };
      }
      if (a >= 2 && a >= b + 2) {
        const m = (a - b) / a;
        if (!bestUp || m > bestUp.m) bestUp = { m, tag: label, before: b, after: a };
      }
    }
    if (bestDown) add("tag_down", 1, bestDown.m, { tag: bestDown.tag, before: bestDown.before, after: bestDown.after });
    if (bestUp) add("tag_up", -1, bestUp.m, { tag: bestUp.tag, before: bestUp.before, after: bestUp.after });

    if (B.impulsive >= 2 && A.impulsive < B.impulsive) add("impulsive_down", 1, (B.impulsive - A.impulsive) / B.impulsive, { before: B.impulsive, after: A.impulsive });
    if (A.impulsive >= 2 && A.impulsive >= B.impulsive + 2) add("impulsive_up", -1, (A.impulsive - B.impulsive) / A.impulsive, { before: B.impulsive, after: A.impulsive });

    if (A.tagRate != null && B.tagRate != null && A.tagRate - B.tagRate >= 0.2) {
      add("tagging_up", 1, A.tagRate - B.tagRate, { beforePct: Math.round(B.tagRate * 100), afterPct: Math.round(A.tagRate * 100) });
    }

    for (const cur of Object.keys(B.costByCurrency)) {
      const b = B.costByCurrency[cur];
      const a = A.costByCurrency[cur] || 0;
      if (b > 0 && a <= 0.5 * b) add("cost_down", 1, (b - a) / b, { before: Math.round(b), after: Math.round(a), currency: cur });
    }
  }

  if (A.recovery.evaluated >= 2 && B.recovery.evaluated >= 2) {
    const ra = A.recovery.calm / A.recovery.evaluated;
    const rb = B.recovery.calm / B.recovery.evaluated;
    if (ra - rb >= 0.2) add("recovery_up", 1, ra - rb, { beforeCalm: B.recovery.calm, beforeLosses: B.recovery.evaluated, afterCalm: A.recovery.calm, afterLosses: A.recovery.evaluated });
    if (rb - ra >= 0.2) add("recovery_down", -1, rb - ra, { beforeCalm: B.recovery.calm, beforeLosses: B.recovery.evaluated, afterCalm: A.recovery.calm, afterLosses: A.recovery.evaluated });
  }

  if (A.planTotal >= 3 && B.planTotal >= 3) {
    if (A.planRate - B.planRate >= 0.2) add("plan_up", 1, A.planRate - B.planRate, { beforePct: Math.round(B.planRate * 100), afterPct: Math.round(A.planRate * 100) });
    if (B.planRate - A.planRate >= 0.2) add("plan_down", -1, B.planRate - A.planRate, { beforePct: Math.round(B.planRate * 100), afterPct: Math.round(A.planRate * 100) });
  }

  facts.sort((x, y) => y.score - x.score || x.type.localeCompare(y.type));
  return { facts, current: A, previous: B };
}

// ─── Mind Wins ───────────────────────────────────────────────────────────────

const HONEST_STREAK_STEPS = [20, 50, 100];
const PLAN_RUN_STEPS = [3, 5, 7, 10, 14, 21, 30];

/**
 * Personal-baseline wins earned as of `today`. Each needs history to compare
 * against, so a brand-new trader can't trip "fewest ever" on day three.
 *
 * @returns {{ wins: {key, periodKey, evidence}[], baselines: object }}
 */
function detectWins({ trades, reflections, today, trend, baselines = {}, selfAwareness = null, recoveryRate = null }) {
  const wins = [];
  const nextBaselines = { ...baselines };
  const week = isoWeekOfDay(today);
  const A = trend.current;
  const B = trend.previous;
  const aFrom = addDays(today, -6);

  if (A.recovery.losses >= 3 && A.recovery.tilt === 0 && A.revenge === 0 && (B.recovery.tilt + B.revenge) >= 1) {
    wins.push({ key: "calm_under_pressure", periodKey: week, evidence: { losses: A.recovery.losses, beforeSlips: B.recovery.tilt + B.revenge } });
  }

  const revengeBefore = trades.filter((t) => t.day < aFrom && isRevenge(t)).length;
  if (A.trades >= 3 && A.revenge === 0 && revengeBefore >= 1) {
    wins.push({ key: "zero_revenge_week", periodKey: "once", evidence: { trades: A.trades, revengeBefore } });
  }

  if (A.psych >= 3) {
    let best = null;
    for (const [tag, b] of B.negTags) {
      const a = A.negTags.get(tag) || 0;
      if (b >= 2 && a <= Math.floor(b / 2) && (!best || b - a > best.drop)) best = { tag, drop: b - a, before: b, after: a, label: B.labels[tag] };
    }
    if (best) wins.push({ key: "tag_halved", periodKey: `${best.tag}:${week}`, evidence: { tag: best.label, before: best.before, after: best.after } });

    for (const cur of Object.keys(B.costByCurrency)) {
      const b = B.costByCurrency[cur];
      const a = A.costByCurrency[cur] || 0;
      if (b > 0 && a <= 0.5 * b) {
        wins.push({ key: "cost_halved", periodKey: `${cur}:${week}`, evidence: { before: Math.round(b), after: Math.round(a), currency: cur } });
      }
    }
  }

  // Plan-followed run ending today or yesterday (tonight's reflection may
  // not be in yet), beating the trader's own previous best.
  const reflMap = new Map(reflections.filter((r) => !r.skipped).map((r) => [r.day, r]));
  let cursor = reflMap.has(today) ? today : addDays(today, -1);
  let run = 0;
  while (reflMap.has(cursor) && (reflMap.get(cursor).followedPlan === "yes" || reflMap.get(cursor).followedPlan === "no_trades")) {
    run += 1;
    cursor = addDays(cursor, -1);
  }
  // Only at milestone lengths, so a growing run doesn't award a "new best"
  // every single evening.
  if (PLAN_RUN_STEPS.includes(run) && run > (baselines.bestPlanRun || 0)) {
    wins.push({ key: "plan_run_best", periodKey: `run:${run}`, evidence: { days: run, previousBest: baselines.bestPlanRun || 0 } });
  }
  nextBaselines.bestPlanRun = Math.max(baselines.bestPlanRun || 0, run);

  if (selfAwareness && isNum(selfAwareness.score) && selfAwareness.tracked >= 5) {
    const prevBest = baselines.bestSelfAwareness;
    if (selfAwareness.score >= 70 && (prevBest == null || selfAwareness.score >= prevBest + 5)) {
      wins.push({ key: "self_awareness_best", periodKey: `pb:${selfAwareness.score}`, evidence: { score: selfAwareness.score, previousBest: prevBest, reviews: selfAwareness.tracked } });
    }
    nextBaselines.bestSelfAwareness = Math.max(prevBest ?? 0, selfAwareness.score);
  }
  if (isNum(recoveryRate)) {
    nextBaselines.bestRecoveryRate = Math.max(baselines.bestRecoveryRate ?? 0, recoveryRate);
  }

  // Consecutive most-recent trades with emotions/entry basis/mood logged.
  const ordered = sortTrades(trades).reverse();
  let honest = 0;
  for (const t of ordered) {
    if (!hasPsych(t)) break;
    honest += 1;
  }
  for (const step of HONEST_STREAK_STEPS) {
    if (honest >= step) wins.push({ key: `honest_journal_${step}`, periodKey: "once", evidence: { trades: step } });
  }

  return { wins, baselines: nextBaselines };
}

// ─── Targets ─────────────────────────────────────────────────────────────────

const TARGET_GOAL = 5;
const TARGET_DAYS = 7;

/** 'clean' | 'slip' | null (nothing relevant happened that day). */
function evaluateTargetDay(preset, params = {}, dayTrades = [], dayReflection = null) {
  const ordered = sortTrades(dayTrades);
  switch (preset) {
    case "no_tag": {
      if (!ordered.length || !params.tag) return null;
      const tag = String(params.tag).toLowerCase();
      return ordered.some((t) => t.tags.includes(tag) || (tag === "revenge" && isRevenge(t))) ? "slip" : "clean";
    }
    case "follow_rule": {
      const rule = String(params.rule || "").trim().toLowerCase();
      if (!rule) return null;
      const hits = [];
      for (const t of ordered) for (const r of t.rules || []) if (String(r.label || "").trim().toLowerCase() === rule) hits.push(r);
      if (!hits.length) return null;
      return hits.every((r) => r.followed) ? "clean" : "slip";
    }
    case "stop_after_losses": {
      if (!ordered.length) return null;
      const n = Math.max(1, Number(params.n) || 2);
      let losses = 0;
      for (let i = 0; i < ordered.length; i += 1) {
        if (isLoss(ordered[i])) losses += 1;
        if (losses >= n && i < ordered.length - 1) return "slip";
      }
      return "clean";
    }
    case "tag_every_trade": {
      if (!ordered.length) return null;
      return ordered.every(hasPsych) ? "clean" : "slip";
    }
    case "plan_days": {
      if (!dayReflection || dayReflection.skipped || !dayReflection.followedPlan) return null;
      return dayReflection.followedPlan === "yes" || dayReflection.followedPlan === "no_trades" ? "clean" : "slip";
    }
    default:
      return null;
  }
}

/**
 * Progress of a 7-day target as of `today`.
 * @returns {{ dayResults, cleanDays, activeDays, status, completedDay }}
 */
function evaluateTarget(target, trades, reflections, today) {
  const tradesByDay = groupByDay(trades);
  const reflByDay = new Map(reflections.map((r) => [r.day, r]));
  const goal = target.goal || TARGET_GOAL;
  const last = today < target.endDay ? today : target.endDay;
  const dayResults = {};
  let cleanDays = 0;
  let activeDays = 0;
  let completedDay = null;
  for (let d = target.startDay; d <= last; d = addDays(d, 1)) {
    const result = evaluateTargetDay(target.preset, target.params, tradesByDay.get(d) || [], reflByDay.get(d) || null);
    if (!result) continue;
    dayResults[d] = result;
    activeDays += 1;
    if (result === "clean") {
      cleanDays += 1;
      if (cleanDays >= goal && !completedDay) completedDay = d;
    }
  }
  let status = "active";
  if (completedDay) status = "completed";
  else if (today > target.endDay) status = "expired";
  return { dayResults, cleanDays, activeDays, status, completedDay };
}

/**
 * Targets built from the trader's own leaks, most relevant first. Always
 * includes the two presets that make sense for anyone.
 */
function suggestTargets(trades, reflections) {
  const out = [];
  const negCounts = new Map();
  const labels = {};
  for (const t of trades) {
    for (const tag of negTagsOf(t)) {
      negCounts.set(tag, (negCounts.get(tag) || 0) + 1);
      labels[tag] = labelFor(t, tag);
    }
    if (isRevenge(t) && !t.tags.includes("revenge")) {
      negCounts.set("revenge", (negCounts.get("revenge") || 0) + 1);
      labels.revenge = "Revenge";
    }
  }
  const topNeg = topCount(negCounts);
  if (topNeg && topNeg[1] >= 2) {
    out.push({ preset: "no_tag", params: { tag: topNeg[0], label: labels[topNeg[0]] }, evidence: { count: topNeg[1] }, rank: 100 + topNeg[1] });
  }

  const ruleStats = new Map();
  for (const t of trades) {
    for (const r of t.rules || []) {
      const label = String(r?.label || "").trim();
      if (!label) continue;
      const s = ruleStats.get(label) || { kept: 0, total: 0 };
      s.total += 1;
      if (r.followed) s.kept += 1;
      ruleStats.set(label, s);
    }
  }
  let weakest = null;
  for (const [label, s] of ruleStats) {
    const rate = s.kept / s.total;
    if (s.total >= 3 && rate < 0.8 && (!weakest || rate < weakest.rate)) weakest = { label, rate, total: s.total };
  }
  if (weakest) {
    out.push({ preset: "follow_rule", params: { rule: weakest.label }, evidence: { followPct: Math.round(weakest.rate * 100), total: weakest.total }, rank: 90 + Math.round((1 - weakest.rate) * 10) });
  }

  let tiltDays = 0;
  for (const [, dayTrades] of groupByDay(trades)) {
    if (evaluateTargetDay("stop_after_losses", { n: 2 }, dayTrades) === "slip") tiltDays += 1;
  }
  if (tiltDays >= 1) out.push({ preset: "stop_after_losses", params: { n: 2 }, evidence: { days: tiltDays }, rank: 80 + tiltDays });

  const tagRate = trades.length ? trades.filter(hasPsych).length / trades.length : 0;
  out.push({ preset: "tag_every_trade", params: {}, evidence: { taggedPct: Math.round(tagRate * 100), trades: trades.length }, rank: trades.length >= 3 && tagRate < 0.8 ? 85 : 20 });

  const planned = reflections.filter((r) => !r.skipped && r.followedPlan);
  out.push({ preset: "plan_days", params: { need: TARGET_GOAL }, evidence: { reflections: planned.length }, rank: 30 });

  return out.sort((a, b) => b.rank - a.rank).map(({ rank, ...rest }) => rest);
}

module.exports = {
  // constants
  ALPHA,
  COMPONENT_MIN,
  DAY_TRADE_CAP,
  FLOOR,
  LEVELS,
  LEVEL_HYSTERESIS,
  MAX_DROP,
  RECOMPUTE_DAYS,
  STALE_AFTER_DAYS,
  TARGET_DAYS,
  TARGET_GOAL,
  UNLOCK_DAYS,
  WEIGHTS,
  WINDOW_DAYS,
  // helpers
  addDays,
  diffDays,
  isoWeekOfDay,
  hasPsych,
  isSlip,
  isRevenge,
  // engine
  apportionReasons,
  applyLevel,
  buildDailyRows,
  computeComponents,
  computeDayFacts,
  computeRecovery,
  computeTrend,
  detectWins,
  evaluateTarget,
  evaluateTargetDay,
  journaledDaySet,
  levelFor,
  levelInfo,
  nextLevelInfo,
  selectHeadline,
  smoothScore,
  suggestTargets,
};
