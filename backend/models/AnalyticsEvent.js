const mongoose = require("mongoose");

// Lightweight event log for monetization funnel analytics. Designed to be
// cheap to write and easy to query for cohort funnels (trial → paywall →
// subscribe). Not a replacement for Mixpanel/Amplitude — when a dedicated
// analytics pipeline lands, this collection becomes the dispatch buffer.
//
// Indexed for the two queries that matter day-1:
//   (event, createdAt)        — funnel counts over time
//   (user,  createdAt)        — per-user timeline / debugging
const analyticsEventSchema = new mongoose.Schema(
  {
    event: {
      type: String,
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    properties: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    source: {
      type: String,
      enum: ["server", "client", "cron", "admin"],
      default: "server",
    },
  },
  { timestamps: true }
);

analyticsEventSchema.index({ event: 1, createdAt: -1 });
analyticsEventSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("AnalyticsEvent", analyticsEventSchema);
