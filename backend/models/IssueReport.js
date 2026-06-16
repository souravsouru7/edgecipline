const mongoose = require("mongoose");

const ISSUE_CATEGORIES = [
  "OCR_EXTRACTION",
  "IMAGE_UPLOAD",
  "TRADE_SAVE",
  "JOURNAL",
  "SETUP",
  "NOTIFICATION",
  "LOGIN",
  "PERFORMANCE",
  "CRASH",
  "OTHER",
];

const ISSUE_STATUSES = ["OPEN", "INVESTIGATING", "FIXED", "CLOSED"];

const MARKET_TYPES = ["Forex", "Indian_Market", "Both", "Unknown"];

const PLATFORMS = ["android", "ios", "web", "unknown"];

const screenshotSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, default: "" },
    bytes: { type: Number, default: 0 },
  },
  { _id: false }
);

const timelineSchema = new mongoose.Schema(
  {
    status: { type: String, enum: ISSUE_STATUSES, required: true },
    at: { type: Date, default: Date.now },
    note: { type: String, default: "", maxlength: 500 },
  },
  { _id: false }
);

const issueReportSchema = new mongoose.Schema(
  {
    issueCode: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    email: { type: String, default: "", lowercase: true, trim: true },

    marketType: { type: String, enum: MARKET_TYPES, default: "Unknown" },
    module: { type: String, default: "", maxlength: 100 },
    issueCategory: { type: String, enum: ISSUE_CATEGORIES, required: true },

    description: {
      type: String,
      required: true,
      trim: true,
      minlength: 5,
      maxlength: 4000,
    },

    screenshots: {
      type: [screenshotSchema],
      default: [],
      validate: {
        validator(arr) {
          return arr.length <= 8;
        },
        message: "screenshots cannot exceed 8 items",
      },
    },

    tradeId: { type: mongoose.Schema.Types.ObjectId, default: null },

    ocrDataSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    appVersion: { type: String, default: "", maxlength: 30 },
    platform: { type: String, enum: PLATFORMS, default: "unknown" },
    deviceInfo: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    status: {
      type: String,
      enum: ISSUE_STATUSES,
      default: "OPEN",
      index: true,
    },
    fixSummary: { type: String, default: "", maxlength: 2000 },
    fixedVersion: { type: String, default: "", maxlength: 30 },
    fixedAt: { type: Date, default: null },

    fixNotificationSent: { type: Boolean, default: false },

    timeline: { type: [timelineSchema], default: [] },
  },
  { timestamps: true }
);

issueReportSchema.index({ user: 1, createdAt: -1 });
issueReportSchema.index({ status: 1, createdAt: -1 });
issueReportSchema.index({ issueCategory: 1, createdAt: -1 });
issueReportSchema.index({ marketType: 1, createdAt: -1 });

issueReportSchema.statics.ISSUE_CATEGORIES = ISSUE_CATEGORIES;
issueReportSchema.statics.ISSUE_STATUSES = ISSUE_STATUSES;
issueReportSchema.statics.MARKET_TYPES = MARKET_TYPES;
issueReportSchema.statics.PLATFORMS = PLATFORMS;

module.exports = mongoose.model("IssueReport", issueReportSchema);
module.exports.ISSUE_CATEGORIES = ISSUE_CATEGORIES;
module.exports.ISSUE_STATUSES = ISSUE_STATUSES;
module.exports.MARKET_TYPES = MARKET_TYPES;
module.exports.PLATFORMS = PLATFORMS;
