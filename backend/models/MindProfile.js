const mongoose = require("mongoose");

// Per-user Mind Score state that must never move backwards when two journal
// events race: best score and highest level are only ever raised with $max.
const mindProfileSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },

    // Local day the score unlocked (3rd journaled day) and the score that day.
    unlockedDay: { type: String, default: null },
    startingScore: { type: Number, default: null },

    currentScore: { type: Number, default: null },
    currentLevel: { type: Number, default: null },
    personalBest: { type: Number, default: null },
    highestLevel: { type: Number, default: 0 },

    lastJournaledDay: { type: String, default: null },
    lastComputedAt: { type: Date, default: null },

    // Personal records used by "beat your own best" Mind Wins.
    baselines: {
      bestPlanRun: { type: Number, default: 0 },
      bestSelfAwareness: { type: Number, default: null },
      bestRecoveryRate: { type: Number, default: null },
    },

    // At most one Mind push per local day (mindProgressCron).
    lastPushDay: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("MindProfile", mindProfileSchema);
