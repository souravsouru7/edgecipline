const mongoose = require("mongoose");

const ChecklistNotificationSettingSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    enabled: { type: Boolean, default: false },
    strategyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SetupStrategy",
      default: null,
    },
    strategyName: { type: String, default: "" },
    market: {
      type: String,
      enum: ["Forex", "Indian_Market"],
      default: "Forex",
    },
    notificationTime: { type: String, default: "09:00" },
    repeatMode: {
      type: String,
      enum: ["daily", "weekdays", "custom"],
      default: "daily",
    },
    // 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat, 7=Sun
    customDays: { type: [Number], default: [1, 2, 3, 4, 5] },
    persistent: { type: Boolean, default: false },
    resetEnabled: { type: Boolean, default: true },
    resetTime: { type: String, default: "00:00" },
  },
  { timestamps: true }
);

module.exports = mongoose.model(
  "ChecklistNotificationSetting",
  ChecklistNotificationSettingSchema
);
