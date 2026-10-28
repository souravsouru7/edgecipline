const User = require("../models/Users");

async function findUsersForWeeklyReports() {
  return User.find({}, { _id: 1 }).lean();
}

// Session reminders need the market signal on the user record plus the
// streak timezone so the reminder day can be keyed in the user's zone.
async function findUsersForSessionReminders() {
  return User.find(
    { role: { $ne: "admin" } },
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

module.exports = {
  findUsersForWeeklyReports,
  findUsersForSessionReminders,
  findUsersWithActiveJournalStreak,
};
