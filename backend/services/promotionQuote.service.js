"use strict";

const mongoose = require("mongoose");
const ApiError = require("../utils/ApiError");
const Coupon = require("../models/Coupon");
const Campaign = require("../models/Campaign");
const Influencer = require("../models/Influencer");
const Payment = require("../models/Payment");
const CouponRedemption = require("../models/CouponRedemption");
const {
  PUBLIC_COUPON_ERROR,
  MIN_PAYABLE_RUPEES,
  normalizeCouponCode,
  roundRupees,
} = require("../constants/promotions");

function asLean(query) {
  if (query && typeof query.lean === "function") return query.lean();
  return query;
}

function couponInvalid() {
  return new ApiError(400, PUBLIC_COUPON_ERROR, "COUPON_INVALID");
}

function inWindow(startsAt, endsAt, now) {
  if (startsAt && now < new Date(startsAt)) return false;
  if (endsAt && now > new Date(endsAt)) return false;
  return true;
}

function snapshotCoupon(coupon, campaign, influencer) {
  return {
    _id: coupon._id,
    codeNormalized: coupon.codeNormalized,
    codeDisplay: coupon.codeDisplay,
    discountType: coupon.discountType,
    discountValue: coupon.discountValue,
    maxRedemptions: coupon.maxRedemptions,
    maxPerUser: coupon.maxPerUser,
    campaignId: campaign?._id || coupon.campaign,
    influencerId: influencer?._id || campaign?.influencer || null,
    campaignType: campaign?.type || null,
  };
}

function computeDiscount(listAmount, coupon) {
  if (coupon.discountType === "percent") {
    if (!(coupon.discountValue > 0) || coupon.discountValue > 99) return null;
    return roundRupees((listAmount * coupon.discountValue) / 100);
  }
  if (coupon.discountType === "fixed") {
    if (!(coupon.discountValue > 0)) return null;
    return Math.min(roundRupees(coupon.discountValue), Math.max(0, listAmount - MIN_PAYABLE_RUPEES));
  }
  return null;
}

async function isFirstTimePayer(user) {
  if (Number(user?.totalPaid) > 0) return false;
  if (mongoose.connection.readyState !== 1) return Number(user?.totalPaid || 0) === 0;
  try {
    const paid = await Payment.countDocuments({
      user: user._id,
      status: { $in: ["completed", "partially_refunded"] },
    });
    return paid === 0;
  } catch {
    return Number(user?.totalPaid || 0) === 0;
  }
}

async function userRedemptionCount(couponId, userId) {
  if (mongoose.connection.readyState !== 1) return 0;
  try {
    return await CouponRedemption.countDocuments({
      coupon: couponId,
      user: userId,
      status: "applied",
    });
  } catch {
    return 0;
  }
}

/**
 * Server-side quote. Client may send only planType + couponCode.
 * Throws COUPON_INVALID with a generic public message — never distinguish
 * expired vs unknown vs exhausted to the caller.
 */
async function quoteCheckout({ user, plan, couponCode, now = new Date() }) {
  if (!plan?.orderable || !Number.isFinite(plan.amount) || plan.amount <= 0) {
    throw new ApiError(400, "Invalid plan type", "VALIDATION_ERROR");
  }

  const listAmount = plan.amount;
  const code = normalizeCouponCode(couponCode);
  if (!code) {
    return {
      planType: plan.planType,
      listAmount,
      discountAmount: 0,
      payableAmount: listAmount,
      payablePaise: Math.round(listAmount * 100),
      coupon: null,
      campaignId: null,
      influencerId: null,
      rulesSnapshot: {},
    };
  }

  const coupon = await asLean(Coupon.findOne({ codeNormalized: code }));
  if (!coupon || coupon.status !== "active") throw couponInvalid();

  if (!inWindow(coupon.startsAt, coupon.expiresAt, now)) throw couponInvalid();

  const campaign = await asLean(Campaign.findById(coupon.campaign));
  if (!campaign || campaign.status !== "active") throw couponInvalid();
  if (!inWindow(campaign.startsAt, campaign.endsAt, now)) throw couponInvalid();

  let influencer = null;
  if (campaign.influencer) {
    influencer = await asLean(Influencer.findById(campaign.influencer));
    if (!influencer || influencer.status !== "active") throw couponInvalid();
  }

  const plans = Array.isArray(coupon.applicablePlanTypes) ? coupon.applicablePlanTypes : [];
  if (plans.length > 0 && !plans.includes(plan.planType)) throw couponInvalid();

  if (Number(coupon.minAmount) > 0 && listAmount < coupon.minAmount) throw couponInvalid();

  if (coupon.firstTimePayerOnly && !(await isFirstTimePayer(user))) throw couponInvalid();

  if (coupon.excludeActiveSubscribers && user?.subscriptionStatus === "active") {
    throw couponInvalid();
  }

  if (coupon.newPurchaseOnly && user?.subscriptionStatus === "active") {
    throw couponInvalid();
  }

  if (coupon.maxRedemptions && Number(coupon.redemptionCount) >= coupon.maxRedemptions) {
    throw couponInvalid();
  }

  if (user?._id && coupon.maxPerUser) {
    const used = await userRedemptionCount(coupon._id, user._id);
    if (used >= coupon.maxPerUser) throw couponInvalid();
  }

  const discountAmount = computeDiscount(listAmount, coupon);
  if (!Number.isFinite(discountAmount) || discountAmount <= 0) throw couponInvalid();

  const payableAmount = listAmount - discountAmount;
  if (!Number.isInteger(payableAmount) || payableAmount < MIN_PAYABLE_RUPEES) {
    throw couponInvalid();
  }

  return {
    planType: plan.planType,
    listAmount,
    discountAmount,
    payableAmount,
    payablePaise: Math.round(payableAmount * 100),
    coupon: snapshotCoupon(coupon, campaign, influencer),
    campaignId: campaign._id,
    influencerId: influencer?._id || null,
    rulesSnapshot: snapshotCoupon(coupon, campaign, influencer),
    codeUsed: coupon.codeNormalized,
  };
}

function publicQuote(quote) {
  return {
    planType: quote.planType,
    listAmount: quote.listAmount,
    discountAmount: quote.discountAmount,
    payableAmount: quote.payableAmount,
    code: quote.coupon?.codeDisplay || quote.codeUsed || null,
  };
}

module.exports = {
  quoteCheckout,
  publicQuote,
  couponInvalid,
};
