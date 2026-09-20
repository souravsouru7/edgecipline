const ApiError = require("./ApiError");

// Normalise a Date to the start of its UTC calendar day (midnight UTC).
// Used to compare dates without caring about time-of-day.
function toUtcDayStart(date) {
  const d = new Date(date);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Parse and validate a trade date value.
 *
 * @param {Date|string} tradeDate
 * @param {{ accountCreatedAt?: Date|string }} [options]
 *   accountCreatedAt – when provided, the trade date must not precede the
 *   UTC calendar day on which the account was created.
 * @returns {Date}
 */
function normalizeTradeDate(tradeDate, { accountCreatedAt } = {}) {
  if (!tradeDate) {
    return null;
  }

  let parsed;

  if (tradeDate instanceof Date) {
    if (Number.isNaN(tradeDate.getTime())) {
      throw new ApiError(400, "Trade date is invalid", "VALIDATION_ERROR");
    }
    parsed = tradeDate;
  } else {
    const raw = String(tradeDate).trim();
    const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);

    if (dateOnly) {
      // Preserve the submitted calendar date at a stable local noon. Browser
      // date inputs submit YYYY-MM-DD, while some mobile/native callers send
      // ISO strings with an offset; using Date(raw) would convert the day
      // through UTC and can file late-night local trades under the next
      // calendar day. A fixed time also keeps retry/deduplication keys stable.
      const [, year, month, day] = dateOnly;
      parsed = new Date(
        Number(year),
        Number(month) - 1,
        Number(day),
        12,
        0,
        0,
        0
      );
      // JS silently rolls invalid day/month values over into a different
      // real date (e.g. Feb 29 in a non-leap year becomes Mar 1, day 32
      // becomes the 1st/2nd of the next month) instead of erroring -- so a
      // typo can misfile a trade onto the wrong day with no warning at all.
      // Round-trip the parsed value against the original input to catch it.
      if (
        parsed.getFullYear() !== Number(year) ||
        parsed.getMonth() !== Number(month) - 1 ||
        parsed.getDate() !== Number(day)
      ) {
        throw new ApiError(400, "Trade date is invalid", "VALIDATION_ERROR");
      }
    } else {
      parsed = new Date(raw);
    }

    if (Number.isNaN(parsed.getTime())) {
      throw new ApiError(400, "Trade date is invalid", "VALIDATION_ERROR");
    }
  }

  // Upper bound: no future calendar dates. Date-only inputs are stored at noon
  // UTC, so comparing full timestamps can reject "today" before 12:00 UTC.
  if (toUtcDayStart(parsed) > toUtcDayStart(new Date())) {
    throw new ApiError(400, "Trade date cannot be in the future", "VALIDATION_ERROR");
  }

  // Lower bound: date must not precede the account creation day (UTC).
  if (accountCreatedAt) {
    const accountDayStart = toUtcDayStart(accountCreatedAt);
    if (toUtcDayStart(parsed) < accountDayStart) {
      throw new ApiError(
        400,
        "Trade date cannot be before your account creation date",
        "DATE_BEFORE_ACCOUNT_CREATION"
      );
    }
  }

  return parsed;
}

// Calendar-day arithmetic on a Date (local time). Used for subscription and
// trial expiry math.
function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

// "YYYY-MM-DDTHH" bucket key. Cron jobs use it as a Redis lock/idempotency
// suffix so a job that runs twice within the same hour is a no-op.
function hourlyKey(date = new Date()) {
  return date.toISOString().slice(0, 13);
}

// setMonth()/setFullYear() don't clamp -- subtracting a month from e.g. Mar
// 31 overflows into Feb 31, which JS silently rolls into Mar 3 instead of
// erroring, shrinking the "last month" filter to skip nearly all of
// February. Set the day to 1 before changing month/year (so the change
// itself can't overflow), then clamp back to the last real day of the
// resulting month. Same rollover class as the bug fixed in normalizeTradeDate.
function subtractMonthsClamped(date, months) {
  const originalDay = date.getDate();
  const result = new Date(date);
  result.setDate(1);
  result.setMonth(result.getMonth() - months);
  const daysInResultMonth = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(originalDay, daysInResultMonth));
  return result;
}

// Start boundary for the trade-list `period` query param ("1w" | "1m" |
// "3m" | "1y"). Anything else means "all time" and returns null.
function getPeriodStart(period) {
  const now = new Date();
  const start = new Date(now);

  switch (String(period || "all").toLowerCase()) {
    case "1w":
      start.setDate(start.getDate() - 7);
      return start;
    case "1m":
      return subtractMonthsClamped(now, 1);
    case "3m":
      return subtractMonthsClamped(now, 3);
    case "1y":
      return subtractMonthsClamped(now, 12);
    default:
      return null;
  }
}

module.exports = {
  toUtcDayStart,
  normalizeTradeDate,
  addDays,
  hourlyKey,
  subtractMonthsClamped,
  getPeriodStart,
};
