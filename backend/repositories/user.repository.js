const User = require("../models/Users");

async function findUsersForWeeklyReports() {
  return User.find(REACHABLE_USER_FILTER, { _id: 1, preferredMarket: 1, "streaks.timezone": 1 }).lean();
}

// Session reminders need the market signal on the user record plus the
// streak timezone so the reminder day can be keyed in the user's zone.
async function findUsersForSessionReminders() {
  return User.find(
    REACHABLE_USER_FILTER,
    { _id: 1, preferredMarket: 1, "streaks.timezone": 1 }
  ).lean();
}

// Users whose journal streak is alive (≥3 days) — candidates for the
// "don't lose your streak" evening push. The cron filters further in JS by
// checking whether today is already their lastQualifyingDate.
async function findUsersWithActiveJournalStreak(minStreak = 3) {
  return User.find(
    { "streaks.journal.current": { $gte: minStreak } },
    {
      _id: 1,
      "streaks.journal.current": 1,
      "streaks.journal.lastQualifyingDate": 1,
      "streaks.timezone": 1,
    }
  ).lean();
}

// Accounts that may receive scheduled notifications: not staff, not disabled
// by an admin, not mid-deletion. (Morning mentor / reflection used to go to
// literally every User document, admins and disabled accounts included.)
const REACHABLE_USER_FILTER = Object.freeze({
  role: { $ne: "admin" },
  accountStatus: { $ne: "disabled" },
  pendingDeletion: { $ne: true },
});

// Distinct stored timezones among reachable users. null stands for "not set"
// (older documents predate the field; they resolve to the default zone).
async function findDistinctReminderTimezones() {
  const values = await User.distinct("streaks.timezone", REACHABLE_USER_FILTER);
  return [...new Set([...values, null])];
}

// Reachable users whose stored timezone is one of `rawTimezones`. Pass null in
// the list to include users with no timezone stored.
async function findReachableUsersByTimezone(rawTimezones, projection = {}) {
  const values = rawTimezones.filter((tz) => tz !== null && tz !== undefined && tz !== "");
  const or = [{ "streaks.timezone": { $in: values } }];
  if (rawTimezones.some((tz) => tz === null || tz === undefined || tz === "")) {
    or.push({ "streaks.timezone": { $exists: false } }, { "streaks.timezone": null }, { "streaks.timezone": "" });
  }
  return User.find(
    { ...REACHABLE_USER_FILTER, $or: or },
    { _id: 1, preferredMarket: 1, "streaks.timezone": 1, "streaks.journal": 1, ...projection }
  ).lean();
}

module.exports = {
  REACHABLE_USER_FILTER,
  findDistinctReminderTimezones,
  findReachableUsersByTimezone,
  findUsersForWeeklyReports,
  findUsersForSessionReminders,
  findUsersWithActiveJournalStreak,
};
