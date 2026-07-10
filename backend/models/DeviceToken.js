const mongoose = require("mongoose");

const DeviceTokenSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    token: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    platform: {
      type: String,
      enum: ["android", "ios", "web"],
      default: "android",
    },
    deviceId: {
      type: String,
      default: "",
      trim: true,
    },
    appVersion: {
      type: String,
      default: "",
      trim: true,
    },
    enabled: {
      type: Boolean,
      default: true,
      index: true,
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
    failureCount: {
      type: Number,
      default: 0,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

DeviceTokenSchema.index({ user: 1, enabled: 1 });
DeviceTokenSchema.index({ lastSeenAt: -1 });
// Covers the "disable stale sibling tokens for the same user+platform" query
// in deviceTokenController.registerDeviceToken — runs on every FCM register.
DeviceTokenSchema.index({ user: 1, platform: 1, enabled: 1, lastSeenAt: 1 });
DeviceTokenSchema.index({ user: 1, platform: 1, deviceId: 1, enabled: 1 });
// Covers notificationService.sendPushToUser DeviceToken lookup
DeviceTokenSchema.index({ user: 1, enabled: 1, revokedAt: 1 });
// M11: Auto-expire device tokens not seen in 90 days
DeviceTokenSchema.index({ lastSeenAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports = mongoose.model("DeviceToken", DeviceTokenSchema);
