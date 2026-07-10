const mongoose = require("mongoose");

// Subscription Rescue Funnel dispatch log.
//
// One row per (user, cycleExpiry, touchpoint). The unique compound index is
// the source of truth for idempotency — the cron's insert-or-skip pattern
// relies on the duplicate-key error to safely no-op when a touchpoint has
// already been delivered for a given subscription cycle.
//
// `cycleExpiry` is frozen at dispatch time. When the user renews,
// User.subscriptionExpiry shifts forward and the next cron run sees a new
// cycle — old dispatches don't match any current window, so no resends, and
// new touchpoints flow cleanly for the new cycle.
const rescueDispatchSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // The subscription expiry timestamp that anchored this cycle. For
    // pre-expiry touchpoints this is the upcoming expiry; for post-expiry
    // it's the most recent expired timestamp. Identifies a "subscription
    // cycle" without needing a join.
    cycleExpiry: {
      type: Date,
      required: true,
    },
    // Touchpoint code from TOUCHPOINTS table: "d_minus_7", "d_plus_3", etc.
    touchpoint: {
      type: String,
      required: true,
    },
    phase: {
      type: String,
      enum: ["pre_expiry", "expiry", "win_back"],
      required: true,
    },
    // Which channels actually got sent — for analytics + retry visibility.
    channels: {
      banner: { type: Boolean, default: false },  // banner is read-on-demand;
                                                  // this just notes eligibility
      push:   { type: Boolean, default: false },
      email:  { type: Boolean, default: false },
    },
    // Per-channel outcome. "skipped" covers quiet-hours / pref-disabled cases
    // so analytics can distinguish "user opted out" from "delivery failed".
    outcome: {
      push:  { type: String, enum: ["sent", "skipped", "failed", null], default: null },
      email: { type: String, enum: ["sent", "skipped", "failed", null], default: null },
    },
    // Frozen snapshot of the rescue context used for this dispatch — lets us
    // attribute renewals back to the exact copy a user saw without rebuilding
    // context months later when streaks/trades have moved on.
    contextSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    error: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

// Idempotency: one (user, cycle, touchpoint) tuple max.
rescueDispatchSchema.index(
  { user: 1, cycleExpiry: 1, touchpoint: 1 },
  { unique: true }
);
// Funnel reporting — "how many D-3 emails in the last week?"
rescueDispatchSchema.index({ touchpoint: 1, createdAt: -1 });

module.exports = mongoose.model("RescueDispatch", rescueDispatchSchema);
