const notificationService = require("../services/notificationService");
const NotificationDebugLog = require("../models/NotificationDebugLog");
const NotificationHistory = require("../models/NotificationHistory");
const asyncHandler = require("../utils/asyncHandler");

exports.listNotifications = asyncHandler(async (req, res) => {
  // M18: Clamp limit to a safe range
  const rawLimit = parseInt(req.query.limit, 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, rawLimit)) : 20;
  const notifications = await notificationService.listUserNotifications(req.user._id, {
    limit,
    unreadOnly: req.query.unreadOnly === "true",
  });
  res.json(notifications);
});

exports.markAsRead = asyncHandler(async (req, res) => {
  const notification = await notificationService.markAsRead(req.user._id, req.params.id);
  res.json(notification);
});

exports.markAllAsRead = asyncHandler(async (req, res) => {
  const result = await notificationService.markAllAsRead(req.user._id);
  res.json(result);
});

exports.trackOpen = asyncHandler(async (req, res) => {
  const notification = await notificationService.trackOpen(req.user._id, req.params.id);
  res.json({ success: true, notification });
});

exports.trackAction = asyncHandler(async (req, res) => {
  const { actionType } = req.body;
  const notification = await notificationService.trackAction(req.user._id, req.params.id, actionType);
  res.json({ success: true, notification });
});

// GET /api/notifications/debug/setup-discipline/latest
// Returns the most recent setup discipline evaluation for the authenticated user.
exports.getSetupDisciplineDebug = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const debugLog = await NotificationDebugLog.findOne(
    { user: userId, type: "setup_discipline" }
  ).lean();

  // Pull the matching notification record if one was created
  let notificationRecord = null;
  if (debugLog?.notificationId) {
    notificationRecord = await NotificationHistory.findOne(
      { _id: debugLog.notificationId, user: userId }
    ).select("status sentAt delivery openedAt").lean();
  }

  if (!debugLog) {
    return res.json({
      evaluated: false,
      message: "No setup discipline evaluation has run yet for this account.",
    });
  }

  res.json({
    evaluated:           true,
    tradeId:             debugLog.tradeId,
    marketType:          debugLog.marketType,
    tradeDate:           debugLog.tradeDate,
    setupScore:          debugLog.setupScore,
    profit:              debugLog.profit,
    lowScoreToday:       debugLog.lowScoreToday,
    gate1Passed:         debugLog.gate1Passed,
    gate3Passed:         debugLog.gate3Passed,
    dedupeKey:           debugLog.dedupeKey,
    dedupeBlocked:       debugLog.dedupeBlocked,
    notificationCreated: debugLog.notificationCreated,
    notificationId:      debugLog.notificationId,
    pushSent:            debugLog.pushSent,
    pushSuccessCount:    debugLog.pushSuccessCount,
    pushFailureCount:    debugLog.pushFailureCount,
    androidDelivered:    (notificationRecord?.openedAt != null) || (debugLog.pushSuccessCount > 0),
    notificationStatus:  notificationRecord?.status ?? null,
    sentAt:              notificationRecord?.sentAt ?? null,
    openedAt:            notificationRecord?.openedAt ?? null,
    evaluatedAt:         debugLog.evaluatedAt,
  });
});
