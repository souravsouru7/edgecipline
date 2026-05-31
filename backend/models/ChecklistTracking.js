const mongoose = require("mongoose");

const checklistTrackingSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    market: {
      type: String,
      enum: ["Forex", "Indian_Market"],
      default: "Forex",
    },
    strategyName: {
      type: String,
      required: true,
    },
    totalRules: {
      type: Number,
      required: true,
    },
    followedRules: {
      type: Number,
      required: true,
    },
    score: {
      type: Number,
      required: true,
    },
    isAPlus: {
      type: Boolean,
      required: true,
    },
    setupSimilarity: {
      type: String,
      enum: ["yes", "partly", "no", ""],
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

checklistTrackingSchema.index({ user: 1, createdAt: -1 });
checklistTrackingSchema.index({ user: 1, market: 1, createdAt: -1 });

module.exports = mongoose.model("ChecklistTracking", checklistTrackingSchema);
