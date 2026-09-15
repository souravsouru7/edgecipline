"use strict";

const mongoose = require("mongoose");

// Per-user coupon usage counter. `usedCount` covers both capacity held by an
// open checkout and completed redemptions, so `maxPerUser` can be enforced
// with a single conditional upsert instead of a count-then-insert that two
// parallel orders could both pass. Decremented when a hold is released or a
// payment is fully refunded. Purged with the account: it is a derived counter,
// the retained ledger is CouponRedemption.
const couponUserUsageSchema = new mongoose.Schema(
  {
    coupon: { type: mongoose.Schema.Types.ObjectId, ref: "Coupon", required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    usedCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

couponUserUsageSchema.index({ coupon: 1, user: 1 }, { unique: true });

module.exports = mongoose.model("CouponUserUsage", couponUserUsageSchema);
