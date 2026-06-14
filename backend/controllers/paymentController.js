const Razorpay = require("razorpay");
const crypto = require("crypto");
const mongoose = require("mongoose");
const Payment = require("../models/Payment");
const User = require("../models/Users");
const Notification = require("../models/Notification");
const { appConfig } = require("../config");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");
const { invalidateAuthCache } = require("../services/authCacheService");

// Server-side source of truth for plan pricing.
// Amount is NEVER trusted from the client — always derived from this map.
const PLAN_AMOUNTS = { "3_months": 150 };
const PLAN_DAYS   = { "3_months": 90 };

const getRazorpayClient = () => {
  const keyId = String(appConfig.razorpay.keyId || "").trim();
  const keySecret = String(appConfig.razorpay.keySecret || "").trim();

  if (!keyId || !keySecret) {
    throw new ApiError(503, "Razorpay is not configured. Manual admin payments can still be used.", "RAZORPAY_CONFIG_MISSING");
  }

  return new Razorpay({
    key_id: keyId,
    key_secret: keySecret,
  });
};

exports.createOrder = asyncHandler(async (req, res) => {
  const { planType = "3_months" } = req.body;

  const amount = PLAN_AMOUNTS[planType];
  if (!amount) {
    throw new ApiError(400, "Invalid plan type", "VALIDATION_ERROR");
  }

  const razorpay = getRazorpayClient();
  const order = await razorpay.orders.create({
    amount: amount * 100,
    currency: "INR",
    receipt: `rcpt_${Date.now()}`,
    notes: { planType },
  });

  if (!order) {
    throw new ApiError(500, "Failed to create payment order", "PAYMENT_ORDER_FAILED");
  }

  res.json({ ...order, planType });
});

exports.verifyPayment = asyncHandler(async (req, res) => {
  getRazorpayClient();

  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    planType = "3_months",
  } = req.body;

  // Derive amount from server-side map — never accept amount from client
  const amount = PLAN_AMOUNTS[planType];
  if (!amount) {
    throw new ApiError(400, "Invalid plan type", "VALIDATION_ERROR");
  }
  const days = PLAN_DAYS[planType];

  const expectedSignature = crypto
    .createHmac("sha256", appConfig.razorpay.keySecret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  const signaturesMatch = (() => {
    try {
      return crypto.timingSafeEqual(
        Buffer.from(expectedSignature, "hex"),
        Buffer.from(razorpay_signature, "hex")
      );
    } catch {
      return false;
    }
  })();
  if (!signaturesMatch) {
    throw new ApiError(400, "Invalid payment signature", "PAYMENT_SIGNATURE_INVALID");
  }

  const userId = req.user._id;

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    // Duplicate check inside the transaction so the read and write are
    // in the same atomic unit — eliminates the TOCTOU window of checking
    // before the session starts.
    const existingPayment = await Payment.findOne({
      $or: [{ transactionId: razorpay_payment_id }, { razorpayPaymentId: razorpay_payment_id }],
    })
      .select("_id")
      .session(session)
      .lean();

    if (existingPayment) {
      await session.abortTransaction();
      return res.json({
        success: true,
        message: "Payment already verified",
        idempotent: true,
      });
    }

    const userInTxn = await User.findById(userId).session(session);
    if (!userInTxn) {
      throw new ApiError(404, "User not found", "NOT_FOUND");
    }

    let expiryDate = new Date();
    if (
      userInTxn.subscriptionStatus === "active" &&
      userInTxn.subscriptionExpiry &&
      new Date(userInTxn.subscriptionExpiry) > expiryDate
    ) {
      expiryDate = new Date(userInTxn.subscriptionExpiry);
    }
    expiryDate.setDate(expiryDate.getDate() + days);

    await Payment.create(
      [
        {
          user: userId,
          amount,
          currency: "INR",
          status: "completed",
          paymentMethod: "razorpay",
          transactionId: razorpay_payment_id,
          razorpayOrderId: razorpay_order_id,
          razorpayPaymentId: razorpay_payment_id,
          razorpaySignature: razorpay_signature,
          planType,
          expiryDate,
          notes: "Automated subscription via Razorpay",
        },
      ],
      { session }
    );

    await User.findByIdAndUpdate(
      userId,
      {
        subscriptionStatus: "active",
        subscriptionPlan: "monthly",
        subscriptionExpiry: expiryDate,
        $inc: { totalPaid: amount },
      },
      { session }
    );

    await session.commitTransaction();

    // Invalidate AFTER commit — subscriptionStatus / subscriptionExpiry are
    // cached fields read by subscription guards. If invalidation fails the
    // 5-minute TTL caps staleness; payment record is already durable.
    invalidateAuthCache(userId).catch(() => {});

    // Notification created AFTER commit so a notification failure never rolls back a real payment
    Notification.create([
      {
        title: "New Payment Received",
        message: `User ${userInTxn.name} paid Rs ${amount} for a ${planType.replace("_", " ")} plan.`,
        type: "payment",
        userId,
        metadata: { paymentId: razorpay_payment_id, amount },
      },
    ]).catch(() => {}); // Best-effort — don't fail the response if notification fails

    res.json({
      success: true,
      message: "Payment verified and subscription extended successfully",
    });
  } catch (error) {
    await session.abortTransaction();
    if (error?.code === 11000) {
      return res.json({
        success: true,
        message: "Payment already verified",
        idempotent: true,
      });
    }
    throw error;
  } finally {
    await session.endSession();
  }
});
