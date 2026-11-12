"use strict";

/**
 * Market calendar — the single answer to "is this market open on this day?".
 *
 * Notification crons must ask this instead of checking weekdays themselves,
 * so weekend/holiday rules live in one place and are unit-testable without a
 * running cron. Time-of-day (session hours) is deliberately NOT modelled here:
 * the session definitions in sessionReminderCron own their reminder times.
 */

const {
  INDIAN_MARKET_HOLIDAYS,
  INDIAN_MARKET_RECURRING_HOLIDAYS,
} = require("../constants/indianMarketHolidays");
const { logger } = require("./logger");
const {
  DEFAULT_NOTIFICATION_TIMEZONE,
  getLocalDateKey,
  getLocalDayOfWeek,
} = require("./timezone");

const MARKETS = Object.freeze({
  FOREX: "Forex",
  INDIAN: "Indian_Market",
});

// Indian exchanges run on IST regardless of where the trader lives.
const INDIAN_MARKET_TIMEZONE = "Asia/Kolkata";

const CLOSED_REASONS = Object.freeze({
  WEEKEND: "WEEKEND",
  HOLIDAY: "HOLIDAY",
});

function parseHolidayList(raw) {
  return String(raw || "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
}

// Env override wins outright so ops can fix a wrong date without a deploy.
function getIndianMarketHolidays() {
  const override = parseHolidayList(process.env.INDIAN_MARKET_HOLIDAYS);
  return new Set(override.length ? override : INDIAN_MARKET_HOLIDAYS);
}

// The interbank FX market is effectively shut on these days every year.
const FOREX_HOLIDAYS_MMDD = new Set(["12-25", "01-01"]);

const warnedMissingHolidayYears = new Set();
function warnIfHolidayYearMissing(holidays, year) {
  if (warnedMissingHolidayYears.has(year)) return;
  const hasYear = [...holidays].some((day) => day.startsWith(`${year}-`));
  if (hasYear) return;
  warnedMissingHolidayYears.add(year);
  logger.warn("INDIAN_MARKET_HOLIDAYS_MISSING_FOR_YEAR", {
    year,
    action: "Add the NSE circular dates to constants/indianMarketHolidays.js or set INDIAN_MARKET_HOLIDAYS",
    fallback: "fixed-date national holidays only",
  });
}

function isWeekend(date, timezone) {
  const day = getLocalDayOfWeek(date, timezone);
  return day === 0 || day === 6;
}

/**
 * Forex trades roughly Sunday 22:00 UTC → Friday 22:00 UTC, but the sessions
 * we remind about (London, New York) only exist Monday–Friday in the trader's
 * local calendar. Saturday and Sunday are closed for reminder purposes.
 */
function getForexTradingDayStatus(date = new Date(), timezone = DEFAULT_NOTIFICATION_TIMEZONE) {
  if (isWeekend(date, timezone)) return { open: false, reason: CLOSED_REASONS.WEEKEND };
  if (FOREX_HOLIDAYS_MMDD.has(getLocalDateKey(date, timezone).slice(5))) {
    return { open: false, reason: CLOSED_REASONS.HOLIDAY };
  }
  return { open: true, reason: null };
}

function isForexTradingDay(date = new Date(), timezone = DEFAULT_NOTIFICATION_TIMEZONE) {
  return getForexTradingDayStatus(date, timezone).open;
}

/**
 * NSE/BSE: Monday–Friday, minus exchange holidays. Always evaluated in IST —
 * a user in another zone still cares whether Mumbai is open.
 */
function getIndianMarketDayStatus(date = new Date()) {
  if (isWeekend(date, INDIAN_MARKET_TIMEZONE)) return { open: false, reason: CLOSED_REASONS.WEEKEND };
  const dayKey = getLocalDateKey(date, INDIAN_MARKET_TIMEZONE);
  const holidays = getIndianMarketHolidays();
  if (holidays.has(dayKey)) return { open: false, reason: CLOSED_REASONS.HOLIDAY };
  // An env override is the complete list (ops fixing dates without a deploy),
  // so the built-in recurring days only apply when there is no override.
  const overridden = parseHolidayList(process.env.INDIAN_MARKET_HOLIDAYS).length > 0;
  if (!overridden) {
    if (INDIAN_MARKET_RECURRING_HOLIDAYS.includes(dayKey.slice(5))) {
      return { open: false, reason: CLOSED_REASONS.HOLIDAY };
    }
    warnIfHolidayYearMissing(holidays, dayKey.slice(0, 4));
  }
  return { open: true, reason: null };
}

function isIndianMarketOpenDay(date = new Date()) {
  return getIndianMarketDayStatus(date).open;
}

/**
 * Generic entry point used by the session cron: { open, reason } for any
 * supported market. Unknown market → treated as closed so a typo can never
 * fan out a reminder.
 */
function getMarketDayStatus(market, date = new Date(), timezone = DEFAULT_NOTIFICATION_TIMEZONE) {
  if (market === MARKETS.FOREX) return getForexTradingDayStatus(date, timezone);
  if (market === MARKETS.INDIAN) return getIndianMarketDayStatus(date);
  return { open: false, reason: "UNKNOWN_MARKET" };
}

module.exports = {
  MARKETS,
  CLOSED_REASONS,
  INDIAN_MARKET_TIMEZONE,
  getIndianMarketHolidays,
  getForexTradingDayStatus,
  getIndianMarketDayStatus,
  getMarketDayStatus,
  isForexTradingDay,
  isIndianMarketOpenDay,
};
