const mongoose = require("mongoose");

// One row per (user, Idempotency-Key) for deduplicated write requests.
//
// The row is created BEFORE the handler runs, so the unique index is what
// actually serialises two concurrent submissions of the same key — the second
// insert collides rather than running the handler a second time. The stored
// response is then replayed, so a client that never saw the first answer
// (timeout, dropped connection, app backgrounded) gets the same one instead of
// creating a duplicate.
//
// `requestHash` makes the guarantee honest: reusing a key with a different body
// is a client bug, and answering it with the first body would silently discard
// the second request. It is rejected instead.
const IdempotencyRecordSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    key: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    method: { type: String, default: "" },
    path: { type: String, default: "" },
    requestHash: { type: String, default: "" },
    status: {
      type: String,
      enum: ["in_progress", "completed"],
      default: "in_progress",
      required: true,
    },
    responseStatus: { type: Number, default: null },
    // The serialised success envelope, replayed verbatim on a repeat.
    responseBody: { type: mongoose.Schema.Types.Mixed, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// The serialisation point for concurrent duplicates, and the lookup for a
// replay. Scoped per user so one account can never probe another's keys.
IdempotencyRecordSchema.index({ user: 1, key: 1 }, { unique: true });

// 24h is comfortably longer than any client-side retry window while keeping the
// collection small. After it, the key is free again — by then the user is
// re-submitting deliberately, not retrying.
IdempotencyRecordSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: Number(process.env.IDEMPOTENCY_TTL_SECONDS || 24 * 60 * 60) }
);

module.exports =
  mongoose.models.IdempotencyRecord ||
  mongoose.model("IdempotencyRecord", IdempotencyRecordSchema);
