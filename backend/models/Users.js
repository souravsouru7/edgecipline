const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: false,
      select: false
    },
    authProvider: {
      type: String,
      enum: ["local", "google"],
      default: "local"
    },
    googleId: {
      type: String
    },
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user"
    },
    avatar: {
      type: String
    },
    resetPasswordOTP: {
      type: String
    },
    resetPasswordOTPExpires: {
      type: Date
    },
    otpAttempts: {
      type: Number,
      default: 0,
    },
    otpLockUntil: {
      type: Date,
    },
    subscriptionStatus: {
      type: String,
      enum: ["inactive", "active", "expired"],
      default: "inactive"
    },
    subscriptionPlan: {
      type: String,
      enum: ["free", "monthly", "yearly"],
      default: "free"
    },
    subscriptionExpiry: {
      type: Date
    },
    totalPaid: {
      type: Number,
      default: 0
    },
    lastLogin: {
      type: Date
    },
    freeUploadUsed: {
      type: Boolean,
      default: false
    },
    hasSeenWelcomeGuide: {
      type: Boolean,
      default: false
    },
    isOnboardingCompleted: {
      type: Boolean,
      default: false
    },
    termsAcceptance: {
      acceptedTerms: { type: Boolean, default: false },
      acceptedPrivacy: { type: Boolean, default: false },
      acceptedAt: { type: Date, default: null },
      termsVersion: { type: String, default: null }
    },
    tokenVersion: {
      type: Number,
      default: 0,
    },
    loginAttempts: {
      type: Number,
      default: 0,
      select: false,
    },
    loginLockedUntil: {
      type: Date,
      select: false,
    },
  },
  { timestamps: true }
);

userSchema.index({ role: 1, subscriptionExpiry: -1 });
userSchema.index({ role: 1, subscriptionStatus: 1, subscriptionExpiry: -1 });
// M16: Supports expiry-notification cron and subscription-gate queries
userSchema.index({ subscriptionStatus: 1, subscriptionExpiry: -1 });
userSchema.index(
  { googleId: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: {
      googleId: { $type: "string" },
    },
  }
);

module.exports = mongoose.model("User", userSchema);
