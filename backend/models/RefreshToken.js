const mongoose = require("mongoose");

const refreshTokenSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // SHA-256 hash of the raw opaque token — never store raw tokens in DB
    tokenHash: {
      type: String,
      required: true,
      unique: true,
    },
    // Rotation family: all tokens in a chain share one family ID.
    // When a revoked token in a family is replayed, the ENTIRE family is revoked.
    family: {
      type: String,
      required: true,
      index: true,
    },
    deviceInfo: {
      userAgent: { type: String, default: "" },
      ip: { type: String, default: "" },
      deviceId: { type: String, default: "", maxlength: 100 },
      sessionId: { type: String, default: "", maxlength: 100 },
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    // Set when this token is rotated out. null = still valid.
    revokedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// MongoDB TTL index: auto-deletes documents 24 hours after expiry
// (grace period lets the replay-detection logic still catch attacks near expiry)
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86400 });

// Fast lookup for active-session queries per user
refreshTokenSchema.index({ userId: 1, revokedAt: 1, expiresAt: 1 });

module.exports = mongoose.model("RefreshToken", refreshTokenSchema);
