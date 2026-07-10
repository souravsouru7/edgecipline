const mongoose = require("mongoose");

const tradingDnaReportSchema = new mongoose.Schema(
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
      enum: ["30d", "90d", "365d"],
      default: "90d",
      index: true,
    },
    windowStart: { type: Date, required: true },
    windowEnd: { type: Date, required: true },

    // Compact deterministic signal bundle (input to the AI prompt).
    bundle: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    // Parsed Gemini output: identity, strengths, weaknesses, blindSpots,
    // behaviorPatterns, improvementPriorities, coachSummary, confidenceNote.
    ai: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    aiModel: { type: String, default: "" },
    promptVersion: { type: String, default: "v1" },
    // Snapshot of the trade-cache version at generation time. The version
    // bumps on every trade mutation (create / edit / delete / OCR save /
    // setup edit / restore), so comparing it against the current version
    // on read lets us tell the user "your data has changed since this
    // report was generated" without scanning the trades collection.
    dataVersion: { type: String, default: "" },
  },
  { timestamps: true }
);

// One report per (user, market, period) per day window — repeated regenerations
// on the same calendar day overwrite rather than spawn duplicates.
tradingDnaReportSchema.index(
  { user: 1, marketType: 1, periodType: 1, windowStart: 1, windowEnd: 1 },
  { unique: true }
);
tradingDnaReportSchema.index({ user: 1, marketType: 1, periodType: 1, createdAt: -1 });
tradingDnaReportSchema.index({ user: 1, marketType: 1, createdAt: -1 });

module.exports = mongoose.model("TradingDnaReport", tradingDnaReportSchema);
