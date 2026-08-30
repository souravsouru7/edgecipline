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
      // Google Play RTDNs reuse this collection wholesale: the {provider,
      // eventId} unique index is the replay guard, and the reconciliation and
      // retention crons are already provider-blind. Nothing here is
      // Razorpay-specific except the default.
      enum: ["razorpay", "google_play"],
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
    // Set once reconciliation has burned through MAX_PROCESSING_ATTEMPTS.
    // Stops the retry loop and marks the event for human attention. These
    // documents are deliberately exempt from retention pruning — they are the
    // record of money that may have been taken without being fulfilled.
    permanentlyFailed: {
      type: Boolean,
      default: false,
    },
    permanentlyFailedAt: {
      type: Date,
    },
    // Set when a processed event's payload has been pruned by the retention
    // job. The document itself is kept forever so eventId idempotency can
    // never regress — only the bulky, PII-bearing payload is dropped.
    payloadPrunedAt: {
      type: Date,
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
// Reconciliation sweep: unprocessed, unclaimed, not yet given up on.
webhookEventSchema.index(
  { processed: 1, permanentlyFailed: 1, createdAt: 1 },
  { partialFilterExpression: { processed: false } }
);
// Retention sweep: processed events whose payload is still present.
webhookEventSchema.index(
  { processedAt: 1 },
  { partialFilterExpression: { processed: true } }
);

module.exports = mongoose.model("WebhookEvent", webhookEventSchema);
