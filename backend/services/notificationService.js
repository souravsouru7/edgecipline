const mongoose = require("mongoose");
const DeviceToken = require("../models/DeviceToken");
const NotificationHistory = require("../models/NotificationHistory");
const NotificationPreference = require("../models/NotificationPreference");
const { getFirebaseAdmin } = require("../config/firebaseAdmin");
const { logger } = require("../utils/logger");
const { buildPagination } = require("../utils/apiResponse");

function requireUserId(userId) {
  if (!userId) {
    throw new TypeError("A user ID is required for notification access");
  }
  return userId;
}

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
  ocr_completed:          "edgecipline_ocr",
  ocr_failed:             "edgecipline_ocr",
  streak_milestone:       "edgecipline_coaching",
  streak_at_risk:         "edgecipline_coaching",
  streak_broken:          "edgecipline_coaching",
  evening_reflection:     "edgecipline_coaching",
  mission_update:         "edgecipline_coaching",
  // Support replies get their own channel so a customer can silence coaching
  // nudges without also silencing the answer to their billing question.
  support_ticket_created:   "edgecipline_support",
  support_agent_reply:      "edgecipline_support",
  support_status_changed:   "edgecipline_support",
  support_resolved:         "edgecipline_support",
  support_reopened:         "edgecipline_support",
  support_assigned:         "edgecipline_support",
  support_new_ticket_staff: "edgecipline_support",
  support_user_reply_staff: "edgecipline_support",
};

// Per-channel accent colours (hex) shown in the notification LED + icon tint
const CHANNEL_COLOR = {
  edgecipline_risk:       "#E53935", // bold red  — danger / urgency
  edgecipline_discipline: "#F59E0B", // amber     — caution / awareness
  edgecipline_insights:   "#0D9E6E", // green     — growth / positive
  edgecipline_coaching:   "#3B82F6", // blue      — calm / wisdom
  edgecipline_session:    "#8B5CF6", // purple    — focus / preparation
  edgecipline_ocr:        "#0EA5E9",
  edgecipline_support:    "#B8860B", // gold — matches the support UI accent
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
  session_reminder:       "sessionReminders",
  morning_mentor:         "morningMentor",
  streak_milestone:       "streakProtection",
  streak_at_risk:         "streakProtection",
  streak_broken:          "streakProtection",
  evening_reflection:     "eveningReflection",
  mission_update:         "smartCoach",
};

// Support notifications are transactional, not coaching. They are kept OUT of
// SMART_TYPE_TO_PREF on purpose: a customer who has switched off the smart
// coach has not asked to stop hearing back about their billing dispute.
// The two staff types are intentionally unmapped — an agent silencing queue
// alerts should do it by turning push off on their own account, not by
// flipping a customer-facing preference.
const SUPPORT_TYPE_TO_PREF = {
  support_ticket_created: "supportUpdates",
  support_agent_reply:    "supportUpdates",
  support_status_changed: "supportUpdates",
  support_resolved:       "supportUpdates",
  support_reopened:       "supportUpdates",
  support_assigned:       "supportUpdates",
};

function resolvePreferenceFlag(type) {
  return SMART_TYPE_TO_PREF[type] || SUPPORT_TYPE_TO_PREF[type] || null;
}

const INVALID_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  // Fails FCM's own format validation (corrupt/malformed value) — just as
  // permanently unsendable as a revoked token, so it gets the same cleanup
  // instead of retrying (and incrementing failureCount) forever.
  "messaging/invalid-argument",
]);
const TRANSIENT_FCM_CODES = new Set([
  "messaging/internal-error",
  "messaging/server-unavailable",
  "messaging/quota-exceeded",
  "messaging/message-rate-exceeded",
  "messaging/device-message-rate-exceeded",
]);
const DELIVERY_LEASE_MS = 2 * 60 * 1000;

const DEFAULT_QUIET_HOURS_TIMEZONE = "Asia/Kolkata";
const QUIET_HOURS_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

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

function parseQuietHoursTime(value) {
  if (typeof value !== "string") return null;

  const match = value.match(QUIET_HOURS_TIME_PATTERN);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return {
    minutesSinceMidnight: hours * 60 + minutes,
    value: `${match[1]}:${match[2]}`,
  };
}

function resolveQuietHoursTimezone(timezone, userId, type) {
  const candidate = typeof timezone === "string" ? timezone.trim() : "";
  if (!candidate) {
    logger.warn("[QuietHours] invalid timezone; falling back to Asia/Kolkata", {
      userId,
      type,
      timezone,
      fallbackTimezone: DEFAULT_QUIET_HOURS_TIMEZONE,
    });
    return DEFAULT_QUIET_HOURS_TIMEZONE;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch (error) {
    logger.warn("[QuietHours] invalid timezone; falling back to Asia/Kolkata", {
      userId,
      type,
      timezone,
      fallbackTimezone: DEFAULT_QUIET_HOURS_TIMEZONE,
      error: error.message,
    });
    return DEFAULT_QUIET_HOURS_TIMEZONE;
  }
}

function getLocalQuietHoursTime(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  if (hour === undefined || minute === undefined) {
    throw new Error("Unable to resolve local quiet-hours time");
  }

  return {
    localTime: `${hour}:${minute}`,
    minutesSinceMidnight: Number(hour) * 60 + Number(minute),
  };
}

function isTimeWithinQuietHours(currentMinutes, startMinutes, endMinutes) {
  if (startMinutes === endMinutes) return false;

  if (startMinutes < endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

function isBlockedByQuietHours(prefs, userId, type, now = new Date()) {
  if (!prefs.quietHours?.enabled) return false;

  const start = parseQuietHoursTime(prefs.quietHours.start);
  const end = parseQuietHoursTime(prefs.quietHours.end);
  if (!start || !end) {
    logger.error("QUIET_HOURS_CONFIGURATION_INVALID", {
      userId,
      type,
      start: prefs.quietHours.start,
      end: prefs.quietHours.end,
    });
    return true;
  }

  const timezone = resolveQuietHoursTimezone(prefs.quietHours.timezone, userId, type);
  let localTime;
  let minutesSinceMidnight;
  try {
    ({ localTime, minutesSinceMidnight } = getLocalQuietHoursTime(now, timezone));
  } catch (error) {
    logger.error("QUIET_HOURS_TIME_RESOLUTION_FAILED", {
      userId,
      type,
      timezone,
      error: error.message,
    });
    return true;
  }

  const blocked = isTimeWithinQuietHours(
    minutesSinceMidnight,
    start.minutesSinceMidnight,
    end.minutesSinceMidnight
  );

  if (blocked) {
    logger.info("QUIET_HOURS_BLOCKED", {
      userId: userId?.toString?.(),
      type,
      timezone,
      localTime,
      quietHoursStart: start.value,
      quietHoursEnd:   end.value,
      // Overnight windows (start > end) wrap past midnight.
      windowType: start.minutesSinceMidnight < end.minutesSinceMidnight
        ? "same-day"
        : "overnight",
    });
  }

  return blocked;
}

async function getAllowedPreferences(userId, type) {
  const prefs = await getOrCreatePreferences(userId);
  if (!isNotificationTypeEnabled(prefs, type)) return null;
  if (isBlockedByQuietHours(prefs, userId, type)) return null;

  return prefs;
}

function isNotificationTypeEnabled(prefs, type) {
  if (!prefs.inAppEnabled && !prefs.pushEnabled) return null;
  if (isSmartCoachType(type) && !prefs.smartCoach) return null;

  const flag = resolvePreferenceFlag(type);
  if (flag && prefs[flag] === false) return null;
  return true;
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
      tag:         `edgecipline_${notification._id?.toString?.() || notification.type}`,
      // Visibility: show on lock screen for urgent alerts, private otherwise
      visibility:  isUrgent ? "public" : "private",
    },
  };
}

// ─── Core push sender ─────────────────────────────────────────────────────────
async function sendPushToUser(userId, notification, acceptedTokenIds = []) {
  const filter = { user: userId, enabled: true, revokedAt: null };
  if (acceptedTokenIds.length) filter._id = { $nin: acceptedTokenIds };
  const tokens = await DeviceToken.find(filter)
    .select("_id token platform")
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
  const acceptedIds = [];
  const transientFailures = [];
  const permanentFailures = [];
  response.responses.forEach((result, index) => {
    const tokenRecord = tokens[index];
    if (!result.error) {
      acceptedIds.push(String(tokenRecord._id));
      return;
    }
    if (INVALID_TOKEN_CODES.has(result.error.code)) {
      invalidTokens.push(tokenRecord.token);
      permanentFailures.push({ tokenId: String(tokenRecord._id), code: result.error.code });
      return;
    }
    const failure = { tokenId: String(tokenRecord._id), code: result.error.code || "unknown" };
    if (TRANSIENT_FCM_CODES.has(result.error.code)) transientFailures.push(failure);
    else permanentFailures.push(failure);
  });

  await disableInvalidTokens(invalidTokens);
  if (acceptedIds.length) {
    await DeviceToken.updateMany(
      { _id: { $in: acceptedIds } },
      { $set: { failureCount: 0 } }
    );
  }
  const invalidTokenSet = new Set(invalidTokens);
  const failedIds = [...transientFailures, ...permanentFailures]
    .filter((item) => !invalidTokenSet.has(tokens.find((token) => String(token._id) === item.tokenId)?.token))
    .map((item) => item.tokenId);
  if (failedIds.length) {
    await DeviceToken.updateMany(
      { _id: { $in: failedIds } },
      { $inc: { failureCount: 1 } }
    );
  }

  return {
    successCount: response.successCount,
    failureCount: response.failureCount,
    invalidTokens,
    acceptedTokenIds: acceptedIds,
    transientFailures,
    permanentFailures,
  };
}

// ─── Public notifyUser ────────────────────────────────────────────────────────
async function notifyUser(userId, payload) {
  requireUserId(userId);
  const prefs = await getOrCreatePreferences(userId);
  if (!isNotificationTypeEnabled(prefs, payload.type)) return null;
  const quietHoursBlocked = isBlockedByQuietHours(prefs, userId, payload.type);

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
    logger.info("NOTIFICATION_CREATED", {
      notificationId: notification._id?.toString?.(),
      userId: userId?.toString?.(),
      notificationType: payload.type,
    });
  } catch (error) {
    if (error?.code === 11000) {
      notification = await NotificationHistory.findOne({ user: userId, dedupeKey });
      if (!notification || notification.status === "sent") return notification;
      logger.info("NOTIFICATION_RETRY_RESUMED", {
        userId: userId?.toString?.(), notificationType: payload.type, dedupeKey,
      });
    } else {
      throw error;
    }
  }

  if (!prefs.pushEnabled || quietHoursBlocked) {
    const reason = quietHoursBlocked ? "quiet_hours" : "push_disabled";
    return NotificationHistory.findOneAndUpdate(
      { _id: notification._id, user: userId },
      { status: "skipped", "delivery.error": reason },
      { returnDocument: "after" }
    );
  }

  const now = new Date();
  const claimed = await NotificationHistory.findOneAndUpdate(
    {
      _id: notification._id,
      user: userId,
      status: { $in: ["created", "failed", "partial", "skipped"] },
      $or: [{ deliveryLeaseUntil: null }, { deliveryLeaseUntil: { $lte: now } }],
      "delivery.error": { $ne: "push_disabled" },
    },
    {
      $set: { status: "sending", deliveryLeaseUntil: new Date(now.getTime() + DELIVERY_LEASE_MS) },
      $inc: { deliveryAttemptCount: 1 },
    },
    { returnDocument: "after" }
  );
  if (!claimed) return notification;
  notification = claimed;
  logger.info("NOTIFICATION_QUEUED", {
    notificationId: String(notification._id),
    userId: String(userId),
    notificationType: payload.type,
  });

  try {
    const alreadyAccepted = notification.delivery?.acceptedTokenIds || [];
    const delivery = await sendPushToUser(
      userId,
      { ...payload, ...notification.toObject() },
      alreadyAccepted
    );
    const acceptedTokenIds = [...new Set([...alreadyAccepted, ...(delivery.acceptedTokenIds || [])])];

    const status = delivery.noTokens          ? (acceptedTokenIds.length ? "sent" : "skipped")
      : delivery.transientFailures?.length    ? (acceptedTokenIds.length ? "partial" : "failed")
      : delivery.successCount > 0              ? "sent"
      : delivery.failureCount > 0              ? "failed"
      : "sent";

    const updated = await NotificationHistory.findOneAndUpdate(
      { _id: notification._id, user: userId },
      {
        status,
        sentAt: delivery.successCount > 0 || acceptedTokenIds.length
          ? (notification.sentAt || new Date())
          : null,
        deliveryLeaseUntil: null,
        delivery: {
          ...delivery,
          acceptedTokenIds,
          transientFailureCount: delivery.transientFailures?.length || 0,
          permanentFailureCount: delivery.permanentFailures?.length || 0,
          error: delivery.transientFailures?.length ? "transient_fcm_failure" : "",
        },
      },
      { returnDocument: "after" }
    ) || notification;

    logger.info("NOTIFICATION_SENT", {
      notificationId: notification._id?.toString?.(),
      userId: userId?.toString?.(),
      notificationType: payload.type,
      status,
      successCount: delivery.successCount,
      failureCount: delivery.failureCount,
      invalidTokenCount: delivery.invalidTokens?.length ?? 0,
    });

    if (delivery.transientFailures?.length) {
      const transientError = new Error("Transient FCM delivery failure");
      transientError.code = "FCM_TRANSIENT_FAILURE";
      transientError.acceptedCount = acceptedTokenIds.length;
      throw transientError;
    }
    return updated;

  } catch (error) {
    logger.warn("NOTIFICATION_FAILED", {
      userId: userId?.toString?.(),
      notificationType: payload.type,
      error:  error.message,
      code:   error.code,
    });

    await NotificationHistory.findOneAndUpdate(
      { _id: notification._id, user: userId },
      {
        status: error.acceptedCount > 0 || notification.delivery?.acceptedTokenIds?.length ? "partial" : "failed",
        deliveryLeaseUntil: null,
        "delivery.error": error.message,
      }
    );
    throw error;
  }
}

// ─── Engagement tracking ──────────────────────────────────────────────────────
async function trackDelivered(userId, notificationId) {
  const notification = await NotificationHistory.findOneAndUpdate(
    { _id: notificationId, user: requireUserId(userId), deliveredAt: null },
    { deliveredAt: new Date() },
    { returnDocument: "after" }
  ).lean();
  if (notification) {
    logger.info("NOTIFICATION_DELIVERED", {
      notificationId: String(notificationId),
      userId: String(userId),
      notificationType: notification.type,
    });
  }
  return notification;
}

async function trackOpen(userId, notificationId) {
  const notification = await NotificationHistory.findOneAndUpdate(
    { _id: notificationId, user: requireUserId(userId), openedAt: null },
    { openedAt: new Date(), isRead: true, readAt: new Date() },
    { returnDocument: "after" }
  ).lean();

  if (notification) {
    logger.info("NOTIFICATION_OPENED", {
      notificationId: notificationId?.toString?.(),
      userId: userId?.toString?.(),
      type: notification.type,
    });
  }
  return notification;
}

async function trackAction(userId, notificationId, actionType) {
  const now = new Date();
  // Action implies the notification was also opened — set openedAt only if not already set
  const notification = await NotificationHistory.findOneAndUpdate(
    { _id: notificationId, user: requireUserId(userId) },
    [
      {
        $set: {
          actionClickedAt: now,
          actionType: actionType || "default",
          isRead: true,
          readAt: { $ifNull: ["$readAt", now] },
          openedAt: { $ifNull: ["$openedAt", now] },
        },
      },
    ],
    { returnDocument: "after" }
  ).lean();

  if (notification) {
    logger.info("[NotificationAnalytics] Action", {
      notificationId: notificationId?.toString?.(),
      userId: userId?.toString?.(),
      type: notification.type,
      action: actionType || "default",
    });
  }
  return notification;
}

// ─── Query helpers ────────────────────────────────────────────────────────────
async function listUserNotifications(
  userId,
  { page = 1, limit = 50, unreadOnly = false } = {}
) {
  const query = { user: requireUserId(userId) };
  if (unreadOnly) query.isRead = false;
  const [items, total] = await Promise.all([
    NotificationHistory.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    NotificationHistory.countDocuments(query),
  ]);
  return {
    items,
    pagination: buildPagination({ page, limit, total }),
  };
}

async function markAsRead(userId, notificationId) {
  return NotificationHistory.findOneAndUpdate(
    { _id: notificationId, user: requireUserId(userId) },
    { isRead: true, readAt: new Date() },
    { returnDocument: "after" }
  ).lean();
}

async function markAllAsRead(userId) {
  await NotificationHistory.updateMany(
    { user: requireUserId(userId), isRead: false },
    { isRead: true, readAt: new Date() }
  );
  return { success: true };
}

module.exports = {
  getAllowedPreferences,
  getOrCreatePreferences,
  isBlockedByQuietHours,
  listUserNotifications,
  markAllAsRead,
  markAsRead,
  notifyUser,
  trackDelivered,
  trackOpen,
  trackAction,
};
