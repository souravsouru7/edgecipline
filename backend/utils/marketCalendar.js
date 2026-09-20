"use strict";

/**
 * Market calendar — the single answer to "is this market open on this day?".
 *
 * Notification crons must ask this instead of checking weekdays themselves,
 * so weekend/holiday rules live in one place and are unit-testable without a
 * running cron. Time-of-day (session hours) is deliberately NOT modelled here:
 * the session definitions in sessionReminderCron own their reminder times.
 */

const { INDIAN_MARKET_HOLIDAYS } = require("../constants/indianMarketHolidays");
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
  if (getIndianMarketHolidays().has(dayKey)) return { open: false, reason: CLOSED_REASONS.HOLIDAY };
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
