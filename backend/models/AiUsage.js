const mongoose = require("mongoose");

// One row per Gemini call. This is the only place token spend is visible
// per user and per feature; the Google bill only shows the total.
const FEATURES = [
  "coach",
  "trade_vision",
  "trade_text",
  "weekly_report",
  "trading_dna",
  "reflection",
];

const RETENTION_DAYS = 180;

const aiUsageSchema = new mongoose.Schema(
  {
    // Null for calls that are not tied to one trader.
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    feature: { type: String, enum: FEATURES, required: true },
    model: { type: String, default: "" },
    inputTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    thinkingTokens: { type: Number, default: 0 },
    totalTokens: { type: Number, default: 0 },
    ok: { type: Boolean, default: true },
    errorCode: { type: String, default: "" },
    latencyMs: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

aiUsageSchema.index({ createdAt: 1 }, { expireAfterSeconds: RETENTION_DAYS * 24 * 60 * 60 });
aiUsageSchema.index({ feature: 1, createdAt: -1 });
aiUsageSchema.index({ user: 1, createdAt: -1 });

const AiUsage = mongoose.model("AiUsage", aiUsageSchema);

module.exports = AiUsage;
module.exports.FEATURES = FEATURES;
