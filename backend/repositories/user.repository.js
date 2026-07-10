const User = require("../models/Users");

async function markFreeUploadUsed(userId) {
  return User.findByIdAndUpdate(userId, { freeUploadUsed: true });
}

/**
 * Atomically claim the user's single free upload. Returns true if this call
 * won the slot, false if it was already claimed by a concurrent request. Use
 * BEFORE enqueueing work so two parallel uploads cannot both pass the quota
 * check.
 */
async function claimFreeUpload(userId) {
  const result = await User.updateOne(
    { _id: userId, freeUploadUsed: { $ne: true } },
    { $set: { freeUploadUsed: true } }
  );
  return result.modifiedCount === 1;
}

async function releaseFreeUpload(userId) {
  return User.updateOne({ _id: userId }, { $set: { freeUploadUsed: false } });
}

async function findUsersForWeeklyReports() {
  return User.find({}, { _id: 1 }).lean();
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
  findUsersWithActiveJournalStreak,
  markFreeUploadUsed,
  claimFreeUpload,
  releaseFreeUpload,
};
