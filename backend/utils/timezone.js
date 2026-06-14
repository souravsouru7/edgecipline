const DEFAULT_NOTIFICATION_TIMEZONE = "Asia/Kolkata";
const DAY_MS = 24 * 60 * 60 * 1000;

function asDate(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function resolveTimeZone(timezone, fallback = DEFAULT_NOTIFICATION_TIMEZONE) {
  const candidate = typeof timezone === "string" && timezone.trim() ? timezone.trim() : fallback;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch (error) {
    return fallback;
  }
}

function getTimeZoneParts(date, timezone) {
  const safeTimezone = resolveTimeZone(timezone);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(asDate(date));

  const values = {};
  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function getLocalDateKey(date = new Date(), timezone = DEFAULT_NOTIFICATION_TIMEZONE) {
  const parts = getTimeZoneParts(date, timezone);
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

function localPartsToDateKey(parts) {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

function getLocalCalendarDateAfter(parts, days) {
  const utcDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: utcDate.getUTCFullYear(),
    month: utcDate.getUTCMonth() + 1,
    day: utcDate.getUTCDate(),
  };
}

function zonedTimeToUtc(parts, timezone) {
  const safeTimezone = resolveTimeZone(timezone);
  const targetUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour || 0,
    parts.minute || 0,
    parts.second || 0,
    parts.millisecond || 0
  );

  let utcTime = targetUtc;
  for (let index = 0; index < 3; index += 1) {
    const actual = getTimeZoneParts(new Date(utcTime), safeTimezone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour || 0,
      actual.minute || 0,
      actual.second || 0,
      parts.millisecond || 0
    );
    const delta = targetUtc - actualAsUtc;
    if (delta === 0) break;
    utcTime += delta;
  }

  return new Date(utcTime);
}

function getDayRange(date = new Date(), timezone = DEFAULT_NOTIFICATION_TIMEZONE) {
  const localDate = getTimeZoneParts(date, timezone);
  const start = zonedTimeToUtc({ ...localDate, hour: 0, minute: 0, second: 0, millisecond: 0 }, timezone);
  const nextLocalDate = getLocalCalendarDateAfter(localDate, 1);
  const end = zonedTimeToUtc({ ...nextLocalDate, hour: 0, minute: 0, second: 0, millisecond: 0 }, timezone);

  return { start, end };
}

function getWeekStart(date = new Date(), timezone = DEFAULT_NOTIFICATION_TIMEZONE) {
  const localDate = getTimeZoneParts(date, timezone);
  const localDayOfWeek = new Date(Date.UTC(localDate.year, localDate.month - 1, localDate.day)).getUTCDay();
  const daysSinceMonday = localDayOfWeek === 0 ? 6 : localDayOfWeek - 1;
  const weekStartDate = getLocalCalendarDateAfter(localDate, -daysSinceMonday);

  return zonedTimeToUtc({ ...weekStartDate, hour: 0, minute: 0, second: 0, millisecond: 0 }, timezone);
}

function getWeekKey(date = new Date(), timezone = DEFAULT_NOTIFICATION_TIMEZONE) {
  return getLocalDateKey(getWeekStart(date, timezone), timezone);
}

function getWindowKey(date = new Date(), timezone = DEFAULT_NOTIFICATION_TIMEZONE, windowHours = 6) {
  const parts = getTimeZoneParts(date, timezone);
  const safeWindowHours = Math.max(1, Number(windowHours) || 6);
  return Math.floor(parts.hour / safeWindowHours);
}

function formatLocalTime(date = new Date(), timezone = DEFAULT_NOTIFICATION_TIMEZONE) {
  const parts = getTimeZoneParts(date, timezone);
  return `${localPartsToDateKey(parts)} ${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}`;
}

module.exports = {
  DEFAULT_NOTIFICATION_TIMEZONE,
  asDate,
  formatLocalTime,
  getDayRange,
  getLocalDateKey,
  getWeekKey,
  getWeekStart,
  getWindowKey,
  resolveTimeZone,
  zonedTimeToUtc,
};
