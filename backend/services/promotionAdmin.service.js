"use strict";

const mongoose = require("mongoose");
const ApiError = require("../utils/ApiError");
const Campaign = require("../models/Campaign");
const Coupon = require("../models/Coupon");
const Influencer = require("../models/Influencer");
const CouponRedemption = require("../models/CouponRedemption");
const AttributionTouch = require("../models/AttributionTouch");
const {
  CAMPAIGN_TYPES,
  CAMPAIGN_STATUSES,
  COUPON_STATUSES,
  DISCOUNT_TYPES,
  ORDERABLE_PLAN_TYPES,
  INFLUENCER_STATUSES,
  normalizeCouponCode,
  normalizeSlug,
} = require("../constants/promotions");

function objectIdOrNull(value) {
  if (!value) return null;
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw new ApiError(400, "Invalid identifier", "VALIDATION_ERROR");
  }
  return value;
}

function dateFilter(from, to) {
  const createdAt = {};
  if (from) createdAt.$gte = new Date(from);
  if (to) createdAt.$lte = new Date(to);
  return Object.keys(createdAt).length ? { createdAt } : {};
}

async function createInfluencer(body, adminId) {
  const slug = normalizeSlug(body.slug || body.name);
  if (!slug) throw new ApiError(400, "Influencer slug is required", "VALIDATION_ERROR");
  try {
    return await Influencer.create({
      name: String(body.name || "").trim(),
      slug,
      status: INFLUENCER_STATUSES.includes(body.status) ? body.status : "active",
      notes: body.notes || "",
      createdBy: adminId,
    });
  } catch (error) {
    if (error?.code === 11000) throw new ApiError(409, "Influencer slug already exists", "DUPLICATE_RESOURCE");
    throw error;
  }
}

async function updateInfluencer(id, body) {
  const influencer = await Influencer.findById(id);
  if (!influencer) throw new ApiError(404, "Influencer not found", "NOT_FOUND");
  if (body.name != null) influencer.name = String(body.name).trim();
  if (body.slug != null) influencer.slug = normalizeSlug(body.slug);
  if (INFLUENCER_STATUSES.includes(body.status)) influencer.status = body.status;
  if (body.notes != null) influencer.notes = body.notes;
  await influencer.save();
  return influencer;
}

async function createCampaign(body, adminId) {
  const slug = normalizeSlug(body.slug || body.name);
  if (!slug) throw new ApiError(400, "Campaign slug is required", "VALIDATION_ERROR");
  if (!CAMPAIGN_TYPES.includes(body.type)) {
    throw new ApiError(400, "Invalid campaign type", "VALIDATION_ERROR");
  }
  try {
    return await Campaign.create({
      name: String(body.name || "").trim(),
      slug,
      type: body.type,
      status: CAMPAIGN_STATUSES.includes(body.status) ? body.status : "draft",
      startsAt: body.startsAt || null,
      endsAt: body.endsAt || null,
      influencer: objectIdOrNull(body.influencerId),
      notes: body.notes || "",
      createdBy: adminId,
    });
  } catch (error) {
    if (error?.code === 11000) throw new ApiError(409, "Campaign slug already exists", "DUPLICATE_RESOURCE");
    throw error;
  }
}

async function updateCampaign(id, body) {
  const campaign = await Campaign.findById(id);
  if (!campaign) throw new ApiError(404, "Campaign not found", "NOT_FOUND");
  if (body.name != null) campaign.name = String(body.name).trim();
  if (body.slug != null) campaign.slug = normalizeSlug(body.slug);
  if (CAMPAIGN_TYPES.includes(body.type)) campaign.type = body.type;
  if (CAMPAIGN_STATUSES.includes(body.status)) campaign.status = body.status;
  if (body.startsAt !== undefined) campaign.startsAt = body.startsAt || null;
  if (body.endsAt !== undefined) campaign.endsAt = body.endsAt || null;
  if (body.influencerId !== undefined) campaign.influencer = objectIdOrNull(body.influencerId);
  if (body.notes != null) campaign.notes = body.notes;
  await campaign.save();
  return campaign;
}

function assertCouponRules(body) {
  if (!DISCOUNT_TYPES.includes(body.discountType)) {
    throw new ApiError(400, "Invalid discount type", "VALIDATION_ERROR");
  }
  const value = Number(body.discountValue);
  if (!Number.isFinite(value) || value <= 0) {
    throw new ApiError(400, "Discount value must be a positive number", "VALIDATION_ERROR");
  }
  if (body.discountType === "percent" && (value > 99 || value < 1)) {
    throw new ApiError(400, "Percent discount must be between 1 and 99", "VALIDATION_ERROR");
  }
  const plans = Array.isArray(body.applicablePlanTypes) ? body.applicablePlanTypes : [];
  if (plans.some((p) => !ORDERABLE_PLAN_TYPES.includes(p))) {
    throw new ApiError(400, "Invalid applicable plan", "VALIDATION_ERROR");
  }
}

async function createCoupon(body, adminId) {
  const codeNormalized = normalizeCouponCode(body.code);
  if (!codeNormalized) throw new ApiError(400, "Coupon code is required", "VALIDATION_ERROR");
  assertCouponRules(body);
  const campaign = await Campaign.findById(body.campaignId);
  if (!campaign) throw new ApiError(404, "Campaign not found", "NOT_FOUND");
  try {
    return await Coupon.create({
      codeNormalized,
      codeDisplay: String(body.code).trim(),
      campaign: campaign._id,
      discountType: body.discountType,
      discountValue: Number(body.discountValue),
      startsAt: body.startsAt || null,
      expiresAt: body.expiresAt || null,
      status: COUPON_STATUSES.includes(body.status) ? body.status : "active",
      maxRedemptions: body.maxRedemptions || null,
      maxPerUser: body.maxPerUser || 1,
      minAmount: body.minAmount || 0,
      applicablePlanTypes: body.applicablePlanTypes || [],
      firstTimePayerOnly: Boolean(body.firstTimePayerOnly),
      excludeActiveSubscribers: Boolean(body.excludeActiveSubscribers),
      newPurchaseOnly: Boolean(body.newPurchaseOnly),
      createdBy: adminId,
    });
  } catch (error) {
    if (error?.code === 11000) throw new ApiError(409, "Coupon code already exists", "DUPLICATE_RESOURCE");
    throw error;
  }
}

async function updateCoupon(id, body) {
  const coupon = await Coupon.findById(id);
  if (!coupon) throw new ApiError(404, "Coupon not found", "NOT_FOUND");
  if (coupon.redemptionCount > 0 && body.code) {
    const next = normalizeCouponCode(body.code);
    if (next && next !== coupon.codeNormalized) {
      throw new ApiError(409, "Cannot rename a coupon that has already been redeemed", "COUPON_LOCKED");
    }
  }
  if (body.code) {
    coupon.codeNormalized = normalizeCouponCode(body.code);
    coupon.codeDisplay = String(body.code).trim();
  }
  if (body.discountType || body.discountValue != null) {
    assertCouponRules({
      discountType: body.discountType || coupon.discountType,
      discountValue: body.discountValue != null ? body.discountValue : coupon.discountValue,
      applicablePlanTypes: body.applicablePlanTypes,
    });
  }
  if (DISCOUNT_TYPES.includes(body.discountType)) coupon.discountType = body.discountType;
  if (body.discountValue != null) coupon.discountValue = Number(body.discountValue);
  if (body.startsAt !== undefined) coupon.startsAt = body.startsAt || null;
  if (body.expiresAt !== undefined) coupon.expiresAt = body.expiresAt || null;
  if (COUPON_STATUSES.includes(body.status)) coupon.status = body.status;
  if (body.maxRedemptions !== undefined) coupon.maxRedemptions = body.maxRedemptions || null;
  if (body.maxPerUser != null) coupon.maxPerUser = body.maxPerUser;
  if (body.minAmount != null) coupon.minAmount = body.minAmount;
  if (body.applicablePlanTypes) coupon.applicablePlanTypes = body.applicablePlanTypes;
  if (body.firstTimePayerOnly != null) coupon.firstTimePayerOnly = Boolean(body.firstTimePayerOnly);
  if (body.excludeActiveSubscribers != null) {
    coupon.excludeActiveSubscribers = Boolean(body.excludeActiveSubscribers);
  }
  if (body.newPurchaseOnly != null) coupon.newPurchaseOnly = Boolean(body.newPurchaseOnly);
  if (body.campaignId) {
    const campaign = await Campaign.findById(body.campaignId);
    if (!campaign) throw new ApiError(404, "Campaign not found", "NOT_FOUND");
    coupon.campaign = campaign._id;
  }
  await coupon.save();
  return coupon;
}

function redemptionMatch(query) {
  const match = { status: "applied", ...dateFilter(query.from, query.to) };
  if (query.campaignId) match.campaign = objectIdOrNull(query.campaignId);
  if (query.influencerId) match.influencer = objectIdOrNull(query.influencerId);
  if (query.couponId) match.coupon = objectIdOrNull(query.couponId);
  if (query.planType && ORDERABLE_PLAN_TYPES.includes(query.planType)) match.planType = query.planType;
  return match;
}

async function overview(query = {}) {
  const match = redemptionMatch(query);
  const [campaigns, activeCampaigns, redemptionAgg, touches] = await Promise.all([
    Campaign.countDocuments(),
    Campaign.countDocuments({ status: "active" }),
    CouponRedemption.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          redemptions: { $sum: 1 },
          paidUsers: { $addToSet: "$user" },
          revenue: { $sum: "$chargedAmount" },
          discount: { $sum: "$discountAmount" },
        },
      },
    ]),
    AttributionTouch.countDocuments({
      source: "ref",
      ...dateFilter(query.from, query.to),
    }),
  ]);

  const stats = redemptionAgg[0] || { redemptions: 0, paidUsers: [], revenue: 0, discount: 0 };
  const paidUsers = Array.isArray(stats.paidUsers) ? stats.paidUsers.length : 0;
  return {
    totalCampaigns: campaigns,
    activeCampaigns,
    totalCouponUsage: stats.redemptions,
    referralTouches: touches,
    paidConversions: paidUsers,
    revenue: stats.revenue,
    discountAmount: stats.discount,
    conversionRate: touches > 0 ? paidUsers / touches : null,
  };
}

async function campaignMetrics(campaignId, query = {}) {
  const campaign = await Campaign.findById(campaignId).populate("influencer", "name slug").lean();
  if (!campaign) throw new ApiError(404, "Campaign not found", "NOT_FOUND");
  const match = { ...redemptionMatch(query), campaign: campaign._id };
  const [agg, coupons, touches] = await Promise.all([
    CouponRedemption.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          usage: { $sum: 1 },
          paidUsers: { $addToSet: "$user" },
          revenue: { $sum: "$chargedAmount" },
          discount: { $sum: "$discountAmount" },
        },
      },
    ]),
    Coupon.find({ campaign: campaign._id }).select("codeDisplay codeNormalized status redemptionCount").lean(),
    AttributionTouch.countDocuments({
      campaign: campaign._id,
      ...dateFilter(query.from, query.to),
    }),
  ]);
  const stats = agg[0] || { usage: 0, paidUsers: [], revenue: 0, discount: 0 };
  const paid = stats.paidUsers?.length || 0;
  return {
    campaign,
    coupons,
    usersAcquired: touches,
    couponUsage: stats.usage,
    paidUsers: paid,
    conversionRate: touches > 0 ? paid / touches : null,
    revenue: stats.revenue,
    discountAmount: stats.discount,
  };
}

async function influencerMetrics(influencerId, query = {}) {
  const influencer = await Influencer.findById(influencerId).lean();
  if (!influencer) throw new ApiError(404, "Influencer not found", "NOT_FOUND");
  const touchMatch = { influencer: influencer._id, ...dateFilter(query.from, query.to) };
  const [touches, signups, redemptions] = await Promise.all([
    AttributionTouch.countDocuments(touchMatch),
    AttributionTouch.distinct("user", { ...touchMatch, user: { $ne: null } }),
    CouponRedemption.aggregate([
      { $match: { ...redemptionMatch(query), influencer: influencer._id } },
      {
        $group: {
          _id: null,
          couponUsers: { $addToSet: "$user" },
          paid: { $sum: 1 },
          revenue: { $sum: "$chargedAmount" },
        },
      },
    ]),
  ]);
  const stats = redemptions[0] || { couponUsers: [], paid: 0, revenue: 0 };
  const signupCount = signups.length;
  const paidUsers = stats.couponUsers?.length || 0;
  return {
    influencer,
    referralUsers: touches,
    signups: signupCount,
    couponUsers: paidUsers,
    paidUsers,
    conversionRate: signupCount > 0 ? paidUsers / signupCount : null,
    revenue: stats.revenue,
  };
}

async function listRedemptions(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 50));
  const match = redemptionMatch(query);
  if (query.status === "reversed") match.status = "reversed";
  const [items, total] = await Promise.all([
    CouponRedemption.find(match)
      .populate("user", "name email")
      .populate("coupon", "codeDisplay")
      .populate("campaign", "name type")
      .populate("influencer", "name slug")
      .populate("payment", "status planType amount")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    CouponRedemption.countDocuments(match),
  ]);
  return { redemptions: items, total, page, limit };
}

async function listCampaigns() {
  return Campaign.find().populate("influencer", "name slug").sort({ createdAt: -1 }).lean();
}

async function listCoupons(query = {}) {
  const filter = {};
  if (query.campaignId) filter.campaign = objectIdOrNull(query.campaignId);
  return Coupon.find(filter).populate("campaign", "name type status").sort({ createdAt: -1 }).lean();
}

async function listInfluencers() {
  return Influencer.find().sort({ name: 1 }).lean();
}

module.exports = {
  createInfluencer,
  updateInfluencer,
  listInfluencers,
  createCampaign,
  updateCampaign,
  listCampaigns,
  createCoupon,
  updateCoupon,
  listCoupons,
  overview,
  campaignMetrics,
  influencerMetrics,
  listRedemptions,
};
