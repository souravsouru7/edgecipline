const mongoose = require("mongoose");

const NotificationHistorySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      required: true,
      enum: [
        "revenge_trading",
        "overtrading",
        "setup_discipline",
        "repeated_mistake",
        "mood_risk",
        "no_stop_loss",
        "daily_loss_warning",
        "confidence_reminder",
        "session_reminder",
        "morning_mentor",
        "weekly_ai_insight",
        "weekly_report_reminder",
        "ocr_completed",
        "ocr_failed",
        "issue_fixed",
        "admin_issue_report",
        "payment",
        "feedback",
        "system",
        // Subscription Rescue Funnel — one type per touchpoint so prefs +
        // analytics can target the funnel without string matching.
        "renewal_d_minus_7",
        "renewal_d_minus_3",
        "renewal_d_minus_1",
        "renewal_d_plus_0",
        "winback_d_plus_3",
        "winback_d_plus_7",
        "winback_d_plus_14",
        // Customer support. One type per event so NotificationPreference can
        // gate the whole group and analytics can separate customer-facing
        // updates from the staff fan-out without string matching.
        "support_ticket_created",
        "support_agent_reply",
        "support_status_changed",
        "support_resolved",
        "support_reopened",
        "support_assigned",
        "support_new_ticket_staff",
        "support_user_reply_staff",
      ],
    },
    title: { type: String, required: true },
    body: { type: String, required: true },
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    deepLink: {
      type: String,
      default: "",
    },
    sourceType: {
      type: String,
      enum: [
        "trade",
        "weekly_report",
        "cron",
        "system",
        "ocr_job",
        "issue_report",
        "streak",
        "support_ticket",
      ],
      default: "system",
    },
    sourceId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    dedupeKey: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["created", "sending", "sent", "failed", "partial", "skipped"],
      default: "created",
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    readAt: {
      type: Date,
      default: null,
    },
    sentAt: {
      type: Date,
      default: null,
    },
    deliveredAt: {
      type: Date,
      default: null,
    },
    deliveryLeaseUntil: {
      type: Date,
      default: null,
    },
    deliveryAttemptCount: {
      type: Number,
      default: 0,
    },
    openedAt: {
      type: Date,
      default: null,
    },
    actionClickedAt: {
      type: Date,
      default: null,
    },
    actionType: {
      type: String,
      default: null,
    },
    delivery: {
      successCount: { type: Number, default: 0 },
      failureCount: { type: Number, default: 0 },
      // M14: Cap at 100 to prevent unbounded array growth per notification record
      invalidTokens: {
        type: [String],
        default: [],
        validate: {
          validator: (arr) => arr.length <= 500,
          message: "invalidTokens may not exceed 500 entries",
        },
      },
      error: { type: String, default: "" },
      acceptedTokenIds: {
        type: [String],
        default: [],
        validate: {
          validator: (arr) => arr.length <= 500,
          message: "acceptedTokenIds may not exceed 500 entries",
        },
      },
      transientFailures: {
        type: [mongoose.Schema.Types.Mixed],
        default: [],
        validate: {
          validator: (arr) => arr.length <= 500,
          message: "transientFailures may not exceed 500 entries",
        },
      },
      permanentFailures: {
        type: [mongoose.Schema.Types.Mixed],
        default: [],
        validate: {
          validator: (arr) => arr.length <= 500,
          message: "permanentFailures may not exceed 500 entries",
        },
      },
      transientFailureCount: { type: Number, default: 0 },
      permanentFailureCount: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

NotificationHistorySchema.index({ user: 1, createdAt: -1 });
NotificationHistorySchema.index({ user: 1, isRead: 1, createdAt: -1 });
NotificationHistorySchema.index({ user: 1, dedupeKey: 1 }, { unique: true });
// Analytics aggregation index — status + type scans for funnel metrics
NotificationHistorySchema.index({ type: 1, status: 1, createdAt: -1 });
NotificationHistorySchema.index({ createdAt: -1 });

module.exports = mongoose.model("NotificationHistory", NotificationHistorySchema);
