const WeeklyReport = require("../models/WeeklyReport");

async function findWeeklyReportsByUser(userId, marketType, limit) {
  return WeeklyReport.find({ user: userId, marketType })
    .sort({ weekStart: -1 })
    .limit(limit)
    .select("user marketType periodType weekStart weekEnd snapshot aiFeedback aiModel promptVersion createdAt updatedAt")
    .lean();
}

async function findWeeklyReportByIdAndUser(reportId, userId) {
  return WeeklyReport.findOne({ _id: reportId, user: userId }).lean();
}

async function findExistingRollingReport(userId, marketType, weekStart, weekEnd) {
  return WeeklyReport.findOne({
    user: userId,
    marketType,
    periodType: "rolling7d",
    weekStart,
    weekEnd,
  })
    .select("snapshot aiFeedback")
    .lean();
}

async function upsertRollingWeeklyReport(userId, marketType, weekStart, weekEnd, snapshot) {
  return WeeklyReport.findOneAndUpdate(
    { user: userId, marketType, periodType: "rolling7d", weekStart, weekEnd },
    {
      $setOnInsert: { user: userId, marketType, periodType: "rolling7d", weekStart, weekEnd },
      $set: { snapshot },
    },
    { returnDocument: "after", upsert: true }
  );
}

async function updateWeeklyReportById(reportId, update) {
  return WeeklyReport.findByIdAndUpdate(reportId, update, { returnDocument: "after" });
}

async function findRecentlyGeneratedWeeklyReport(userId, marketType, since) {
  return WeeklyReport.findOne({
    user: userId,
    marketType,
    periodType: "rolling7d",
    aiFeedback: { $ne: null },
    createdAt: { $gte: since },
  })
    .sort({ createdAt: -1 })
    .select("_id user marketType periodType aiFeedback snapshot.source createdAt");
}

module.exports = {
  findExistingRollingReport,
  findRecentlyGeneratedWeeklyReport,
  findWeeklyReportByIdAndUser,
  findWeeklyReportsByUser,
  updateWeeklyReportById,
  upsertRollingWeeklyReport,
};
