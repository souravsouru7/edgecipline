const DeviceToken = require("../models/DeviceToken");
const notificationService = require("../services/notificationService");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");

exports.registerDeviceToken = asyncHandler(async (req, res) => {
  const { token, platform = "android", deviceId = "", appVersion = "" } = req.body;
  if (!token || typeof token !== "string") {
    throw new ApiError(400, "Device token is required", "VALIDATION_ERROR");
  }

  const deviceToken = await DeviceToken.findOneAndUpdate(
    { token: token.trim() },
    {
      user: req.user._id,
      token: token.trim(),
      platform,
      deviceId,
      appVersion,
      enabled: true,
      revokedAt: null,
      lastSeenAt: new Date(),
    },
    { upsert: true, returnDocument: "after", runValidators: true }
  ).lean();

  res.status(201).json({ success: true, deviceTokenId: deviceToken._id });
});

exports.unregisterDeviceToken = asyncHandler(async (req, res) => {
  const { token } = req.body;
  if (!token || typeof token !== "string") {
    throw new ApiError(400, "Device token is required", "VALIDATION_ERROR");
  }

  await DeviceToken.findOneAndUpdate(
    { token: token.trim(), user: req.user._id },
    { enabled: false, revokedAt: new Date() }
  );

  res.json({ success: true });
});

exports.getNotificationPreferences = asyncHandler(async (req, res) => {
  const preferences = await notificationService.getOrCreatePreferences(req.user._id);
  res.json(preferences);
});

exports.updateNotificationPreferences = asyncHandler(async (req, res) => {
  const allowedKeys = [
    "pushEnabled",
    "inAppEnabled",
    "smartCoach",
    "revengeTrading",
    "overtrading",
    "setupDiscipline",
    "repeatedMistakes",
    "moodRisk",
    "noStopLoss",
    "weeklyInsight",
    "morningMentor",
    "quietHours",
  ];

  const update = {};
  allowedKeys.forEach((key) => {
    if (req.body[key] !== undefined) update[key] = req.body[key];
  });

  const preferences = await require("../models/NotificationPreference").findOneAndUpdate(
    { user: req.user._id },
    { $set: update, $setOnInsert: { user: req.user._id } },
    { upsert: true, returnDocument: "after", runValidators: true }
  ).lean();

  res.json(preferences);
});
