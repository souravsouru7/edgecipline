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
        "payment",
        "feedback",
        "system",
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
      enum: ["trade", "weekly_report", "cron", "system"],
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
      enum: ["created", "sent", "failed", "partial", "skipped"],
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
    delivery: {
      successCount: { type: Number, default: 0 },
      failureCount: { type: Number, default: 0 },
      invalidTokens: { type: [String], default: [] },
      error: { type: String, default: "" },
    },
  },
  { timestamps: true }
);

NotificationHistorySchema.index({ user: 1, createdAt: -1 });
NotificationHistorySchema.index({ user: 1, isRead: 1, createdAt: -1 });
NotificationHistorySchema.index({ user: 1, dedupeKey: 1 }, { unique: true });

module.exports = mongoose.model("NotificationHistory", NotificationHistorySchema);
