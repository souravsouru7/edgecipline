"use strict";

const mongoose = require("mongoose");
const { REDEMPTION_STATUSES, ORDERABLE_PLAN_TYPES } = require("../constants/promotions");

const couponRedemptionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    coupon: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Coupon",
      required: true,
      index: true,
    },
    campaign: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", default: null, index: true },
    influencer: { type: mongoose.Schema.Types.ObjectId, ref: "Influencer", default: null, index: true },
    payment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Payment",
      required: true,
      unique: true,
    },
    checkoutSession: { type: mongoose.Schema.Types.ObjectId, ref: "CheckoutSession", default: null },
    planType: { type: String, enum: ORDERABLE_PLAN_TYPES, required: true },
    listAmount: { type: Number, required: true, min: 0 },
    discountAmount: { type: Number, required: true, min: 0 },
    chargedAmount: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: ["INR", "USD"], default: "INR" },
    codeUsed: { type: String, required: true, uppercase: true, trim: true },
    rulesSnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: REDEMPTION_STATUSES,
      default: "applied",
      index: true,
    },
  },
  { timestamps: true }
);

couponRedemptionSchema.index({ coupon: 1, user: 1, status: 1 });
couponRedemptionSchema.index({ campaign: 1, createdAt: -1 });
couponRedemptionSchema.index({ influencer: 1, createdAt: -1 });

module.exports = mongoose.model("CouponRedemption", couponRedemptionSchema);
