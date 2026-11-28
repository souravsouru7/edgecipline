const mongoose = require("mongoose");

// One row per Gemini call. This is the only place token spend is visible
// per user and per feature; the Google bill only shows the total.
const FEATURES = [
  "coach",
  // Rolling Coach history summary (COACH_HISTORY_MODE=summary).
  "coach_summary",
  "trade_vision",
  "trade_text",
  "weekly_report",
  "trading_dna",
  "reflection",
  // One buddy-tone coaching line per user per day (mindProgress.service).
  "mind_progress",
  // Google Cloud Vision OCR (unit-priced, no tokens).
  "ocr_vision",
  // OpenAI text fallback for Forex OCR text (only when OPENAI_API_KEY is set).
  "trade_text_openai",
];

// metered:   provider usage metadata x price table
// estimated: no usage metadata (aborted hedge loser, failed call); tokens are
//            our best guess, so these never count as measured spend
// unit:      unit-priced API (Cloud Vision)
const COST_SOURCES = ["metered", "estimated", "unit"];

const RETENTION_DAYS = 180;

const aiUsageSchema = new mongoose.Schema(
  {
    // Null for calls that are not tied to one trader.
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    feature: { type: String, enum: FEATURES, required: true },
    // The model we asked for (config) and the one Google says served it.
    model: { type: String, default: "" },
    servedModel: { type: String, default: "" },
    inputTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    thinkingTokens: { type: Number, default: 0 },
    totalTokens: { type: Number, default: 0 },
    // Part of inputTokens served from cache (billed at the cached rate).
    cachedTokens: { type: Number, default: 0 },
    // 1 = first request of the operation; 2 = hedge backup or retry.
    attempt: { type: Number, default: 1 },
    hedged: { type: Boolean, default: false },
    aborted: { type: Boolean, default: false },
    costUsd: { type: Number, default: 0 },
    costInr: { type: Number, default: 0 },
    pricingVersion: { type: String, default: "" },
    costSource: { type: String, enum: COST_SOURCES, default: "metered" },
    // Groups the rows of one user operation (e.g. one screenshot upload).
    operationId: { type: String, default: "" },
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
aiUsageSchema.index({ operationId: 1 }, { partialFilterExpression: { operationId: { $gt: "" } } });

const AiUsage = mongoose.model("AiUsage", aiUsageSchema);

module.exports = AiUsage;
module.exports.FEATURES = FEATURES;
module.exports.COST_SOURCES = COST_SOURCES;
