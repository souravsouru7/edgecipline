const mongoose = require("mongoose");
const DeviceToken = require("../models/DeviceToken");
const NotificationHistory = require("../models/NotificationHistory");
const NotificationPreference = require("../models/NotificationPreference");
const { getFirebaseAdmin } = require("../config/firebaseAdmin");
const { logger } = require("../utils/logger");
const { buildPagination } = require("../utils/apiResponse");
const User = require("../models/Users");
const {
  DAILY_PUSH_CAP,
  UNCAPPED_TYPES,
  getCollapseKey,
  getTtlMs,
  isCappedType,
  isPromotionalType,
  isWithinPromoWindow,
} = require("../utils/notificationPolicy");
const { getDayRange } = require("../utils/timezone");

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
  // Free-tier funnel nudges are insight-flavoured ("there's a pattern in
  // your trades"), so they share the insights channel rather than coaching.
  free_tier_d_plus_1:     "edgecipline_insights",
  free_tier_d_plus_3:     "edgecipline_insights",
  free_tier_d_plus_7:     "edgecipline_insights",
  free_tier_d_plus_14:    "edgecipline_insights",
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
// Trade-analysis coaching. These sit under the `smartCoach` master switch AND
// their own flag.
const SMART_TYPE_TO_PREF = {
  revenge_trading:        "revengeTrading",
  overtrading:            "overtrading",
  setup_discipline:       "setupDiscipline",
  repeated_mistake:       "repeatedMistakes",
  mood_risk:              "moodRisk",
  no_stop_loss:           "noStopLoss",
  daily_loss_warning:     "dailyLossWarning",
  weekly_ai_insight:      "weeklyInsight",
  confidence_reminder:    "smartCoach",
  mission_update:         "smartCoach",
};

// Scheduled reminders. Each has its own switch only — turning off the smart
// coach used to silence all of these too, which is not what that toggle says.
const REMINDER_TYPE_TO_PREF = {
  weekly_report_reminder: "weeklyInsight",
  session_reminder:       "sessionReminders",
  morning_mentor:         "morningMentor",
  streak_milestone:       "streakProtection",
  streak_at_risk:         "streakProtection",
  streak_broken:          "streakProtection",
  evening_reflection:     "eveningReflection",
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
  if (isPromotionalType(type)) return "promotions";
  return SMART_TYPE_TO_PREF[type] || REMINDER_TYPE_TO_PREF[type] || SUPPORT_TYPE_TO_PREF[type] || null;
}

const INVALID_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);
// FCM returns this both for a malformed token AND for a malformed message
// (oversized data, reserved key). Only the first means the token is dead, so
// it is handled per send: see classifyInvalidArgument.
const INVALID_ARGUMENT_CODE = "messaging/invalid-argument";
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

  const collapseKey = getCollapseKey(notification.type);

  return {
    priority: isUrgent ? "high" : "normal",
    // Per-type expiry (utils/notificationPolicy): a session reminder that
    // could not be delivered within 30 min is dropped, not shown tomorrow.
    ttl: getTtlMs(notification.type),
    ...(collapseKey ? { collapseKey } : {}),
    notification: {
      channelId,
      icon:        "ic_stat_edgecipline",   // white monochrome icon in res/drawable
      color,
      sound:       "default",
      // No clickAction: FCM turns it into an Intent action that no activity in
      // AndroidManifest declares ("OPEN_APP" never was), so a tap on a push
      // while the app was closed did nothing. Without it the tap opens the
      // launcher activity and Capacitor fires pushNotificationActionPerformed.
      body:        notification.body,
      // Same-type reminders replace each other in the tray; one-off alerts
      // keep a unique tag so they never overwrite each other.
      tag:         collapseKey || `edgecipline_${notification._id?.toString?.() || notification.type}`,
      // Visibility: show on lock screen for urgent alerts, private otherwise
      visibility:  isUrgent ? "public" : "private",
    },
  };
}

// iOS had no `apns` block at all: no sound, and FCM's ~4-week default expiry,
// so an offline iPhone could receive a week of stale session reminders.
function buildApnsConfig(notification, now = Date.now()) {
  const channelId = TYPE_CHANNEL[notification.type] || "edgecipline_insights";
  const isUrgent = channelId === "edgecipline_risk";
  const collapseKey = getCollapseKey(notification.type);
  const headers = {
    "apns-expiration": String(Math.floor((now + getTtlMs(notification.type)) / 1000)),
    "apns-priority": isUrgent ? "10" : "5",
  };
  if (collapseKey) headers["apns-collapse-id"] = collapseKey;
  return {
    headers,
    payload: {
      aps: {
        sound: "default",
        "thread-id": channelId,
      },
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
    apns: buildApnsConfig(notification),
  };

  const response = await admin.messaging().sendEachForMulticast(message);

  // invalid-argument on EVERY token = the message itself is malformed; the
  // tokens are fine and must not be disabled. On only some tokens = those
  // tokens are corrupt.
  const invalidArgumentCount = response.responses
    .filter((result) => result.error?.code === INVALID_ARGUMENT_CODE).length;
  const payloadRejected = invalidArgumentCount > 0 && invalidArgumentCount === response.responses.length;
  if (payloadRejected) {
    logger.error("NOTIFICATION_PAYLOAD_REJECTED", {
      userId: userId?.toString?.(),
      notificationType: notification.type,
      tokenCount: tokens.length,
    });
  }

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
    const tokenIsDead = INVALID_TOKEN_CODES.has(result.error.code)
      || (result.error.code === INVALID_ARGUMENT_CODE && !payloadRejected);
    if (tokenIsDead) {
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
// Reason codes attached to every "not sent" decision. Stable strings so log
// queries and the admin history view can group on them.
const SKIP_REASONS = Object.freeze({
  PREFERENCE_DISABLED: "PREFERENCE_DISABLED",
  PUSH_DISABLED: "push_disabled",   // persisted in delivery.error — keep legacy spelling
  QUIET_HOURS: "quiet_hours",       // persisted in delivery.error — keep legacy spelling
  DUPLICATE: "DUPLICATE",
  NO_DEVICE_TOKEN: "NO_DEVICE_TOKEN",
  ACCOUNT_INACTIVE: "ACCOUNT_INACTIVE",
  OUTSIDE_PROMO_WINDOW: "OUTSIDE_PROMO_WINDOW",
  DAILY_CAP: "DAILY_CAP",
});

// One timezone per user for every "local" rule. The device reports it on
// push registration (deviceTokenController), which writes it here.
function getPreferenceTimezone(prefs) {
  return prefs?.quietHours?.timezone || DEFAULT_QUIET_HOURS_TIMEZONE;
}

// Disabled accounts (admin action) and accounts mid-deletion get nothing —
// their device tokens survive until the purge step finishes.
async function isAccountReachable(userId) {
  const user = await User.findById(userId).select("accountStatus pendingDeletion").lean();
  if (!user) return false;
  return user.accountStatus !== "disabled" && !user.pendingDeletion;
}

async function pushesSentToday(userId, timezone, now = new Date()) {
  const { start, end } = getDayRange(now, timezone);
  return NotificationHistory.countDocuments({
    user: userId,
    createdAt: { $gte: start, $lt: end },
    status: { $in: ["sent", "partial", "sending"] },
    type: { $nin: [...UNCAPPED_FOR_COUNT] },
  });
}

// Types excluded from the cap count — the same set isCappedType exempts
// (support types are matched by prefix there, listed explicitly here).
const UNCAPPED_FOR_COUNT = new Set([
  ...UNCAPPED_TYPES,
  ...Object.keys(TYPE_CHANNEL).filter((type) => type.startsWith("support_")),
]);

function logSkipped(userId, payload, reason, extra = {}) {
  logger.info("NOTIFICATION_SKIPPED", {
    userId: userId?.toString?.(),
    notificationType: payload.type,
    marketType: payload.data?.marketType || null,
    dedupeKey: payload.dedupeKey || null,
    reason,
    ...extra,
  });
}

async function notifyUser(userId, payload) {
  requireUserId(userId);
  const prefs = await getOrCreatePreferences(userId);
  if (!isNotificationTypeEnabled(prefs, payload.type)) {
    logSkipped(userId, payload, SKIP_REASONS.PREFERENCE_DISABLED, {
      preferenceFlag: resolvePreferenceFlag(payload.type) || (isSmartCoachType(payload.type) ? "smartCoach" : "inAppEnabled/pushEnabled"),
    });
    return null;
  }

  if (!(await isAccountReachable(userId))) {
    logSkipped(userId, payload, SKIP_REASONS.ACCOUNT_INACTIVE);
    return null;
  }

  const timezone = getPreferenceTimezone(prefs);
  // Promotions are normally delayed into the window at enqueue time
  // (queues/smartNotificationQueue); this catches a timezone change since.
  if (isPromotionalType(payload.type) && !isWithinPromoWindow(new Date(), timezone)) {
    logSkipped(userId, payload, SKIP_REASONS.OUTSIDE_PROMO_WINDOW, { timezone });
    return null;
  }

  if (isCappedType(payload.type)) {
    const alreadyExists = payload.dedupeKey
      ? await NotificationHistory.exists({ user: userId, dedupeKey: payload.dedupeKey })
      : null;
    // A retry of an existing row is not a new push — never cap it.
    if (!alreadyExists) {
      const sentToday = await pushesSentToday(userId, timezone);
      if (sentToday >= DAILY_PUSH_CAP) {
        logSkipped(userId, payload, SKIP_REASONS.DAILY_CAP, { sentToday, cap: DAILY_PUSH_CAP });
        return null;
      }
    }
  }

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
      if (!notification || notification.status === "sent") {
        logSkipped(userId, payload, SKIP_REASONS.DUPLICATE, {
          notificationId: notification?._id?.toString?.(),
          existingStatus: notification?.status || null,
        });
        return notification;
      }
      logger.info("NOTIFICATION_RETRY_RESUMED", {
        userId: userId?.toString?.(), notificationType: payload.type, dedupeKey,
      });
    } else {
      throw error;
    }
  }

  if (!prefs.pushEnabled || quietHoursBlocked) {
    const reason = quietHoursBlocked ? SKIP_REASONS.QUIET_HOURS : SKIP_REASONS.PUSH_DISABLED;
    logSkipped(userId, payload, reason, { notificationId: notification._id?.toString?.(), inboxRowKept: true });
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

    if (delivery.noTokens && !acceptedTokenIds.length) {
      logSkipped(userId, payload, SKIP_REASONS.NO_DEVICE_TOKEN, { notificationId: notification._id?.toString?.(), inboxRowKept: true });
    }
    logger.info("NOTIFICATION_SENT", {
      notificationId: notification._id?.toString?.(),
      userId: userId?.toString?.(),
      notificationType: payload.type,
      marketType: payload.data?.marketType || null,
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
  SKIP_REASONS,
  buildAndroidConfig,
  buildApnsConfig,
  getPreferenceTimezone,
  resolvePreferenceFlag,
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
