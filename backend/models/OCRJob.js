const mongoose = require("mongoose");

const OCR_JOB_STATUSES = [
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "CONFIRMED",
];

const ocrJobSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    marketType: {
      type: String,
      enum: ["Forex", "Indian_Market"],
      required: true,
    },
    tradeSubType: {
      type: String,
      enum: ["OPTION", "EQUITY", ""],
      default: "",
    },
    broker: {
      type: String,
      default: "",
      maxlength: 50,
    },
    uploadedImage: {
      imageUrl: { type: String, required: true },
      publicId: { type: String, default: "" },
      originalName: { type: String, default: "" },
      mimeType: { type: String, default: "" },
      bytes: { type: Number, default: 0 },
    },
    imageHash: {
      type: String,
      default: "",
    },
    requestedTradeDate: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: OCR_JOB_STATUSES,
      default: "PENDING",
      index: true,
    },
    queueJobId: {
      type: String,
      default: "",
    },
    queueJobName: {
      type: String,
      default: "processOcrJob",
    },
    attemptsMade: {
      type: Number,
      default: 0,
    },
    processingStartedAt: {
      type: Date,
      default: null,
    },
    processedAt: {
      type: Date,
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    confirmedAt: {
      type: Date,
      default: null,
    },
    confirmedTradeId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    confirmedTradeCollection: {
      type: String,
      enum: ["forex", "indian", ""],
      default: "",
    },
    error: {
      type: String,
      default: null,
    },
    extractedData: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    extractionConfidence: {
      type: Number,
      default: 0,
    },
    legacyDraftFailureRetryCount: {
      type: Number,
      default: 0,
    },
    queueRecoveryAttempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
  },
  { timestamps: true }
);

ocrJobSchema.index({ user: 1, createdAt: -1 });
ocrJobSchema.index({ user: 1, status: 1, createdAt: -1 });
ocrJobSchema.index({ user: 1, imageHash: 1 });

module.exports = {
  OCR_JOB_STATUSES,
  OCRJob: mongoose.model("OCRJob", ocrJobSchema),
};
