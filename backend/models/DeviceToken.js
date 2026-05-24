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

module.exports = mongoose.model("DeviceToken", DeviceTokenSchema);
