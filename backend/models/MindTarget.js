const mongoose = require("mongoose");

const PRESETS = ["no_tag", "follow_rule", "stop_after_losses", "tag_every_trade", "plan_days"];
const STATUSES = ["active", "completed", "expired", "cancelled"];

// A psychology focus the trader picked for 7 local days. Success = `goal`
// clean days inside the window — forgiving on purpose: one slip doesn't fail
// the week, it just isn't a clean day.
const mindTargetSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    preset: { type: String, enum: PRESETS, required: true },
    // Preset parameters taken from the trader's own data, e.g. { tag: "fomo" }.
    params: { type: mongoose.Schema.Types.Mixed, default: {} },
    startDay: { type: String, required: true },
    endDay: { type: String, required: true },
    goal: { type: Number, default: 5, min: 1, max: 7 },
    status: { type: String, enum: STATUSES, default: "active" },
    cleanDays: { type: Number, default: 0, min: 0 },
    activeDays: { type: Number, default: 0, min: 0 },
    // { 'YYYY-MM-DD': 'clean' | 'slip' } for days with activity.
    dayResults: { type: mongoose.Schema.Types.Mixed, default: {} },
    completedDay: { type: String, default: null },
  },
  { timestamps: true }
);

// One active target per user.
mindTargetSchema.index(
  { user: 1 },
  { unique: true, partialFilterExpression: { status: "active" }, name: "one_active_target_per_user" }
);
mindTargetSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("MindTarget", mindTargetSchema);
module.exports.PRESETS = PRESETS;
module.exports.STATUSES = STATUSES;
