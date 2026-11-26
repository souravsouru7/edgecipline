const mongoose = require("mongoose");

// The day's AI coach line for the Mind Score card. At most one Gemini call per
// user per local day; `fallback` rows come from the deterministic copy engine.
const mindInsightSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    text: { type: String, required: true, maxlength: 280 },
    model: { type: String, default: "" },
    fallback: { type: Boolean, default: false },
  },
  { timestamps: true }
);

mindInsightSchema.index({ user: 1, day: 1 }, { unique: true });

module.exports = mongoose.model("MindInsight", mindInsightSchema);
