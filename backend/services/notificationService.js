const mongoose = require("mongoose");
const DeviceToken = require("../models/DeviceToken");
const NotificationHistory = require("../models/NotificationHistory");
const NotificationPreference = require("../models/NotificationPreference");
const { getFirebaseAdmin } = require("../config/firebaseAdmin");
const { logger } = require("../utils/logger");

// ─── Channel map ──────────────────────────────────────────────────────────────
// Each type maps to one of 5 premium channels defined in the Android app.
// Channel IDs must match exactly what is created in pushNotifications.js.
const TYPE_CHANNEL = {
  revenge_trading:        "edgecipline_risk",
  overtrading:            "edgecipline_risk",
  no_stop_loss:           "edgecipline_risk",
  daily_loss_warning:     "edgecipline_risk",
  setup_discipline:       "edgecipline_discipline",
  mood_risk:              "edgecipline_discipline",
  repeated_mistake:       "edgecipline_insights",
  weekly_ai_insight:      "edgecipline_insights",
  weekly_report_reminder: "edgecipline_insights",
  confidence_reminder:    "edgecipline_coaching",
  session_reminder:       "edgecipline_session",
  morning_mentor:         "edgecipline_coaching",
};

// Per-channel accent colours (hex) shown in the notification LED + icon tint
const CHANNEL_COLOR = {
  edgecipline_risk:       "#E53935", // bold red  — danger / urgency
  edgecipline_discipline: "#F59E0B", // amber     — caution / awareness
  edgecipline_insights:   "#0D9E6E", // green     — growth / positive
  edgecipline_coaching:   "#3B82F6", // blue      — calm / wisdom
  edgecipline_session:    "#8B5CF6", // purple    — focus / preparation
};

// ─── Preference gate ──────────────────────────────────────────────────────────
const SMART_TYPE_TO_PREF = {
  revenge_trading:        "revengeTrading",
  overtrading:            "overtrading",
  setup_discipline:       "setupDiscipline",
  repeated_mistake:       "repeatedMistakes",
  mood_risk:              "moodRisk",
  no_stop_loss:           "noStopLoss",
  daily_loss_warning:     "noStopLoss",
  weekly_ai_insight:      "weeklyInsight",
  weekly_report_reminder: "weeklyInsight",
  confidence_reminder:    "smartCoach",
  session_reminder:       "smartCoach",
  morning_mentor:         "morningMentor",
};

const INVALID_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────
function stringifyData(data = {}) {
  return Object.entries(data || {}).reduce((acc, [key, value]) => {
    if (value === undefined || value === null) return acc;
    acc[key] = typeof value === "string" ? value : JSON.stringify(value);
    return acc;
  }, {});
}

async function getOrCreatePreferences(userId) {
  return NotificationPreference.findOneAndUpdate(
    { user: userId },
    { $setOnInsert: { user: userId } },
    { upsert: true, returnDocument: "after" }
  ).lean();
}

function isSmartCoachType(type) {
  return Boolean(SMART_TYPE_TO_PREF[type]);
}

async function getAllowedPreferences(userId, type) {
  const prefs = await getOrCreatePreferences(userId);
  if (!prefs.inAppEnabled && !prefs.pushEnabled) return null;
  if (isSmartCoachType(type) && !prefs.smartCoach) return null;

  const flag = SMART_TYPE_TO_PREF[type];
  if (flag && prefs[flag] === false) return null;

  return prefs;
}

async function disableInvalidTokens(invalidTokens = []) {
  if (!invalidTokens.length) return;
  await DeviceToken.updateMany(
    { token: { $in: invalidTokens } },
    { enabled: false, revokedAt: new Date(), $inc: { failureCount: 1 } }
  );
}

// ─── Rich FCM payload builder ─────────────────────────────────────────────────
function buildAndroidConfig(notification) {
  const channelId = TYPE_CHANNEL[notification.type] || "edgecipline_insights";
  const color     = CHANNEL_COLOR[channelId] || "#0D9E6E";
  const isUrgent  = channelId === "edgecipline_risk";

  return {
    priority: isUrgent ? "high" : "normal",
    ttl: isUrgent ? 3600 * 1000 : 86400 * 1000, // 1h for urgent, 24h otherwise
    notification: {
      channelId,
      icon:        "ic_stat_edgecipline",   // white monochrome icon in res/drawable
      color,
      sound:       "default",
      clickAction: "OPEN_APP",
      // BigText style — expands in the tray to show the full body
      body:        notification.body,
      // Tag deduplication: same tag replaces the previous notification of that type
      tag:         `edgecipline_${notification.type}`,
      // Visibility: show on lock screen for urgent alerts, private otherwise
      visibility:  isUrgent ? "public" : "private",
    },
  };
}

// ─── Core push sender ─────────────────────────────────────────────────────────
async function sendPushToUser(userId, notification) {
  const tokens = await DeviceToken.find({ user: userId, enabled: true, revokedAt: null })
    .select("token")
    .lean();

  if (!tokens.length) {
    return { successCount: 0, failureCount: 0, invalidTokens: [], noTokens: true };
  }

  const admin = getFirebaseAdmin();

  const message = {
    tokens: tokens.map((t) => t.token),
    notification: {
      title: notification.title,
      body:  notification.body,
    },
    data: stringifyData({
      type:           notification.type,
      deepLink:       notification.deepLink || "",
      notificationId: notification._id?.toString?.() || "",
      ...(notification.data || {}),
    }),
    android: buildAndroidConfig(notification),
  };

  const response = await admin.messaging().sendEachForMulticast(message);

  const invalidTokens = [];
  response.responses.forEach((result, index) => {
    if (result.error && INVALID_TOKEN_CODES.has(result.error.code)) {
      invalidTokens.push(tokens[index].token);
    }
  });

  await disableInvalidTokens(invalidTokens);

  return {
    successCount: response.successCount,
    failureCount: response.failureCount,
    invalidTokens,
  };
}

// ─── Public notifyUser ────────────────────────────────────────────────────────
async function notifyUser(userId, payload) {
  const prefs = await getAllowedPreferences(userId, payload.type);
  if (!prefs) return null;

  const dedupeKey = payload.dedupeKey || `${payload.type}:${userId}:${payload.sourceId || Date.now()}`;
  let notification;

  try {
    notification = await NotificationHistory.create({
      user:       userId,
      type:       payload.type,
      title:      payload.title,
      body:       payload.body,
      data:       payload.data || {},
      deepLink:   payload.deepLink || payload.data?.deepLink || "",
      sourceType: payload.sourceType || "system",
      sourceId:   mongoose.Types.ObjectId.isValid(payload.sourceId) ? payload.sourceId : null,
      dedupeKey,
    });
  } catch (error) {
    if (error?.code === 11000) return null; // duplicate — already sent
    throw error;
  }

  if (!prefs.pushEnabled) {
    await NotificationHistory.findByIdAndUpdate(notification._id, { status: "skipped" });
    return notification;
  }

  try {
    const delivery = await sendPushToUser(userId, { ...payload, ...notification.toObject() });

    const status = delivery.noTokens          ? "skipped"
      : delivery.successCount > 0 && delivery.failureCount > 0 ? "partial"
      : delivery.failureCount > 0             ? "failed"
      : "sent";

    return await NotificationHistory.findByIdAndUpdate(
      notification._id,
      { status, sentAt: delivery.successCount > 0 ? new Date() : null, delivery },
      { returnDocument: "after" }
    ) || notification;

  } catch (error) {
    logger.warn("Push delivery failed", {
      userId: userId?.toString?.(),
      type:   payload.type,
      error:  error.message,
      code:   error.code,
    });

    await NotificationHistory.findByIdAndUpdate(notification._id, {
      status:   "failed",
      delivery: { successCount: 0, failureCount: 1, invalidTokens: [], error: error.message },
    });

    return notification;
  }
}

// ─── Query helpers ────────────────────────────────────────────────────────────
async function listUserNotifications(userId, { limit = 50, unreadOnly = false } = {}) {
  const query = { user: userId };
  if (unreadOnly) query.isRead = false;
  return NotificationHistory.find(query)
    .sort({ createdAt: -1 })
    .limit(Math.min(100, Math.max(1, Number(limit) || 50)))
    .lean();
}

async function markAsRead(userId, notificationId) {
  return NotificationHistory.findOneAndUpdate(
    { _id: notificationId, user: userId },
    { isRead: true, readAt: new Date() },
    { returnDocument: "after" }
  ).lean();
}

async function markAllAsRead(userId) {
  await NotificationHistory.updateMany(
    { user: userId, isRead: false },
    { isRead: true, readAt: new Date() }
  );
  return { success: true };
}

module.exports = {
  getOrCreatePreferences,
  listUserNotifications,
  markAllAsRead,
  markAsRead,
  notifyUser,
};
