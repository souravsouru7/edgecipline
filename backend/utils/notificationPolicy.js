// Delivery policy shared by notifyUser, the FCM payload builder and the
// notification worker. Pure functions + constants only, so every rule here is
// unit-tested without Mongo or Firebase (__tests__/unit/notificationPolicy.test.js).

const {
  getLocalCalendarDateAfter,
  getTimeZoneParts,
  resolveTimeZone,
  zonedTimeToUtc,
} = require("./timezone");

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// ─── Expiry ────────────────────────────────────────────────────────────────
// How long FCM/APNs may hold an undelivered push. A reminder about something
// time-bound is worse than useless once that moment has passed: Friday's
// "New York opens soon" must not land on Saturday because the phone was
// offline. Types not listed use DEFAULT_TTL_MS.
const TTL_MS_BY_TYPE = Object.freeze({
  session_reminder: 30 * MINUTE,
  morning_mentor: 3 * HOUR,
  evening_reflection: 3 * HOUR,
  streak_at_risk: 2 * HOUR,
  mission_update: 6 * HOUR,
  // Risk alerts are about the trade just taken.
  revenge_trading: HOUR,
  overtrading: HOUR,
  no_stop_loss: HOUR,
  daily_loss_warning: HOUR,
  setup_discipline: 3 * HOUR,
  mood_risk: 3 * HOUR,
  confidence_reminder: 3 * HOUR,
});
const DEFAULT_TTL_MS = 24 * HOUR;

function getTtlMs(type) {
  return TTL_MS_BY_TYPE[type] ?? DEFAULT_TTL_MS;
}

// Same-type reminders replace each other in the tray instead of stacking.
const COLLAPSIBLE_TYPES = new Set([
  "session_reminder",
  "morning_mentor",
  "evening_reflection",
  "streak_at_risk",
  "weekly_report_reminder",
]);

function getCollapseKey(type) {
  return COLLAPSIBLE_TYPES.has(type) ? `edgecipline_${type}` : null;
}

// ─── Queue staleness ───────────────────────────────────────────────────────
// A queued job that sat in Redis longer than this (worker down, backlog) is
// dropped rather than delivered late: "Premium ends tomorrow" after it ended,
// or "step away now" about yesterday's trade.
const MAX_QUEUE_AGE_MS = Object.freeze({
  delivery: 6 * HOUR,
  smartChecks: 3 * HOUR,
});

function isQueueJobStale(kind, enqueuedAtMs, nowMs = Date.now()) {
  const limit = MAX_QUEUE_AGE_MS[kind];
  if (!limit || !Number.isFinite(enqueuedAtMs)) return false;
  return nowMs - enqueuedAtMs > limit;
}

// ─── Promotional window ────────────────────────────────────────────────────
// Upsell / win-back pushes (subscription rescue + free-tier funnel) come from
// hourly crons on the server clock. Only deliver them during the user's
// daytime; outside it they are skipped and the hourly cron's next pass in the
// window picks the touchpoint up again.
const PROMOTIONAL_TYPE_PREFIXES = ["renewal_", "winback_", "free_tier_"];
const PROMO_WINDOW = Object.freeze({ startHour: 9, endHour: 21 });

function isPromotionalType(type) {
  return PROMOTIONAL_TYPE_PREFIXES.some((prefix) => String(type || "").startsWith(prefix));
}

function localHour(date, timezone) {
  return getTimeZoneParts(date, resolveTimeZone(timezone)).hour;
}

function isWithinPromoWindow(date = new Date(), timezone) {
  const hour = localHour(date, timezone);
  return hour >= PROMO_WINDOW.startHour && hour < PROMO_WINDOW.endHour;
}

// Milliseconds until the next promo window opens in the user's timezone
// (0 if already inside). Used to DELAY a promotional push rather than drop
// it: each funnel touchpoint is enqueued exactly once.
function msUntilPromoWindow(date = new Date(), timezone) {
  const tz = resolveTimeZone(timezone);
  if (isWithinPromoWindow(date, tz)) return 0;
  const parts = getTimeZoneParts(date, tz);
  // Before 09:00 → today 09:00; at/after 21:00 → tomorrow 09:00.
  const day = parts.hour < PROMO_WINDOW.startHour ? parts : getLocalCalendarDateAfter(parts, 1);
  const opensAt = zonedTimeToUtc({ ...day, hour: PROMO_WINDOW.startHour, minute: 0, second: 0 }, tz);
  return Math.max(0, opensAt.getTime() - date.getTime());
}

// ─── Daily cap ─────────────────────────────────────────────────────────────
// Ceiling on non-essential pushes per user per local day, across every
// producer (each cron only ever deduped its own type). Risk alerts about a
// trade just taken, support replies, OCR results and payment/system messages
// are never capped.
const DAILY_PUSH_CAP = 6;
const UNCAPPED_TYPES = new Set([
  "revenge_trading",
  "overtrading",
  "no_stop_loss",
  "daily_loss_warning",
  "ocr_completed",
  "ocr_failed",
  "issue_fixed",
  "admin_issue_report",
  "payment",
  "feedback",
  "system",
]);

function isCappedType(type) {
  if (UNCAPPED_TYPES.has(type)) return false;
  if (String(type || "").startsWith("support_")) return false;
  return true;
}

module.exports = {
  DAILY_PUSH_CAP,
  DEFAULT_TTL_MS,
  MAX_QUEUE_AGE_MS,
  PROMO_WINDOW,
  UNCAPPED_TYPES,
  getCollapseKey,
  getTtlMs,
  isCappedType,
  isPromotionalType,
  isQueueJobStale,
  isWithinPromoWindow,
  msUntilPromoWindow,
};
