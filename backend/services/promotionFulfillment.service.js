"use strict";

const mongoose = require("mongoose");
const Coupon = require("../models/Coupon");
const CouponRedemption = require("../models/CouponRedemption");
const CheckoutSession = require("../models/CheckoutSession");
const { logger } = require("../utils/logger");

function dbReady() {
  return mongoose.connection.readyState === 1;
}

function promoNotes(notes = {}) {
  const couponId = String(notes.couponId || "").trim();
  const campaignId = String(notes.campaignId || "").trim();
  const influencerId = String(notes.influencerId || "").trim();
  const listAmount = Number(notes.listAmount);
  const discountAmount = Number(notes.discountAmount);
  return {
    couponId: couponId || null,
    campaignId: campaignId || null,
    influencerId: influencerId || null,
    listAmount: Number.isFinite(listAmount) && listAmount > 0 ? listAmount : null,
    discountAmount: Number.isFinite(discountAmount) && discountAmount >= 0 ? discountAmount : 0,
    codeUsed: String(notes.codeUsed || "").trim().toUpperCase() || null,
  };
}

async function persistCheckoutSession(doc) {
  if (!dbReady()) return null;
  try {
    await CheckoutSession.updateMany(
      { user: doc.user, status: "open" },
      { $set: { status: "superseded" } }
    );
    return await CheckoutSession.create(doc);
  } catch (error) {
    logger.warn("[CheckoutSession] persist failed", { error: error?.message });
    return null;
  }
}

async function markCheckoutPaid(razorpayOrderId, session) {
  if (!dbReady()) return;
  try {
    await CheckoutSession.updateOne(
      { razorpayOrderId, status: { $in: ["open", "superseded"] } },
      { $set: { status: "paid" } },
      { session }
    );
  } catch (error) {
    logger.warn("[CheckoutSession] mark paid failed", { error: error?.message });
  }
}

async function recordRedemption({ payment, promo, userId, planType, session }) {
  if (!promo?.couponId || !dbReady()) return;

  try {
    const opts = session ? { session } : {};
    await CouponRedemption.create(
      [
        {
          user: userId,
          coupon: promo.couponId,
          campaign: promo.campaignId,
          influencer: promo.influencerId,
          payment: payment._id,
          planType,
          listAmount: promo.listAmount || payment.amount,
          discountAmount: promo.discountAmount || 0,
          chargedAmount: payment.amount,
          currency: payment.currency || "INR",
          codeUsed: promo.codeUsed || "UNKNOWN",
          rulesSnapshot: {},
          status: "applied",
        },
      ],
      opts
    );
  } catch (error) {
    if (error?.code === 11000) return;
    throw error;
  }

  try {
    await Coupon.updateOne(
      { _id: promo.couponId },
      { $inc: { redemptionCount: 1 } },
      { session }
    );
  } catch (error) {
    logger.warn("[Coupon] redemptionCount increment failed", {
      couponId: String(promo.couponId),
      error: error?.message,
    });
  }
}

async function reverseRedemptionForPayment(payment, session) {
  if (!payment?._id || !dbReady()) return;
  try {
    const redemption = await CouponRedemption.findOneAndUpdate(
      { payment: payment._id, status: "applied" },
      { $set: { status: "reversed" } },
      { session, new: true }
    );
    if (!redemption) return;
    await Coupon.updateOne(
      { _id: redemption.coupon, redemptionCount: { $gt: 0 } },
      { $inc: { redemptionCount: -1 } },
      { session }
    );
  } catch (error) {
    logger.warn("[Coupon] redemption reverse failed", {
      paymentId: String(payment._id),
      error: error?.message,
    });
  }
}

module.exports = {
  promoNotes,
  persistCheckoutSession,
  markCheckoutPaid,
  recordRedemption,
  reverseRedemptionForPayment,
};
