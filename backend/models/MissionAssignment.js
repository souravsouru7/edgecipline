const mongoose = require("mongoose");

// ─── Status lifecycle ─────────────────────────────────────────────────────────
// available → accepted → active → completed
//                      ↘ archived (user gives up or mission expires)
const STATUSES = ["available", "accepted", "active", "completed", "archived", "expired"];
const RECOMMENDED_BY = ["ai", "system", "admin"];

// ─── Progress event schema (embedded, capped at 200 events) ──────────────────
// Used for audit trail and rollback when a trade is deleted or modified.
const progressEventSchema = new mongoose.Schema(
  {
    eventType: {
      type: String,
      enum: ["trade_pass", "trade_fail", "day_pass", "day_fail", "week_pass", "rollback"],
      required: true,
    },
    referenceId: { type: mongoose.Schema.Types.ObjectId, default: null }, // tradeId / reflectionId / reportId
    referenceDate: { type: String, default: null },  // 'YYYY-MM-DD' for day events
    delta: { type: Number, default: 0 },             // +1 or -N for rollback
    progressAfter: { type: Number, required: true },
    passed: { type: Boolean, default: true },
    reason: { type: String, default: null, maxlength: 200 },
    recordedAt: { type: Date, default: () => new Date() },
  },
  { _id: false }
);

// ─── Main schema ─────────────────────────────────────────────────────────────

const missionAssignmentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    template: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MissionTemplate",
      required: true,
    },

    // Status
    status: { type: String, enum: STATUSES, default: "available", index: true },

    // Snapshot of template data at assignment time (survives template edits)
    missionSnapshot: {
      name:              { type: String, required: true },
      description:       { type: String, required: true },
      category:          { type: String, required: true },
      difficulty:        { type: String, required: true },
      validationType:    { type: String, required: true },
      progressMode:      { type: String, required: true },
      target:            { type: Number, required: true },
      unit:              { type: String, required: true },
      validationConfig:  { type: mongoose.Schema.Types.Mixed, default: {} },
      coachMessage:      { type: String, default: null },
      completionMessage: { type: String, default: null },
      reward:            { type: mongoose.Schema.Types.Mixed, default: {} },
      // Was never declared here, so Mongoose's default schema strictness
      // silently stripped it on every save -- acceptMission's premium gate
      // (`missionSnapshot?.requiredPlan === "premium"`) compared against
      // undefined and never fired for any user, premium or not.
      requiredPlan:      { type: String, enum: [null, "free", "premium"], default: null },
    },

    // Progress counters
    currentProgress: { type: Number, default: 0, min: 0 },
    consecutiveCount: { type: Number, default: 0, min: 0 }, // for consecutive modes

    // Days indexed for day-based missions — prevents double-counting
    processedDays: { type: [String], default: [] },   // ['2026-07-01', ...]
    // Trade IDs indexed for trade-based missions
    processedTradeIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId }],
      default: [],
    },

    // Progress event log (capped; oldest events evicted when > 200)
    progressEvents: {
      type: [progressEventSchema],
      default: [],
    },

    // AI recommendation metadata
    recommendedBy: { type: String, enum: RECOMMENDED_BY, default: "system" },
    recommendationReason: { type: String, default: null, maxlength: 400 },

    // Lifecycle timestamps
    acceptedAt:   { type: Date, default: null },
    startedAt:    { type: Date, default: null },
    completedAt:  { type: Date, default: null },
    archivedAt:   { type: Date, default: null },
    expiresAt:    { type: Date, default: null },

    // Reward record
    reward: { type: mongoose.Schema.Types.Mixed, default: null },
    rewardGrantedAt: { type: Date, default: null },

    // For percentage missions: track numerator / denominator separately
    percentNumerator:   { type: Number, default: 0 },
    percentDenominator: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    // Enables Mongoose optimistic concurrency via __v. If two concurrent saves
    // race on the same assignment document, the second will throw a VersionError
    // instead of silently overwriting — progress hooks catch and retry.
    optimisticConcurrency: true,
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────

// Primary access patterns
missionAssignmentSchema.index({ user: 1, status: 1 });
missionAssignmentSchema.index({ user: 1, template: 1, status: 1 });
missionAssignmentSchema.index({ user: 1, createdAt: -1 });

// Prevent duplicate active assignments for the same template per user.
// A user should not have two active/accepted missions of the same template simultaneously.
missionAssignmentSchema.index(
  { user: 1, template: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ["available", "accepted", "active"] } },
  }
);

// Cron queries: find all active missions per status
missionAssignmentSchema.index({ status: 1, updatedAt: -1 });

module.exports = mongoose.model("MissionAssignment", missionAssignmentSchema);
module.exports.STATUSES = STATUSES;
