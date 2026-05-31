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

module.exports = mongoose.model("ExtractionLog", extractionLogSchema);
