const Notification = require("../models/Notification");
const User = require("../models/Users");
const mongoose = require("mongoose");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const { enqueueNotificationDelivery } = require("../queues/smartNotificationQueue");
const { logger } = require("../utils/logger");

function getTargetUserId(req) {
  const userId = req.query?.userId || req.body?.userId || null;
  if (userId && !mongoose.Types.ObjectId.isValid(String(userId))) {
    throw new ApiError(400, "Invalid target user ID", "VALIDATION_ERROR");
  }
  return userId;
}

/**
 * @desc    Get all notifications (Admin)
 */
exports.getNotifications = asyncHandler(async (req, res) => {
  const targetUserId = getTargetUserId(req);
  const notifications = await Notification.find(targetUserId ? { userId: targetUserId } : {})
    .populate("userId", "name email")
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  res.json(notifications);
});

/**
 * @desc    Mark notification as read
 */
exports.markAsRead = asyncHandler(async (req, res) => {
  const targetUserId = getTargetUserId(req);
  const notification = await Notification.findOneAndUpdate(
    {
      _id: req.params.id,
      ...(targetUserId ? { userId: targetUserId } : {}),
    },
    { isRead: true },
    { returnDocument: "after" }
  );
  res.json(notification);
});

/**
 * @desc    Mark all as read
 */
exports.markAllAsRead = asyncHandler(async (req, res) => {
  const targetUserId = getTargetUserId(req);
  await Notification.updateMany(
    {
      ...(targetUserId ? { userId: targetUserId } : {}),
      isRead: false,
    },
    { isRead: true }
  );
  res.json({ success: true });
});

/**
 * @desc    Send custom push/in-app notification from admin to selected users or all users
 */
// Hard cap on the userIds array. A blast can still hit every user via
// sendToAll (which is itself capped by paginating User.find in future), but
// raw $in arrays of arbitrary length pin Mongo memory.
const CUSTOM_NOTIFICATION_USER_CAP = 1000;

exports.sendCustomNotification = asyncHandler(async (req, res) => {
  const {
    title,
    body,
    message,
    userIds = [],
    sendToAll = false,
    deepLink = "/notifications",
  } = req.body;

  const notificationBody = body || message;
  if (!title || !notificationBody) {
    throw new ApiError(400, "title and body are required", "VALIDATION_ERROR");
  }

  if (!sendToAll && (!Array.isArray(userIds) || userIds.length === 0)) {
    throw new ApiError(400, "Select at least one user or enable sendToAll", "VALIDATION_ERROR");
  }
  if (!sendToAll && userIds.length > CUSTOM_NOTIFICATION_USER_CAP) {
    throw new ApiError(
      400,
      `userIds cannot exceed ${CUSTOM_NOTIFICATION_USER_CAP} per request`,
      "VALIDATION_ERROR"
    );
  }

  const users = sendToAll
    ? await User.find({ role: { $ne: "admin" } }).select("_id").lean()
    : await User.find({ _id: { $in: userIds }, role: { $ne: "admin" } }).select("_id").lean();

  if (!users.length) {
    throw new ApiError(404, "No matching users found", "NOT_FOUND");
  }

  const batchId = `admin-custom:${Date.now()}`;
  // Audit log — name the admin, the scope, and the batch so the action is
  // traceable. Title/body intentionally NOT logged (may contain PII).
  logger.warn("[Admin] custom notification blast", {
    adminId: String(req.user?._id || req.user?.id || "unknown"),
    sendToAll: Boolean(sendToAll),
    requestedUserCount: Array.isArray(userIds) ? userIds.length : 0,
    targetedUserCount: users.length,
    batchId,
  });
  const results = await Promise.allSettled(
    users.map((user) =>
      enqueueNotificationDelivery({ userId: user._id, notification: {
        type: "system",
        title: String(title).trim().slice(0, 120),
        body: String(notificationBody).trim().slice(0, 500),
        sourceType: "system",
        dedupeKey: `${batchId}:${user._id}`,
        deepLink,
        data: {
          screen: "notifications",
          batchId,
          sentBy: "admin",
        },
      } })
    )
  );

  const queued = results.filter((item) => item.status === "fulfilled").length;
  const failed = results.filter((item) => item.status === "rejected").length;

  res.status(201).json({
    success: true,
    batchId,
    targeted: users.length,
    queued,
    failed,
  });
});
