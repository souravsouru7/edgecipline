"use strict";

const mongoose = require("mongoose");
const { CHECKOUT_SESSION_STATUSES, ORDERABLE_PLAN_TYPES } = require("../constants/promotions");

const checkoutSessionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    razorpayOrderId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    planType: {
      type: String,
      enum: ORDERABLE_PLAN_TYPES,
      required: true,
    },
    listAmount: { type: Number, required: true, min: 1 },
    discountAmount: { type: Number, required: true, min: 0, default: 0 },
    payableAmount: { type: Number, required: true, min: 1 },
    coupon: { type: mongoose.Schema.Types.ObjectId, ref: "Coupon", default: null },
    campaign: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", default: null },
    influencer: { type: mongoose.Schema.Types.ObjectId, ref: "Influencer", default: null },
    codeUsed: { type: String, default: "", uppercase: true, trim: true },
    rulesSnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: CHECKOUT_SESSION_STATUSES,
      default: "open",
      index: true,
    },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

checkoutSessionSchema.index({ user: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("CheckoutSession", checkoutSessionSchema);
