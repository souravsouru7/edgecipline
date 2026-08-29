"use strict";

const mongoose = require("mongoose");
const { INFLUENCER_STATUSES } = require("../constants/promotions");

const influencerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 64,
    },
    status: {
      type: String,
      enum: INFLUENCER_STATUSES,
      default: "active",
      index: true,
    },
    defaultCoupon: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Coupon",
      default: null,
    },
    notes: { type: String, default: "", maxlength: 2000 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

influencerSchema.index({ status: 1, name: 1 });

module.exports = mongoose.model("Influencer", influencerSchema);
