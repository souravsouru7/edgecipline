const notificationService = require("../services/notificationService");
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
