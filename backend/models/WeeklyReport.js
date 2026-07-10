const mongoose = require("mongoose");

const weeklyReportSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    marketType: {
      type: String,
      enum: ["Forex", "Indian_Market"],
      default: "Forex",
      index: true,
    },
    periodType: {
      type: String,
      enum: ["rolling7d"],
      default: "rolling7d",
      index: true,
    },
    weekStart: { type: Date, required: true, index: true },
    weekEnd: { type: Date, required: true, index: true },

    snapshot: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    aiFeedback: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    aiModel: { type: String, default: "" },
    promptVersion: { type: String, default: "v1" },
  },
  { timestamps: true }
);

weeklyReportSchema.index({ user: 1, marketType: 1, periodType: 1, weekStart: 1, weekEnd: 1 }, { unique: true });
weeklyReportSchema.index({ user: 1, marketType: 1, weekStart: -1 });
weeklyReportSchema.index({ user: 1, marketType: 1, periodType: 1, createdAt: -1 });

module.exports = mongoose.model("WeeklyReport", weeklyReportSchema);

