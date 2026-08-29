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
    sessionReminders: { type: Boolean, default: true },
    morningMentor: { type: Boolean, default: true },
    streakProtection: { type: Boolean, default: true },
    eveningReflection: { type: Boolean, default: true },
    // Ticket replies, status changes, resolutions. Defaults on and is gated
    // separately from smartCoach — switching off coaching nudges must not
    // silence the answer to a support request.
    supportUpdates: { type: Boolean, default: true },
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
