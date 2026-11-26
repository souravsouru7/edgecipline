const mongoose = require("mongoose");

// Earned Mind Wins and level-ups. Never revoked: a win the trader saw stays
// theirs even if a later edit changes the underlying trades.
//
// `periodKey` decides how often a win can repeat ("once", an ISO week, a
// streak length...). The unique index makes concurrent recomputes safe — the
// second insert hits E11000 and is ignored.
const mindMilestoneSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    key: { type: String, required: true, maxlength: 80 },
    periodKey: { type: String, required: true, maxlength: 80 },
    day: { type: String, required: true },
    earnedAt: { type: Date, default: Date.now },
    evidence: { type: mongoose.Schema.Types.Mixed, default: {} },

    // Recorded while rebuilding history (first compute, bulk import, backdated
    // trades): shown on the shelf, never celebrated or pushed.
    silent: { type: Boolean, default: false },
    seenAt: { type: Date, default: null },
    notifiedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

mindMilestoneSchema.index({ user: 1, key: 1, periodKey: 1 }, { unique: true });
mindMilestoneSchema.index({ user: 1, earnedAt: -1 });

module.exports = mongoose.model("MindMilestone", mindMilestoneSchema);
