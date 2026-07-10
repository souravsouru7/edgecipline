const mongoose = require("mongoose");

// ─── Enumerations ─────────────────────────────────────────────────────────────

const CATEGORIES = ["risk_management", "discipline", "psychology", "journal", "strategy"];
const DIFFICULTIES = ["beginner", "intermediate", "advanced"];
const PROGRESS_MODES = [
  "consecutive_trades", // N consecutive trades all passing validation
  "consecutive_days",   // N consecutive calendar days all passing
  "total_trades",       // Accumulate N qualifying trades (non-consecutive)
  "total_days",         // Accumulate N qualifying calendar days
  "percentage",         // X% of trades over a window must pass
];
const VALIDATION_TYPES = [
  "risk_per_trade",            // trade.riskPercent <= threshold
  "stop_loss_required",        // trade.stopLoss exists & non-zero
  "risk_reward_minimum",       // trade.riskRewardRatio >= threshold
  "no_revenge_trade",          // no revenge-trade signal for the day
  "checklist_every_trade",     // trade has checklist tracking record
  "plan_adherence",            // reflection.followPlan === 'yes'
  "no_fomo_trade",             // no FOMO-tagged trade for the day
  "daily_reflection",          // DailyReflection exists for that day
  "lesson_on_loss",            // losing trade must have non-empty notes
  "calm_mood_percentage",      // reflection.mood >= threshold (percentage mode)
  "trade_logged",              // any trade logged on that day (journal streak proxy)
  "weekly_review_completed",   // WeeklyReport generated for the week
  "psychology_fields_complete",// trade has associated reflection
  "high_confidence_only",      // reflection.confidence >= threshold
  "daily_loss_limit",          // daily net P&L >= -dailyLossLimit
];

// ─── Schema ──────────────────────────────────────────────────────────────────

const missionTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, required: true, trim: true, maxlength: 500 },
    category: { type: String, enum: CATEGORIES, required: true, index: true },
    difficulty: { type: String, enum: DIFFICULTIES, required: true },

    // How progress is counted
    validationType: { type: String, enum: VALIDATION_TYPES, required: true },
    progressMode: { type: String, enum: PROGRESS_MODES, required: true },
    target: { type: Number, required: true, min: 1 },
    unit: { type: String, required: true },   // "trades" | "days" | "sessions" | "weeks"

    // Thresholds / parameters for the validation logic
    validationConfig: {
      riskPercentMax:     { type: Number, default: null }, // % (e.g. 1.0)
      rrMin:              { type: Number, default: null }, // ratio (e.g. 1.5)
      moodMin:            { type: Number, default: null }, // 1-5 scale
      confidenceMin:      { type: Number, default: null }, // 1-5 scale
      moodPercentage:     { type: Number, default: null }, // % of trades
      requireNotes:       { type: Boolean, default: false },
      requireReflection:  { type: Boolean, default: false },
    },

    // AI recommendation trigger — when this metric is detected as a weakness
    triggerMetric: { type: String, default: null }, // field name in user behavior profile
    triggerOperator: { type: String, enum: ["gt", "lt", "gte", "lte", "eq"], default: "gt" },
    triggerThreshold: { type: Number, default: null },
    triggerLookbackDays: { type: Number, default: 30 },

    // UX copy
    coachMessage: { type: String, trim: true, maxlength: 300 },
    completionMessage: { type: String, trim: true, maxlength: 300 },

    // Reward metadata (discipline badges only — never financial)
    reward: {
      badge: { type: String, default: "discipline_badge" },
      badgeLabel: { type: String, default: "Discipline Badge" },
      badgeColor: { type: String, default: "#0D9E6E" },
      completionMessage: { type: String, maxlength: 200 },
    },

    estimatedDays: { type: Number, default: null },
    expiryDays: { type: Number, default: null }, // null = no expiry

    // Plan gating: null = available to everyone, 'premium' = requires active sub or trial
    requiredPlan: {
      type: String,
      enum: [null, "free", "premium"],
      default: null,
    },

    // Admin control
    isActive: { type: Boolean, default: true, index: true },
    isSystemMission: { type: Boolean, default: true },  // system templates can't be deleted
    sortOrder: { type: Number, default: 0 },
    tags: { type: [String], default: [] },
  },
  { timestamps: true }
);

missionTemplateSchema.index({ category: 1, isActive: 1 });
missionTemplateSchema.index({ validationType: 1 });

module.exports = mongoose.model("MissionTemplate", missionTemplateSchema);
module.exports.CATEGORIES = CATEGORIES;
module.exports.DIFFICULTIES = DIFFICULTIES;
module.exports.PROGRESS_MODES = PROGRESS_MODES;
module.exports.VALIDATION_TYPES = VALIDATION_TYPES;
