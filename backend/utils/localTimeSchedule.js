// "Send at 07:00 in each user's own timezone."
//
// The daily reminder crons (morning mentor, evening reflection, streak
// protector) used to fire once at a fixed IST time for everyone, so a London
// user got the 07:00 "morning" push at 01:30. They now tick every 15 minutes
// and, on each tick, pick the timezones whose local time has just reached the
// target. A per-user, per-local-day dedupe key keeps it to one push a day, and
// a per-(timezone, local date) lock held to expiry keeps a second tick inside
// the window (or a peer instance) from fanning out again.

const { getLocalDateKey, getTimeZoneParts, resolveTimeZone, DEFAULT_NOTIFICATION_TIMEZONE } = require("./timezone");

// A target is due from its time until this much later, so one late or missed
// 15-minute tick still sends.
const DUE_WINDOW_MINUTES = 30;

function minutesOfDay(parts) {
  return parts.hour * 60 + parts.minute;
}

/** True when `now` in `timezone` is within [target, target + window). */
function isLocalTimeDue(now, timezone, target, windowMinutes = DUE_WINDOW_MINUTES) {
  const parts = getTimeZoneParts(now, resolveTimeZone(timezone));
  const start = target.hour * 60 + (target.minute || 0);
  const current = minutesOfDay(parts);
  return current >= start && current < start + windowMinutes;
}

/**
 * Of the given timezones, those where the target local time is due now.
 * Unknown/invalid zones resolve to the default (IST) — the same fallback every
 * other per-user computation uses.
 */
function dueTimezones(now, timezones, target, windowMinutes = DUE_WINDOW_MINUTES) {
  const seen = new Set();
  const due = [];
  for (const raw of timezones) {
    const tz = resolveTimeZone(raw || DEFAULT_NOTIFICATION_TIMEZONE);
    if (seen.has(tz)) continue;
    seen.add(tz);
    if (isLocalTimeDue(now, tz, target, windowMinutes)) due.push(tz);
  }
  return due;
}

// Every local-time job ticks on this schedule, whatever the legacy *_CRON env
// var says ("0 7 * * *" would tick once a day and miss every other zone).
const LOCAL_TIME_TICK = "*/15 * * * *";

/** "HH:MM" → { hour, minute }, or the fallback when malformed. */
function parseLocalTime(value, fallback) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || "").trim());
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : fallback;
}

/** Lock suffix for one (timezone, local date) slot of a daily job. */
function slotKey(now, timezone) {
  return `${resolveTimeZone(timezone)}:${getLocalDateKey(now, timezone)}`;
}

module.exports = {
  DUE_WINDOW_MINUTES,
  LOCAL_TIME_TICK,
  parseLocalTime,
  dueTimezones,
  isLocalTimeDue,
  slotKey,
};
