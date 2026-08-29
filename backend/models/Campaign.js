"use strict";

const mongoose = require("mongoose");
const { CAMPAIGN_TYPES, CAMPAIGN_STATUSES } = require("../constants/promotions");

const campaignSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 80,
    },
    type: {
      type: String,
      enum: CAMPAIGN_TYPES,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: CAMPAIGN_STATUSES,
      default: "draft",
      index: true,
    },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    influencer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Influencer",
      default: null,
      index: true,
    },
    notes: { type: String, default: "", maxlength: 4000 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

campaignSchema.index({ status: 1, type: 1, createdAt: -1 });

module.exports = mongoose.model("Campaign", campaignSchema);
