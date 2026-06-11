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
    const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (dateOnly) {
      // Date inputs do not include a clock time; use the actual save-time clock.
      const [, year, month, day] = dateOnly;
      const now = new Date();
      parsed = new Date(
        Number(year),
        Number(month) - 1,
        Number(day),
        now.getHours(),
        now.getMinutes(),
        now.getSeconds(),
        now.getMilliseconds()
      );
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
