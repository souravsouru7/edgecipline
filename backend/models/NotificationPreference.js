const mongoose = require("mongoose");

const NotificationPreferenceSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    pushEnabled: { type: Boolean, default: true },
    inAppEnabled: { type: Boolean, default: true },
    smartCoach: { type: Boolean, default: true },
    revengeTrading: { type: Boolean, default: true },
    overtrading: { type: Boolean, default: true },
    setupDiscipline: { type: Boolean, default: true },
    repeatedMistakes: { type: Boolean, default: true },
    moodRisk: { type: Boolean, default: true },
    noStopLoss: { type: Boolean, default: true },
    weeklyInsight: { type: Boolean, default: true },
    morningMentor: { type: Boolean, default: true },
    quietHours: {
      enabled: { type: Boolean, default: false },
      start: { type: String, default: "22:00" },
      end: { type: String, default: "07:00" },
      timezone: { type: String, default: "Asia/Kolkata" },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("NotificationPreference", NotificationPreferenceSchema);
