const mongoose = require("mongoose");

// One row per (user, local day) on which the trader journaled — a completed
// trade in either market or a non-skipped reflection. Days without a journal
// entry have no row: the Mind Score holds still while someone is away instead
// of decaying (see utils/mindProgress.js).
//
// Rows are derived data. mindProgress.service rebuilds the trailing window
// from trades + reflections on every journal event, so an edited, deleted or
// backdated trade is reflected on the next recompute.
const mindScoreDailySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },

    // Null before the score unlocks (fewer than 3 journaled days). Stored with
    // one decimal so the smoothing stays exact; the UI rounds.
    score: { type: Number, default: null, min: 0, max: 100 },
    raw: { type: Number, default: null, min: 0, max: 100 },
    delta: { type: Number, default: null },
    level: { type: Number, default: null, min: 1, max: 6 },

    // { emotional, discipline, recovery, selfAwareness, journaling } — each
    // 0-100 or null when there was not enough data for that component.
    components: { type: mongoose.Schema.Types.Mixed, default: {} },
    coverage: { type: Number, default: 0, min: 0, max: 1 },

    // Signed reason facts that explain `delta` ({type, points, evidence}).
    // Facts, not text: copy is rendered from them at read time.
    reasons: { type: [mongoose.Schema.Types.Mixed], default: [] },
    // The day's headline fact ({type, sign, evidence}). Rotated so two
    // consecutive journal days never lead with the same fact type.
    headline: { type: mongoose.Schema.Types.Mixed, default: null },
    headlineType: { type: String, default: null },
    // Top week-over-week facts as of this day (last 7 vs previous 7).
    trend: { type: [mongoose.Schema.Types.Mixed], default: [] },
    missing: { type: [String], default: [] },

    // Day-level facts used by targets and wins.
    stats: { type: mongoose.Schema.Types.Mixed, default: {} },
    journaledDays: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

mindScoreDailySchema.index({ user: 1, day: 1 }, { unique: true });
mindScoreDailySchema.index({ user: 1, day: -1 });

module.exports = mongoose.model("MindScoreDaily", mindScoreDailySchema);
