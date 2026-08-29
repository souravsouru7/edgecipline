"use strict";

const mongoose = require("mongoose");

const attributionTouchSchema = new mongoose.Schema(
  {
    anonymousId: { type: String, required: true, index: true, maxlength: 80 },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    source: {
      type: String,
      enum: ["ref", "utm", "coupon_preview", "direct"],
      default: "direct",
    },
    refSlug: { type: String, default: "", lowercase: true, trim: true, maxlength: 64 },
    campaign: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", default: null },
    influencer: { type: mongoose.Schema.Types.ObjectId, ref: "Influencer", default: null },
    utmSource: { type: String, default: "", trim: true, maxlength: 80 },
    utmMedium: { type: String, default: "", trim: true, maxlength: 80 },
    utmCampaign: { type: String, default: "", trim: true, maxlength: 80 },
    landingPath: { type: String, default: "", trim: true, maxlength: 200 },
  },
  { timestamps: true }
);

attributionTouchSchema.index({ anonymousId: 1, createdAt: -1 });
attributionTouchSchema.index({ user: 1, createdAt: -1 });
attributionTouchSchema.index({ influencer: 1, createdAt: -1 });

module.exports = mongoose.model("AttributionTouch", attributionTouchSchema);
