const mongoose = require("mongoose");

// One reflection per (user, day) — `day` is a 'YYYY-MM-DD' string anchored to
// the user's local timezone, matching DailyDisciplineEntry so the two
// collections join cleanly when computing the weekly score.
//
// The 30-second submission shape is deliberate: every field is optional except
// the day key, so a user can answer one slider, skip the rest, and still
// produce a meaningful record. The AI insight is generated post-save in the
// service layer and stored back on the same document.
const dailyReflectionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    day: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },

    // 'Forex' | 'Indian_Market' | 'any'. 'any' for users with no preferred
    // market and for skipped reflections that aren't market-specific.
    market: {
      type: String,
      default: "any",
    },

    // Snapshot of the trade-day context taken when the user opens the sheet,
    // so the reflection record carries enough info to render history later
    // without re-querying Trade.
    context: {
      tradeCount:        { type: Number, default: 0, min: 0 },
      hadTrades:         { type: Boolean, default: false },
      grossPnL:          { type: Number, default: 0 },
      followedChecklist: { type: Boolean, default: false },
    },

    // Did you follow your trading plan today?
    // 'no_trades' is a distinct state — not the same as "no" — because a user
    // who didn't trade isn't violating discipline.
    followedPlan: {
      type: String,
      enum: ["yes", "partly", "no", "no_trades", null],
      default: null,
    },

    // 1 = drained / 5 = great. Slider value.
    mood: {
      type: Number,
      min: 1,
      max: 5,
      default: null,
    },

    // 1 = shaken / 5 = high. Slider value.
    confidence: {
      type: Number,
      min: 1,
      max: 5,
      default: null,
    },

    // Would you take today's execution again? Distinct from followedPlan —
    // captures whether the outcome was acceptable in hindsight, not just the
    // process.
    wouldRepeat: {
      type: String,
      enum: ["yes", "no", "partly", null],
      default: null,
    },

    // One thing to improve tomorrow. Optional free-form, capped tight so the
    // 30-second promise holds.
    improvement: {
      type: String,
      default: "",
      maxlength: 280,
    },

    // The user chose to skip the reflection. We still write a row so the
    // streak/cron know not to nudge again and so the weekly score reflects
    // completion behaviour.
    skipped: {
      type: Boolean,
      default: false,
    },

    // AI-generated coaching line (≤200 chars). Populated asynchronously after
    // submission by reflectionInsightService.
    aiInsight: {
      type: String,
      default: "",
      maxlength: 280,
    },
    aiInsightGeneratedAt: {
      type: Date,
      default: null,
    },
    aiInsightModel: {
      type: String,
      default: "",
    },
    aiInsightFallback: {
      type: Boolean,
      default: false,
    },

    // Which surface produced this row: 'manual' (user opened the sheet),
    // 'notification' (tapped the evening push), or 'cron-skip' (silently
    // marked skipped by an end-of-day rollup — reserved, not currently used).
    source: {
      type: String,
      enum: ["manual", "notification", "cron-skip"],
      default: "manual",
    },
  },
  { timestamps: true }
);

// One reflection per user per day. Idempotent upserts in the service.
dailyReflectionSchema.index({ user: 1, day: 1 }, { unique: true });
// Calendar reads: history list + weekly score window.
dailyReflectionSchema.index({ user: 1, day: -1 });

module.exports = mongoose.model("DailyReflection", dailyReflectionSchema);
