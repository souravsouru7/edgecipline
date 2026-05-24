const Notification = require("../models/Notification");
const User = require("../models/Users");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const notificationService = require("../services/notificationService");

/**
 * @desc    Get all notifications (Admin)
 */
exports.getNotifications = asyncHandler(async (req, res) => {
  const notifications = await Notification.find()
    .populate("userId", "name email")
    .sort({ createdAt: -1 })
    .limit(50);
  res.json(notifications);
});

/**
 * @desc    Mark notification as read
 */
exports.markAsRead = asyncHandler(async (req, res) => {
  const notification = await Notification.findByIdAndUpdate(
    req.params.id,
    { isRead: true },
    { returnDocument: "after" }
  );
  res.json(notification);
});

/**
 * @desc    Mark all as read
 */
exports.markAllAsRead = asyncHandler(async (req, res) => {
  await Notification.updateMany({ isRead: false }, { isRead: true });
  res.json({ success: true });
});

/**
 * @desc    Send custom push/in-app notification from admin to selected users or all users
 */
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

  const users = sendToAll
    ? await User.find({ role: { $ne: "admin" } }).select("_id").lean()
    : await User.find({ _id: { $in: userIds }, role: { $ne: "admin" } }).select("_id").lean();

  if (!users.length) {
    throw new ApiError(404, "No matching users found", "NOT_FOUND");
  }

  const batchId = `admin-custom:${Date.now()}`;
  const results = await Promise.allSettled(
    users.map((user) =>
      notificationService.notifyUser(user._id, {
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
      })
    )
  );

  const created = results.filter((item) => item.status === "fulfilled" && item.value).length;
  const delivered = results.filter(
    (item) => item.status === "fulfilled" && item.value?.delivery?.successCount > 0
  ).length;
  const noDeviceToken = results.filter(
    (item) => item.status === "fulfilled" && item.value?.delivery?.noTokens
  ).length;
  const skippedOrDuplicate = results.filter((item) => item.status === "fulfilled" && !item.value).length;
  const failed = results.filter((item) => item.status === "rejected").length;

  res.status(201).json({
    success: true,
    batchId,
    targeted: users.length,
    created,
    delivered,
    noDeviceToken,
    skippedOrDuplicate,
    failed,
  });
});
