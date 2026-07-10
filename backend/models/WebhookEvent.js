const mongoose = require("mongoose");

const webhookEventSchema = new mongoose.Schema(
  {
    eventId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    eventType: {
      type: String,
      required: true,
      index: true,
    },
    provider: {
      type: String,
      enum: ["razorpay"],
      default: "razorpay",
      index: true,
    },
    processed: {
      type: Boolean,
      default: false,
      index: true,
    },
    processing: {
      type: Boolean,
      default: false,
    },
    processingStartedAt: {
      type: Date,
    },
    processedAt: {
      type: Date,
    },
    deliveryAttempts: {
      type: Number,
      default: 0,
    },
    processingAttempts: {
      type: Number,
      default: 0,
    },
    processingResult: {
      type: mongoose.Schema.Types.Mixed,
    },
    processingError: {
      type: String,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
  },
  { timestamps: true }
);

webhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });
webhookEventSchema.index({ processed: 1, processing: 1, createdAt: 1 });

module.exports = mongoose.model("WebhookEvent", webhookEventSchema);
