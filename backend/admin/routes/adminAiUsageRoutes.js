const express = require("express");
const router = express.Router();
const { adminAuth } = require("../../middleware/adminAuth");
const asyncHandler = require("../../utils/asyncHandler");
const AiUsage = require("../../models/AiUsage");
const { getTodayTokens } = require("../../utils/aiUsage");
const { appConfig } = require("../../config");
const { getCostAnalytics } = require("../../services/aiCostAnalyticsService");

// GET /api/admin/ai-usage?days=7
// Gemini token spend per day + feature, failure counts, and the heaviest users.
router.get(
  "/",
  adminAuth,
  asyncHandler(async (req, res) => {
    const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 7));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [byDayFeature, topUsers, todayTokens] = await Promise.all([
      AiUsage.aggregate([
        { $match: { createdAt: { $gte: since } } },
        {
          $group: {
            _id: {
              day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
              feature: "$feature",
            },
            calls: { $sum: 1 },
            failures: { $sum: { $cond: ["$ok", 0, 1] } },
            inputTokens: { $sum: "$inputTokens" },
            outputTokens: { $sum: "$outputTokens" },
            thinkingTokens: { $sum: "$thinkingTokens" },
            totalTokens: { $sum: "$totalTokens" },
          },
        },
        { $sort: { "_id.day": -1, totalTokens: -1 } },
      ]),
      AiUsage.aggregate([
        { $match: { createdAt: { $gte: since }, user: { $ne: null } } },
        {
          $group: {
            _id: "$user",
            calls: { $sum: 1 },
            totalTokens: { $sum: "$totalTokens" },
          },
        },
        { $sort: { totalTokens: -1 } },
        { $limit: 20 },
        { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "u" } },
        {
          $project: {
            _id: 0,
            userId: "$_id",
            email: { $arrayElemAt: ["$u.email", 0] },
            calls: 1,
            totalTokens: 1,
          },
        },
      ]),
      getTodayTokens(),
    ]);

    res.json({
      days,
      today: {
        totalTokens: todayTokens,
        budget: Number(appConfig.ai.dailyTokenBudget) || null,
      },
      byDayFeature: byDayFeature.map((row) => ({ day: row._id.day, feature: row._id.feature, ...row, _id: undefined })),
      topUsers,
    });
  })
);

// GET /api/admin/ai-usage/costs?from=YYYY-MM-DD&to=YYYY-MM-DD&feature=coach
// Spend (USD/INR) by feature, model, day and month, plus per-user, per-payer,
// per-upload and per-Coach-reply averages. Calculated from metered tokens x
// the price table; see services/aiCostAnalyticsService for what that means.
router.get(
  "/costs",
  adminAuth,
  asyncHandler(async (req, res) => {
    const feature = typeof req.query.feature === "string" && AiUsage.FEATURES.includes(req.query.feature)
      ? req.query.feature
      : null;
    const data = await getCostAnalytics({
      from: typeof req.query.from === "string" ? req.query.from : undefined,
      to: typeof req.query.to === "string" ? req.query.to : undefined,
      feature,
    });
    res.json({ ...data, features: AiUsage.FEATURES });
  })
);

module.exports = router;
