"use strict";

const mongoose = require("mongoose");
const {
  COUPON_STATUSES,
  DISCOUNT_TYPES,
  ORDERABLE_PLAN_TYPES,
} = require("../constants/promotions");

const couponSchema = new mongoose.Schema(
  {
    codeNormalized: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      maxlength: 32,
    },
    codeDisplay: { type: String, required: true, trim: true, maxlength: 32 },
    campaign: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      required: true,
      index: true,
    },
    discountType: {
      type: String,
      enum: DISCOUNT_TYPES,
      required: true,
    },
    discountValue: {
      type: Number,
      required: true,
      min: 0,
    },
    startsAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    status: {
      type: String,
      enum: COUPON_STATUSES,
      default: "active",
      index: true,
    },
    maxRedemptions: { type: Number, default: null, min: 1 },
    maxPerUser: { type: Number, default: 1, min: 1 },
    minAmount: { type: Number, default: 0, min: 0 },
    applicablePlanTypes: {
      type: [String],
      enum: ORDERABLE_PLAN_TYPES,
      default: [],
    },
    firstTimePayerOnly: { type: Boolean, default: false },
    excludeActiveSubscribers: { type: Boolean, default: false },
    newPurchaseOnly: { type: Boolean, default: false },
    redemptionCount: { type: Number, default: 0, min: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

couponSchema.index({ campaign: 1, status: 1 });
couponSchema.index({ status: 1, expiresAt: 1 });

module.exports = mongoose.model("Coupon", couponSchema);
