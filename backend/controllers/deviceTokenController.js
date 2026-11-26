const DeviceToken = require("../models/DeviceToken");
const notificationService = require("../services/notificationService");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");
const { logger } = require("../utils/logger");
const NotificationPreference = require("../models/NotificationPreference");
const User = require("../models/Users");

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

// A real IANA zone ("Europe/London"), or null. Rejects garbage and offsets.
function validTimezone(value) {
  if (typeof value !== "string") return null;
  const tz = value.trim();
  if (!tz || tz.length > 64 || !tz.includes("/")) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return null;
  }
}

// The device's timezone is the ONLY source of a user's local time for
// reminders, the daily cap, quiet hours and streak day keys. It was sent and
// only logged; every user stayed on Asia/Kolkata. Written to both places the
// code reads from so they can never disagree.
async function saveUserTimezone(userId, timezone) {
  const tz = validTimezone(timezone);
  if (!tz) return null;
  await Promise.all([
    User.updateOne({ _id: userId }, { $set: { "streaks.timezone": tz } }),
    NotificationPreference.updateOne(
      { user: userId },
      { $set: { "quietHours.timezone": tz }, $setOnInsert: { user: userId } },
      { upsert: true }
    ),
  ]);
  return tz;
}

exports.validTimezone = validTimezone;
exports.saveUserTimezone = saveUserTimezone;

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

  let savedTimezone = null;
  try {
    savedTimezone = await saveUserTimezone(req.user._id, req.body.timezone);
  } catch (error) {
    // Never fail token registration over the timezone write.
    logger.warn("FCM_TIMEZONE_SAVE_FAILED", { userId: String(req.user._id), error: error.message });
  }

  logger.info("FCM_REGISTERED", {
    userId: String(req.user._id),
    deviceTokenId: String(deviceToken._id),
    notificationType: null,
    platform,
    timezone: savedTimezone,
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
  // Every flag the delivery gate reads. streakProtection, eveningReflection
  // and supportUpdates were read but missing here, so turning them off was
  // silently dropped.
  const booleanKeys = [
    "pushEnabled",
    "inAppEnabled",
    "smartCoach",
    "revengeTrading",
    "overtrading",
    "setupDiscipline",
    "repeatedMistakes",
    "moodRisk",
    "noStopLoss",
    "dailyLossWarning",
    "weeklyInsight",
    "sessionReminders",
    "morningMentor",
    "streakProtection",
    "eveningReflection",
    "mindProgress",
    "supportUpdates",
    "promotions",
  ];

  const update = {};
  for (const key of booleanKeys) {
    if (req.body[key] === undefined) continue;
    if (typeof req.body[key] !== "boolean") {
      throw new ApiError(400, `${key} must be true or false`, "VALIDATION_ERROR");
    }
    update[key] = req.body[key];
  }

  // Quiet hours are merged field by field. `$set: { quietHours: body }`
  // replaced the whole object, so PATCH {quietHours:{enabled:true}} wiped
  // start/end — and the gate treats a window with no start/end as "block
  // everything", silencing every push from then on.
  const qh = req.body.quietHours;
  if (qh !== undefined) {
    if (!qh || typeof qh !== "object" || Array.isArray(qh)) {
      throw new ApiError(400, "quietHours must be an object", "VALIDATION_ERROR");
    }
    if (qh.enabled !== undefined) {
      if (typeof qh.enabled !== "boolean") throw new ApiError(400, "quietHours.enabled must be true or false", "VALIDATION_ERROR");
      update["quietHours.enabled"] = qh.enabled;
    }
    for (const field of ["start", "end"]) {
      if (qh[field] === undefined) continue;
      if (typeof qh[field] !== "string" || !TIME_PATTERN.test(qh[field])) {
        throw new ApiError(400, `quietHours.${field} must be HH:MM`, "VALIDATION_ERROR");
      }
      update[`quietHours.${field}`] = qh[field];
    }
    if (qh.timezone !== undefined) {
      const tz = validTimezone(qh.timezone);
      if (!tz) throw new ApiError(400, "quietHours.timezone must be an IANA timezone", "VALIDATION_ERROR");
      update["quietHours.timezone"] = tz;
    }
  }

  if (update["quietHours.timezone"]) {
    // Keep the reminder/streak timezone in step with the one the user chose.
    await User.updateOne({ _id: req.user._id }, { $set: { "streaks.timezone": update["quietHours.timezone"] } });
  }

  const preferences = await NotificationPreference.findOneAndUpdate(
    { user: req.user._id },
    { $set: update, $setOnInsert: { user: req.user._id } },
    { upsert: true, returnDocument: "after", runValidators: true }
  ).lean();

  res.json(preferences);
});
