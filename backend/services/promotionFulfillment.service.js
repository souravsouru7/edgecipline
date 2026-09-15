"use strict";

const mongoose = require("mongoose");
const ApiError = require("../utils/ApiError");
const Coupon = require("../models/Coupon");
const CouponRedemption = require("../models/CouponRedemption");
const CouponUserUsage = require("../models/CouponUserUsage");
const CheckoutSession = require("../models/CheckoutSession");
const { PUBLIC_COUPON_ERROR } = require("../constants/promotions");
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

// ── Capacity reservation ────────────────────────────────────────────────────
//
// The limit invariant (redemptions ≤ maxRedemptions, per-user ≤ maxPerUser)
// is enforced HERE, at order creation, with conditional atomic updates — not
// by the read-only quote, which several buyers can pass simultaneously. A
// successful reservation is what allows a discounted Razorpay order to exist.
//
// Every write is a single conditional update, so concurrent callers race on
// the database's own atomicity rather than on application reads.

// `maxRedemptions` unset / null / non-positive means unlimited, mirroring the
// falsy check the quote uses.
const UNLIMITED_GLOBAL = [{ maxRedemptions: null }, { maxRedemptions: { $not: { $gt: 0 } } }];

function globalCapacityFilter(couponId) {
  return {
    _id: couponId,
    status: "active",
    $or: [
      ...UNLIMITED_GLOBAL,
      {
        $expr: {
          $lt: [
            { $add: [{ $ifNull: ["$redemptionCount", 0] }, { $ifNull: ["$reservedCount", 0] }] },
            "$maxRedemptions",
          ],
        },
      },
    ],
  };
}

async function reserveGlobal(couponId, session) {
  const updated = await Coupon.findOneAndUpdate(
    globalCapacityFilter(couponId),
    { $inc: { reservedCount: 1 } },
    { returnDocument: "after", session }
  ).lean();
  return Boolean(updated);
}

async function releaseGlobal(couponId, session) {
  await Coupon.updateOne(
    { _id: couponId, reservedCount: { $gt: 0 } },
    { $inc: { reservedCount: -1 } },
    { session }
  );
}

// Seeds the per-user counter from redemptions recorded before the counter
// existed, so a legacy redemption still counts toward maxPerUser. $setOnInsert
// makes a concurrent seed harmless: only one insert wins, the other sees 11000
// and falls through to the conditional increment below.
async function ensureUserUsageSeeded(couponId, userId, session) {
  const exists = await CouponUserUsage.exists({ coupon: couponId, user: userId }).session(session);
  if (exists) return;
  const legacy = await CouponRedemption.countDocuments({
    coupon: couponId,
    user: userId,
    status: "applied",
  }).session(session);
  if (legacy <= 0) return;
  try {
    await CouponUserUsage.updateOne(
      { coupon: couponId, user: userId },
      { $setOnInsert: { usedCount: legacy } },
      { upsert: true, session }
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }
}

// Conditional upsert: matches only while usedCount < maxPerUser. When the
// document is missing the upsert inserts it at usedCount = 1. When it exists
// but is at the limit, the filter matches nothing and the upsert attempts an
// insert that the unique index rejects (11000) — that duplicate-key error IS
// the "limit reached" signal. One retry covers the first-insert race.
async function reserveForUser(couponId, userId, maxPerUser, session) {
  await ensureUserUsageSeeded(couponId, userId, session);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const doc = await CouponUserUsage.findOneAndUpdate(
        { coupon: couponId, user: userId, usedCount: { $lt: maxPerUser } },
        { $inc: { usedCount: 1 } },
        { upsert: true, returnDocument: "after", session }
      ).lean();
      return Boolean(doc);
    } catch (error) {
      if (error?.code !== 11000) throw error;
      // Document exists now (inserted concurrently or already at limit).
      // Retry once so the conditional filter is evaluated against it.
    }
  }
  return false;
}

async function releaseForUser(couponId, userId, session) {
  await CouponUserUsage.updateOne(
    { coupon: couponId, user: userId, usedCount: { $gt: 0 } },
    { $inc: { usedCount: -1 } },
    { session }
  );
}

/**
 * Hold one unit of coupon capacity for `userId`. Throws COUPON_INVALID when
 * the coupon is exhausted globally or for this user, and a 503 when the
 * database cannot prove availability — a limited promotion must fail closed
 * rather than be oversold.
 *
 * `coupon` needs `_id` and `maxPerUser` (the quote's snapshot is enough).
 */
async function reserveCouponCapacity({ coupon, userId }) {
  if (!coupon?._id || !userId) return false;
  if (!dbReady()) {
    throw new ApiError(503, "Promotions are temporarily unavailable", "COUPON_RESERVATION_UNAVAILABLE");
  }

  const couponId = coupon._id;
  await sweepExpiredReservations(couponId);
  // A new order supersedes the buyer's earlier open checkouts (see
  // persistCheckoutSession), so their holds must go first — otherwise a
  // buyer who reopens checkout is blocked by their own reservation.
  await releaseUserOpenHolds(userId, "superseded");

  let heldGlobal = false;
  try {
    heldGlobal = await reserveGlobal(couponId);
    if (!heldGlobal) {
      logger.info("COUPON_RESERVATION_LIMIT_REACHED", { couponId: String(couponId), userId: String(userId), scope: "global" });
      throw new ApiError(400, PUBLIC_COUPON_ERROR, "COUPON_INVALID");
    }

    const maxPerUser = Number(coupon.maxPerUser);
    if (maxPerUser > 0) {
      const heldUser = await reserveForUser(couponId, userId, maxPerUser);
      if (!heldUser) {
        logger.info("COUPON_RESERVATION_LIMIT_REACHED", { couponId: String(couponId), userId: String(userId), scope: "user" });
        throw new ApiError(400, PUBLIC_COUPON_ERROR, "COUPON_INVALID");
      }
    }
  } catch (error) {
    if (heldGlobal) await releaseGlobal(couponId).catch(() => {});
    if (error instanceof ApiError) throw error;
    logger.error("COUPON_RESERVATION_FAILED", { couponId: String(couponId), userId: String(userId), error: error?.message });
    throw new ApiError(503, "Promotions are temporarily unavailable", "COUPON_RESERVATION_UNAVAILABLE");
  }

  logger.info("COUPON_RESERVATION_SUCCESS", { couponId: String(couponId), userId: String(userId) });
  return true;
}

/**
 * Return capacity that was reserved but never attached to a checkout session
 * (Razorpay order creation failed, session persist failed).
 */
async function releaseCouponCapacity({ coupon, userId, reason = "unattached" }) {
  if (!coupon?._id || !userId || !dbReady()) return;
  try {
    await releaseGlobal(coupon._id);
    if (Number(coupon.maxPerUser) > 0) await releaseForUser(coupon._id, userId);
    logger.info("COUPON_RESERVATION_RELEASED", { couponId: String(coupon._id), userId: String(userId), reason });
  } catch (error) {
    logger.warn("COUPON_RESERVATION_RELEASE_FAILED", { couponId: String(coupon._id), userId: String(userId), reason, error: error?.message });
  }
}

/**
 * Release the hold on one checkout session. The reserved → released flip is
 * conditional, so concurrent supersede / sweep / redeem calls cannot double-
 * release. Returns true when this call performed the release.
 */
async function releaseCheckoutReservation(sessionId, reason, session) {
  const flipped = await CheckoutSession.findOneAndUpdate(
    { _id: sessionId, couponReservation: "reserved" },
    { $set: { couponReservation: "released" } },
    { returnDocument: "after", session }
  ).lean();
  if (!flipped) return false;
  await releaseGlobal(flipped.coupon, session);
  // The hold was taken with maxPerUser > 0 whenever a usage doc exists; the
  // decrement is guarded so a coupon without a per-user cap is a no-op.
  await releaseForUser(flipped.coupon, flipped.user, session);
  logger.info("COUPON_RESERVATION_RELEASED", {
    couponId: String(flipped.coupon),
    userId: String(flipped.user),
    checkoutSessionId: String(flipped._id),
    razorpayOrderId: flipped.razorpayOrderId,
    reason,
  });
  return true;
}

async function releaseUserOpenHolds(userId, reason) {
  const open = await CheckoutSession.find({ user: userId, status: "open", couponReservation: "reserved" })
    .select("_id")
    .lean();
  for (const doc of open) await releaseCheckoutReservation(doc._id, reason);
}

/**
 * Release holds whose checkout window has closed. Called before every capacity
 * check for a coupon, so an abandoned checkout can never block the next buyer,
 * and the sweep cost is bounded to that coupon's expired sessions.
 */
async function sweepExpiredReservations(couponId, now = new Date()) {
  if (!dbReady()) return 0;
  const expired = await CheckoutSession.find({
    coupon: couponId,
    couponReservation: "reserved",
    expiresAt: { $lt: now },
  })
    .select("_id")
    .limit(200)
    .lean();
  let released = 0;
  for (const doc of expired) {
    if (await releaseCheckoutReservation(doc._id, "expired")) released += 1;
  }
  return released;
}

/**
 * Persist the checkout. Any earlier open session for the user is superseded
 * and its coupon hold released — a buyer who reopens checkout must not keep
 * two holds. Returns null when the document could not be written; callers
 * that hold a reservation must treat that as a failure and release.
 */
async function persistCheckoutSession(doc) {
  if (!dbReady()) return null;
  try {
    const open = await CheckoutSession.find({ user: doc.user, status: "open" }).select("_id couponReservation").lean();
    if (open.length) {
      await CheckoutSession.updateMany(
        { _id: { $in: open.map((s) => s._id) } },
        { $set: { status: "superseded" } }
      );
      for (const s of open) {
        if (s.couponReservation === "reserved") {
          await releaseCheckoutReservation(s._id, "superseded");
        }
      }
    }
    return await CheckoutSession.create({
      ...doc,
      couponReservation: doc.couponReservation || (doc.coupon ? "reserved" : "none"),
    });
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

// Convert the checkout's hold into a redemption. Three cases:
//   reserved  → one $inc moves the unit from reservedCount to redemptionCount.
//   released / none / no session → the hold is gone (checkout expired or was
//               superseded, but Razorpay orders stay payable), so re-take
//               capacity conditionally. If none is left, the money is already
//               captured at the discounted amount: record it anyway, keep the
//               counters truthful, and raise the alarm.
async function settleCapacityForRedemption({ couponId, userId, razorpayOrderId, maxPerUser, session }) {
  const claimed = razorpayOrderId
    ? await CheckoutSession.findOneAndUpdate(
        { razorpayOrderId, couponReservation: "reserved" },
        { $set: { couponReservation: "redeemed" } },
        { returnDocument: "after", session }
      ).lean()
    : null;

  if (claimed) {
    const converted = await Coupon.updateOne(
      { _id: couponId, reservedCount: { $gt: 0 } },
      { $inc: { redemptionCount: 1, reservedCount: -1 } },
      { session }
    );
    if (converted.matchedCount === 0) {
      // Hold accounted for on the session but not on the coupon (counter was
      // reset by hand). Keep the redemption count truthful.
      await Coupon.updateOne({ _id: couponId }, { $inc: { redemptionCount: 1 } }, { session });
    }
    return { reserved: true, exceeded: false };
  }

  if (razorpayOrderId) {
    await CheckoutSession.updateOne(
      { razorpayOrderId, couponReservation: { $ne: "redeemed" } },
      { $set: { couponReservation: "redeemed" } },
      { session }
    );
  }

  const took = await Coupon.findOneAndUpdate(
    globalCapacityFilter(couponId),
    { $inc: { redemptionCount: 1 } },
    { returnDocument: "after", session }
  ).lean();
  let exceeded = !took;
  if (!took) {
    await Coupon.updateOne({ _id: couponId }, { $inc: { redemptionCount: 1 } }, { session });
  }

  if (Number(maxPerUser) > 0) {
    if (!(await takeUserCapacityAtFulfillment(couponId, userId, Number(maxPerUser), session))) {
      exceeded = true;
    }
  }
  return { reserved: false, exceeded };
}

// Fulfillment runs inside a transaction in production, where a duplicate-key
// error aborts the whole activation — so this must not lean on 11000 the way
// reserveForUser does. Conditional increment first; only if no document
// exists do we insert one; a document at its limit is incremented anyway
// (the money is captured) and reported as exceeded.
async function takeUserCapacityAtFulfillment(couponId, userId, maxPerUser, session) {
  const conditional = await CouponUserUsage.updateOne(
    { coupon: couponId, user: userId, usedCount: { $lt: maxPerUser } },
    { $inc: { usedCount: 1 } },
    { session }
  );
  if (conditional.matchedCount > 0) return true;

  const existing = await CouponUserUsage.findOne({ coupon: couponId, user: userId }).select("_id").session(session).lean();
  if (!existing) {
    await CouponUserUsage.create([{ coupon: couponId, user: userId, usedCount: 1 }], session ? { session } : {});
    return true;
  }
  await CouponUserUsage.updateOne({ _id: existing._id }, { $inc: { usedCount: 1 } }, { session });
  return false;
}

async function recordRedemption({ payment, promo, userId, planType, session }) {
  if (!promo?.couponId || !dbReady()) return;

  const opts = session ? { session } : {};
  try {
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
    if (error?.code === 11000) {
      logger.info("COUPON_REDEMPTION_DUPLICATE", {
        couponId: String(promo.couponId),
        paymentId: String(payment._id),
      });
      return;
    }
    throw error;
  }

  // maxPerUser is not carried in Razorpay notes; read it from the coupon.
  const coupon = await Coupon.findById(promo.couponId).select("maxPerUser").session(session).lean();
  const outcome = await settleCapacityForRedemption({
    couponId: promo.couponId,
    userId,
    razorpayOrderId: payment.razorpayOrderId,
    maxPerUser: coupon?.maxPerUser,
    session,
  });

  const meta = {
    couponId: String(promo.couponId),
    userId: String(userId),
    paymentId: String(payment._id),
    razorpayOrderId: payment.razorpayOrderId,
    fromReservation: outcome.reserved,
  };
  if (outcome.exceeded) {
    logger.error("COUPON_LIMIT_EXCEEDED_AT_FULFILLMENT", meta);
  } else {
    logger.info("COUPON_REDEMPTION_SUCCESS", meta);
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
    await releaseForUser(redemption.coupon, redemption.user, session);
    logger.info("COUPON_REDEMPTION_REVERSED", {
      couponId: String(redemption.coupon),
      userId: String(redemption.user),
      paymentId: String(payment._id),
    });
  } catch (error) {
    logger.warn("[Coupon] redemption reverse failed", {
      paymentId: String(payment._id),
      error: error?.message,
    });
  }
}

module.exports = {
  promoNotes,
  reserveCouponCapacity,
  releaseCouponCapacity,
  releaseCheckoutReservation,
  sweepExpiredReservations,
  persistCheckoutSession,
  markCheckoutPaid,
  recordRedemption,
  reverseRedemptionForPayment,
};
