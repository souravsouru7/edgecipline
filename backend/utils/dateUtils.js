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

module.exports = {
  toUtcDayStart,
  normalizeTradeDate,
};
