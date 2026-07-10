const mongoose = require("mongoose");

const extractionLogSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    imageUrl: {
      type: String,
      required: true
    },
    marketType: {
      type: String,
      required: true
    },
    broker: { type: String, default: "", maxlength: 50 },
    extractionConfidence: { type: Number, default: 0, min: 0, max: 100 },
    needsReview: { type: Boolean, default: true },
    extractedText: {
      type: String
    },
    parsedData: {
      type: mongoose.Schema.Types.Mixed
    },
    isSuccess: {
      type: Boolean,
      default: false
    },
    aiUsed: {
      type: Boolean,
      default: false
    },
    errorMessage: {
      type: String
    }
  },
  { timestamps: true }
);

extractionLogSchema.index({ user: 1, createdAt: -1 });
extractionLogSchema.index({ isSuccess: 1, createdAt: -1 });
extractionLogSchema.index({ broker: 1, marketType: 1, createdAt: -1 });
// One row per OCR attempt — this collection grows unbounded without TTL.
// 90 days is enough for retroactive debugging and audit; older rows roll off.
extractionLogSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 }
);

module.exports = mongoose.model("ExtractionLog", extractionLogSchema);
