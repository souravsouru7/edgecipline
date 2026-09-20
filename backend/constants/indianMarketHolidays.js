"use strict";

/**
 * NSE/BSE trading holidays (equity + F&O), "YYYY-MM-DD" in Asia/Kolkata.
 *
 * Source of truth is the exchange circular published each December. Keep this
 * list in step with it, or override at runtime without a deploy via
 * INDIAN_MARKET_HOLIDAYS="2026-01-26,2026-03-03,..." (env replaces, not
 * merges, so the override must be the complete list).
 *
 * Only *closed* days belong here. Muhurat trading days (Diwali) are closed for
 * the normal session, so they stay in the list; the one-hour evening session
 * is not something a 09:00 "market opens at 9:15" reminder should fire for.
 *
 * Weekends are handled by marketCalendar and must not be listed here.
 */
const INDIAN_MARKET_HOLIDAYS = [
  // 2026 — verify against the NSE "Trading Holidays 2026" circular before the
  // year starts; dates below follow the published calendar as of release.
  "2026-01-26", // Republic Day
  "2026-03-03", // Holi
  "2026-03-26", // Shri Ram Navami
  "2026-03-31", // Shri Mahavir Jayanti
  "2026-04-03", // Good Friday
  "2026-04-14", // Dr. Baba Saheb Ambedkar Jayanti
  "2026-05-01", // Maharashtra Day
  "2026-05-28", // Bakri Id
  "2026-06-26", // Muharram
  "2026-09-14", // Ganesh Chaturthi
  "2026-10-02", // Mahatma Gandhi Jayanti
  "2026-10-20", // Dussehra
  "2026-11-08", // Diwali (Laxmi Pujan) — Muhurat session only
  "2026-11-09", // Diwali Balipratipada
  "2026-11-24", // Prakash Gurpurb Sri Guru Nanak Dev
  "2026-12-25", // Christmas
];

module.exports = { INDIAN_MARKET_HOLIDAYS };
