const DeviceToken = require("../models/DeviceToken");
const notificationService = require("../services/notificationService");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");
const { logger } = require("../utils/logger");

exports.registerDeviceToken = asyncHandler(async (req, res) => {
  const { token, platform = "android", deviceId = "", appVersion = "" } = req.body;
  if (!token || typeof token !== "string") {
    throw new ApiError(400, "Device token is required", "VALIDATION_ERROR");
  }

  const trimmed = token.trim();
  const now = new Date();
  const normalizedDeviceId = String(deviceId || "").trim().slice(0, 100);
  const previous = await DeviceToken.findOne({ token: trimmed }).select("user deviceId enabled").lean();

  // Upsert THIS token to {enabled: true, owned by req.user}. Also clears
  // failureCount and revokedAt so a previously-revoked token can be revived
  // (e.g. user re-enabled notifications in Android Settings).
  const deviceToken = await DeviceToken.findOneAndUpdate(
    { token: trimmed },
    {
      $set: {
        user: req.user._id,
        token: trimmed,
        platform,
        deviceId: normalizedDeviceId,
        appVersion,
        enabled: true,
        revokedAt: null,
        lastSeenAt: now,
        failureCount: 0,
      },
    },
    { upsert: true, returnDocument: "after", runValidators: true }
  ).lean();

  // Disable any OTHER enabled tokens for the same user+platform that were last
  // seen more than 60 seconds ago. This is the cleanup path for Firebase
  // token rotation: when FCM issues a new token for the same device, the old
  // one stays in the DB until 90-day TTL unless we mark it revoked here.
  //
  // The 60s buffer protects multi-device users — a token registered <60s ago
  // is treated as belonging to a different active device on the same account.
  const stale = normalizedDeviceId
    ? await DeviceToken.updateMany(
        {
          user: req.user._id,
          platform,
          deviceId: normalizedDeviceId,
          token: { $ne: trimmed },
          enabled: true,
        },
        { $set: { enabled: false, revokedAt: now } }
      )
    : { modifiedCount: 0 };

  if (stale.modifiedCount > 0) {
    logger.info("FCM_ROTATED", {
      userId: req.user._id?.toString?.(),
      platform,
      disabledCount: stale.modifiedCount,
    });
  }

  logger.info("FCM_REGISTERED", {
    userId: String(req.user._id),
    deviceTokenId: String(deviceToken._id),
    notificationType: null,
    platform,
    timezone: req.body.timezone || null,
    reassignedFromUser: previous?.user && String(previous.user) !== String(req.user._id),
  });

  res.status(201).json({ success: true, deviceTokenId: deviceToken._id });
});

exports.unregisterDeviceToken = asyncHandler(async (req, res) => {
  const { token } = req.body;
  if (!token || typeof token !== "string") {
    throw new ApiError(400, "Device token is required", "VALIDATION_ERROR");
  }

  const disabled = await DeviceToken.findOneAndUpdate(
    { token: token.trim(), user: req.user._id },
    { enabled: false, revokedAt: new Date() }
  );

  if (disabled) {
    logger.info("FCM_DISABLED", {
      userId: String(req.user._id),
      deviceTokenId: String(disabled._id),
      notificationType: null,
      platform: disabled.platform,
      timezone: req.body.timezone || null,
    });
  }

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
    "sessionReminders",
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
