const NotificationHistory = require("../../models/NotificationHistory");
const { getSmartNotificationQueueMetrics, smartNotificationQueue } = require("../../queues/smartNotificationQueue");

const ALL_TYPES = [
  "revenge_trading",
  "overtrading",
  "setup_discipline",
  "repeated_mistake",
  "mood_risk",
  "no_stop_loss",
  "daily_loss_warning",
  "confidence_reminder",
  "session_reminder",
  "morning_mentor",
  "weekly_ai_insight",
  "weekly_report_reminder",
  "ocr_completed",
  "ocr_failed",
  "issue_fixed",
  "admin_issue_report",
  "payment",
  "feedback",
  "system",
];

// Returns the start of the UTC day N days ago
function daysAgo(n) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

// Safely compute integer rate clamped to [0, 100]
function rate(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 100 * 10) / 10; // one decimal
}

/**
 * GET /api/admin/notifications/analytics
 *
 * Query params:
 *   days   — lookback window in days (default 7, max 90)
 *   type   — filter to a single notification type (optional)
 *
 * Response schema:
 * {
 *   window: { from, to, days },
 *   funnel: { sent, delivered, opened, actionClicked },
 *   rates:  { deliveryRate, openRate, ctr, failureRate, tokenFailureRate },
 *   last24h: { sent, opened },
 *   byType: [ { type, sent, opened, actionClicked, openRate, ctr } ],
 *   failures: { invalidToken, pushDisabled, noDeviceToken, fcmError, preferenceBlocked },
 *   trend: [ { date, sent, opened } ]   (daily, oldest-first)
 * }
 */
exports.getNotificationAnalytics = async (req, res) => {
  try {
    const rawDays = parseInt(req.query.days, 10);
    const days = Number.isFinite(rawDays) ? Math.min(90, Math.max(1, rawDays)) : 7;
    const typeFilter = ALL_TYPES.includes(req.query.type) ? req.query.type : null;

    const windowStart = daysAgo(days);
    const now = new Date();
    const last24hStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const baseMatch = { createdAt: { $gte: windowStart } };
    if (typeFilter) baseMatch.type = typeFilter;

    // ─── 1. Overall funnel counts ─────────────────────────────────────────────
    const [funnelResult] = await NotificationHistory.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: null,
          total:           { $sum: 1 },
          sent:            { $sum: { $cond: [{ $in: ["$status", ["sent", "partial"]] }, 1, 0] } },
          delivered:       { $sum: { $cond: [{ $ne: ["$deliveredAt", null] }, 1, 0] } },
          failed:          { $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] } },
          skipped:         { $sum: { $cond: [{ $eq: ["$status", "skipped"] }, 1, 0] } },
          opened:          { $sum: { $cond: [{ $ne: ["$openedAt", null] }, 1, 0] } },
          actionClicked:   { $sum: { $cond: [{ $ne: ["$actionClickedAt", null] }, 1, 0] } },
          totalSuccess:    { $sum: "$delivery.successCount" },
          totalFailure:    { $sum: "$delivery.failureCount" },
          totalInvalid:    { $sum: { $size: { $ifNull: ["$delivery.invalidTokens", []] } } },
        },
      },
    ]);

    const funnel = funnelResult || {
      total: 0, sent: 0, delivered: 0, failed: 0, skipped: 0,
      opened: 0, actionClicked: 0,
      totalSuccess: 0, totalFailure: 0, totalInvalid: 0,
    };

    // FCM tokens attempted = successCount + failureCount across all records in window
    const totalTokenAttempts = funnel.totalSuccess + funnel.totalFailure;

    const rates = {
      deliveryRate:     rate(funnel.delivered, funnel.sent),
      fcmAcceptanceRate: rate(funnel.totalSuccess, totalTokenAttempts),
      openRate:         rate(funnel.opened, funnel.sent),
      ctr:              rate(funnel.actionClicked, funnel.opened),
      failureRate:      rate(funnel.failed, funnel.total),
      tokenFailureRate: rate(funnel.totalInvalid, totalTokenAttempts),
    };

    // ─── 2. Last 24h ──────────────────────────────────────────────────────────
    const last24hMatch = { createdAt: { $gte: last24hStart } };
    if (typeFilter) last24hMatch.type = typeFilter;

    const [last24hResult] = await NotificationHistory.aggregate([
      { $match: last24hMatch },
      {
        $group: {
          _id: null,
          sent:   { $sum: { $cond: [{ $in: ["$status", ["sent", "partial"]] }, 1, 0] } },
          opened: { $sum: { $cond: [{ $ne: ["$openedAt", null] }, 1, 0] } },
        },
      },
    ]);

    const last24h = last24hResult || { sent: 0, opened: 0 };

    // ─── 3. Per-type breakdown ────────────────────────────────────────────────
    const byTypeRaw = await NotificationHistory.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id:           "$type",
          sent:          { $sum: { $cond: [{ $in: ["$status", ["sent", "partial"]] }, 1, 0] } },
          opened:        { $sum: { $cond: [{ $ne: ["$openedAt", null] }, 1, 0] } },
          actionClicked: { $sum: { $cond: [{ $ne: ["$actionClickedAt", null] }, 1, 0] } },
          failed:        { $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] } },
        },
      },
      { $sort: { sent: -1 } },
    ]);

    const byType = byTypeRaw.map((t) => ({
      type:          t._id,
      sent:          t.sent,
      opened:        t.opened,
      actionClicked: t.actionClicked,
      failed:        t.failed,
      openRate:      rate(t.opened, t.sent),
      ctr:           rate(t.actionClicked, t.opened),
    }));

    // ─── 4. Failure breakdown ─────────────────────────────────────────────────
    // "invalidToken" — delivery.invalidTokens non-empty
    // "fcmError"     — status failed with a delivery error
    // "noDeviceToken" — skipped with no delivery attempt (noTokens effectively)
    // "pushDisabled"  — skipped (push pref off) → delivery.successCount=0, failureCount=0
    // "preferenceBlocked" — skipped by pref gate (no push, no delivery object)
    const [failureResult] = await NotificationHistory.aggregate([
      { $match: { ...baseMatch } },
      {
        $group: {
          _id: null,
          invalidToken: {
            $sum: {
              $cond: [
                { $gt: [{ $size: { $ifNull: ["$delivery.invalidTokens", []] } }, 0] },
                1,
                0,
              ],
            },
          },
          fcmError: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$status", "failed"] },
                    { $gt: [{ $strLenCP: { $ifNull: ["$delivery.error", ""] } }, 0] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          noDeviceToken: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$status", "skipped"] },
                    { $eq: [{ $ifNull: ["$delivery.error", ""] }, ""] },
                    { $eq: [{ $ifNull: ["$delivery.successCount", 0] }, 0] },
                    { $eq: [{ $ifNull: ["$delivery.failureCount", 0] }, 0] },
                    { $eq: [{ $size: { $ifNull: ["$delivery.invalidTokens", []] } }, 0] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          pushDisabled: {
            $sum: { $cond: [{ $eq: ["$delivery.error", "push_disabled"] }, 1, 0] },
          },
          quietHours: {
            $sum: { $cond: [{ $eq: ["$delivery.error", "quiet_hours"] }, 1, 0] },
          },
        },
      },
    ]);

    const failures = failureResult
      ? {
          invalidToken:   failureResult.invalidToken,
          fcmError:       failureResult.fcmError,
          noDeviceToken:  failureResult.noDeviceToken,
          pushDisabled:   failureResult.pushDisabled,
          quietHours:     failureResult.quietHours,
        }
      : { invalidToken: 0, fcmError: 0, noDeviceToken: 0, pushDisabled: 0, quietHours: 0 };

    // ─── 5. Daily trend ───────────────────────────────────────────────────────
    const trendRaw = await NotificationHistory.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: {
            year:  { $year: "$createdAt" },
            month: { $month: "$createdAt" },
            day:   { $dayOfMonth: "$createdAt" },
          },
          sent:   { $sum: { $cond: [{ $in: ["$status", ["sent", "partial"]] }, 1, 0] } },
          opened: { $sum: { $cond: [{ $ne: ["$openedAt", null] }, 1, 0] } },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 } },
    ]);

    const trend = trendRaw.map((d) => ({
      date:   `${d._id.year}-${String(d._id.month).padStart(2, "0")}-${String(d._id.day).padStart(2, "0")}`,
      sent:   d.sent,
      opened: d.opened,
    }));

    // ─── 6. Top / bottom performers ──────────────────────────────────────────
    const sorted = [...byType].filter((t) => t.sent >= 5); // only types with meaningful volume
    const topPerforming    = [...sorted].sort((a, b) => b.openRate - a.openRate).slice(0, 3);
    const bottomPerforming = [...sorted].sort((a, b) => a.openRate - b.openRate).slice(0, 3);

    res.json({
      window: { from: windowStart.toISOString(), to: now.toISOString(), days },
      funnel: {
        total:         funnel.total,
        sent:          funnel.sent,
        delivered:     funnel.delivered,
        failed:        funnel.failed,
        skipped:       funnel.skipped,
        opened:        funnel.opened,
        actionClicked: funnel.actionClicked,
      },
      rates,
      last24h,
      byType,
      topPerforming,
      bottomPerforming,
      failures,
      trend,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * GET /api/admin/notifications/queue-metrics
 *
 * Exposes BullMQ depth + a sample of dead-lettered jobs so operators can
 * diagnose whether the smart-notification queue is healthy. Failed jobs are
 * retained for 24h (removeOnFail.age in queue config).
 */
exports.getQueueMetrics = async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.deadLetterLimit, 10) || 10));
    const metrics = await getSmartNotificationQueueMetrics();

    // Sample of recent failed jobs — these are the dead-lettered ones
    // (exhausted all retry attempts). Useful for production diagnosis.
    const failedJobs = await smartNotificationQueue.getFailed(0, limit - 1);
    const deadLetterSample = failedJobs.map((job) => ({
      jobId:           job.id,
      attemptsMade:    job.attemptsMade,
      failedReason:    job.failedReason,
      data:            job.data,
      finishedOn:      job.finishedOn,
      processedOn:     job.processedOn,
    }));

    res.json({
      ...metrics,
      deadLetterSample,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
