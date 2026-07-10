const mongoose = require("mongoose");

// One document per (user, day) — `day` is a 'YYYY-MM-DD' string anchored to
// the user's local timezone, so day-boundary math is timezone-stable on read.
// All streak calculations read from this collection; per-user denormalized
// counters on the User document are rebuilt from these entries.
const dailyDisciplineEntrySchema = new mongoose.Schema(
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

    // 'Forex' | 'Indian_Market' | 'any'. 'any' is used by no-trade-today
    // marks that aren't market-specific.
    market: {
      type: String,
      default: "any",
    },

    tradeCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    // True when the user explicitly marks "I sat out today" — keeps the
    // journal streak alive without requiring a trade.
    noTradeToday: {
      type: Boolean,
      default: false,
    },

    // At least one trade on this day was logged with a non-empty setupRules
    // array (i.e. the user used a pre-trade checklist).
    checklistUsed: {
      type: Boolean,
      default: false,
    },

    // True when at least one trade on this day had setupScore ≥ user's
    // discipline threshold. Used for the rule streak summary.
    ruleHit: {
      type: Boolean,
      default: false,
    },

    meta: {
      setupScores: { type: [Number], default: [] },
      firstTradeAt: { type: Date, default: null },
      lastTradeAt: { type: Date, default: null },
      note: { type: String, default: "", maxlength: 280 },
    },
  },
  { timestamps: true }
);

// Idempotent upserts: the same (user, day, market) tuple is updated in place
// when more trades land or when the user re-marks the day.
dailyDisciplineEntrySchema.index({ user: 1, day: 1, market: 1 }, { unique: true });
// Range queries for recompute and calendar reads.
dailyDisciplineEntrySchema.index({ user: 1, day: -1 });

module.exports = mongoose.model("DailyDisciplineEntry", dailyDisciplineEntrySchema);
