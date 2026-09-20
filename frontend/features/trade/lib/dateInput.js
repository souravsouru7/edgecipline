// Helpers for <input type="date"> values (always "YYYY-MM-DD" in the user's
// local calendar). Shared by every add/edit/upload trade form so they all
// agree on what "today" is and how a stored date maps back onto the picker.

// Today's local calendar date as a date-input value. Built by shifting the
// timestamp by the timezone offset before taking the ISO date part, so a user
// in IST at 01:00 gets their own date rather than yesterday's UTC date.
export const getTodayInputValue = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().split("T")[0];
};

// Coerce a stored trade date (Date, ISO string, or already a date-input
// value) into a date-input value. An exact "YYYY-MM-DD" string is returned as
// is: re-parsing it would go through UTC midnight and could shift the day for
// users west of Greenwich.
export const normalizeDateForInput = (value) => {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(value.getTime() - value.getTimezoneOffset() * 60000)
      .toISOString()
      .split("T")[0];
  }
  const raw = String(value).trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .split("T")[0];
};
