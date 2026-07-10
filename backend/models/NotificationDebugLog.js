const mongoose = require("mongoose");

// One document per user per notification type.
// Upserted on every evaluation — always reflects the most recent run.
const NotificationDebugLogSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      required: true,
      enum: ["setup_discipline"],
    },

    // ─── Source trade ──────────────────────────────────────────────
    tradeId:    { type: mongoose.Schema.Types.ObjectId, default: null },
    marketType: { type: String, default: "Forex" },
    tradeDate:  { type: Date, default: null },

    // ─── Evaluation inputs ─────────────────────────────────────────
    setupScore:    { type: Number, default: null },
    profit:        { type: Number, default: null },
    lowScoreToday: { type: Number, default: null },

    // ─── Gate results ──────────────────────────────────────────────
    gate1Passed: { type: Boolean, default: false },
    gate3Passed: { type: Boolean, default: false },

    // ─── Deduplication ────────────────────────────────────────────
    dedupeKey:    { type: String, default: null },
    dedupeBlocked: { type: Boolean, default: false },

    // ─── Delivery ─────────────────────────────────────────────────
    notificationCreated: { type: Boolean, default: false },
    notificationId:      { type: mongoose.Schema.Types.ObjectId, default: null },
    pushSent:            { type: Boolean, default: false },
    pushSuccessCount:    { type: Number, default: 0 },
    pushFailureCount:    { type: Number, default: 0 },

    evaluatedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

NotificationDebugLogSchema.index({ user: 1, type: 1 }, { unique: true });
// TTL on updatedAt: a stale debug row (no new evaluation in 30 days) is no
// longer useful and the collection should not retain rows for users who
// stopped trading. Mongoose `timestamps: true` maintains `updatedAt`.
NotificationDebugLogSchema.index(
  { updatedAt: 1 },
  { expireAfterSeconds: 30 * 24 * 60 * 60 }
);

module.exports = mongoose.model("NotificationDebugLog", NotificationDebugLogSchema);
