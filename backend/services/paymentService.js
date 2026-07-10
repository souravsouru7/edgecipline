const Razorpay = require("razorpay");
const crypto = require("crypto");
const mongoose = require("mongoose");
const Payment = require("../models/Payment");
const User = require("../models/Users");
const Notification = require("../models/Notification");
const { appConfig } = require("../config");
const ApiError = require("../utils/ApiError");
const { logger } = require("../utils/logger");
const { invalidateAuthCache } = require("./authCacheService");
const { captureOperationalError } = require("../config/sentry");
const analytics = require("./analyticsEventService");
const { isTrialActive } = require("../utils/premium");

const PLAN_CONFIG = {
  "3_months": {
    amount: 150,
    days: 90,
    userPlan: "monthly",
    orderable: true,
  },
  monthly: {
    days: 30,
    userPlan: "monthly",
  },
  yearly: {
    days: 365,
    userPlan: "yearly",
  },
};

function getRazorpayClient() {
  const keyId = String(appConfig.razorpay.keyId || "").trim();
  const keySecret = String(appConfig.razorpay.keySecret || "").trim();

  if (!keyId || !keySecret) {
    throw new ApiError(503, "Razorpay is not configured. Manual admin payments can still be used.", "RAZORPAY_CONFIG_MISSING");
  }

  return new Razorpay({
    key_id: keyId,
    key_secret: keySecret,
  });
}

function getPlanConfig(planType, options = {}) {
  const normalizedPlanType = String(planType || "3_months").trim();
  const configured = PLAN_CONFIG[normalizedPlanType];
  if (configured) {
    return {
      planType: normalizedPlanType,
      ...configured,
    };
  }

  if (normalizedPlanType === "custom") {
    const customDays = Number(options.customDays || options.days || 30);
    if (!Number.isFinite(customDays) || customDays <= 0) {
      return null;
    }
    return {
      planType: "custom",
      amount: options.amount,
      days: Math.ceil(customDays),
      userPlan: "custom",
    };
  }

  return null;
}

function getOrderablePlanConfig(planType) {
  const config = getPlanConfig(planType);
  if (!config?.orderable || !Number.isFinite(config.amount) || config.amount <= 0) {
    return null;
  }
  return config;
}

function verifyRazorpayOrderSignature({ orderId, paymentId, signature }) {
  const expectedSignature = crypto
    .createHmac("sha256", appConfig.razorpay.keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, "hex"),
      Buffer.from(String(signature || ""), "hex")
    );
  } catch (error) {
    // Length mismatch (truncated / non-hex signature) trips timingSafeEqual
    // before any comparison. Log the failure mode so operators can tell a
    // malformed signature apart from a wrong secret. Never log the signature.
    logger.warn("[Razorpay] order signature verify error", {
      code: error?.code || error?.name,
    });
    return false;
  }
}

function paymentIntegrityError(message, details) {
  return new ApiError(400, message, "PAYMENT_INTEGRITY_CHECK_FAILED", details);
}

function requireMatchingValue(actual, expected, field) {
  if (String(actual ?? "") !== String(expected ?? "")) {
    throw paymentIntegrityError(`Razorpay ${field} does not match the expected value`, {
      field,
      expected,
      actual,
    });
  }
}

async function fetchAndValidateRazorpayPayment({ orderId, paymentId, expectedUserId } = {}) {
  if (!orderId || !paymentId) {
    throw new ApiError(400, "Razorpay order ID and payment ID are required", "VALIDATION_ERROR");
  }

  const razorpay = getRazorpayClient();
  let order;
  let payment;
  try {
    [order, payment] = await Promise.all([
      razorpay.orders.fetch(orderId),
      razorpay.payments.fetch(paymentId),
    ]);
  } catch (error) {
    captureOperationalError(error, {
      subsystem: "razorpay",
      tags: { operation: "verify_payment_entities" },
      userId: expectedUserId,
      extra: { orderId, paymentId },
    });
    throw new ApiError(502, "Unable to verify payment with Razorpay", "RAZORPAY_VERIFICATION_FAILED");
  }

  if (!order || !payment) {
    throw new ApiError(502, "Razorpay returned an incomplete payment response", "RAZORPAY_VERIFICATION_FAILED");
  }

  requireMatchingValue(order.id, orderId, "order ID");
  requireMatchingValue(payment.id, paymentId, "payment ID");
  requireMatchingValue(payment.order_id, order.id, "payment order ID");

  if (order.status !== "paid") {
    throw paymentIntegrityError("Razorpay order is not paid", { status: order.status });
  }
  if (payment.status !== "captured" || payment.captured !== true) {
    throw paymentIntegrityError("Razorpay payment is not captured", {
      status: payment.status,
      captured: payment.captured,
    });
  }

  const notes = order.notes && typeof order.notes === "object" ? order.notes : {};
  const planType = notes.planType || notes.plan_type;
  const userId = notes.userId || notes.user_id;
  const plan = getOrderablePlanConfig(planType);
  if (!plan || !userId) {
    throw paymentIntegrityError("Razorpay order is missing trusted plan or user metadata");
  }
  if (expectedUserId) {
    requireMatchingValue(userId, expectedUserId, "order user ID");
  }

  const expectedAmount = plan.amount * 100;
  if (!Number.isSafeInteger(order.amount) || order.amount !== expectedAmount) {
    throw paymentIntegrityError("Razorpay order amount does not match the plan price", {
      expectedAmount,
      actualAmount: order.amount,
    });
  }
  if (!Number.isSafeInteger(payment.amount) || payment.amount !== expectedAmount) {
    throw paymentIntegrityError("Razorpay payment amount does not match the plan price", {
      expectedAmount,
      actualAmount: payment.amount,
    });
  }
  requireMatchingValue(order.currency, "INR", "order currency");
  requireMatchingValue(payment.currency, "INR", "payment currency");

  return {
    userId,
    amount: plan.amount,
    currency: "INR",
    razorpayOrderId: order.id,
    razorpayPaymentId: payment.id,
    planType: plan.planType,
    subscriptionDays: plan.days,
  };
}

async function createRazorpayOrder({ userId, planType = "3_months" }) {
  const plan = getOrderablePlanConfig(planType);
  if (!plan) {
    throw new ApiError(400, "Invalid plan type", "VALIDATION_ERROR");
  }

  const razorpay = getRazorpayClient();
  let order;
  try {
    order = await razorpay.orders.create({
      amount: plan.amount * 100,
      currency: "INR",
      receipt: `rcpt_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`,
      notes: {
        planType: plan.planType,
        userId: String(userId),
      },
    });
  } catch (error) {
    captureOperationalError(error, {
      subsystem: "razorpay",
      tags: { operation: "create_order", plan_type: plan.planType },
      userId,
    });
    throw error;
  }

  if (!order) {
    throw new ApiError(500, "Failed to create payment order", "PAYMENT_ORDER_FAILED");
  }

  return { ...order, planType: plan.planType };
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

async function notifyPaymentReceived({ user, userId, paymentId, amount, planType }) {
  Notification.create([
    {
      title: "New Payment Received",
      message: `User ${user?.name || userId} paid Rs ${amount} for a ${String(planType).replace("_", " ")} plan.`,
      type: "payment",
      userId,
      metadata: { paymentId, amount },
    },
  ]).catch((error) => {
    // Fire-and-forget but observable. A silent swallow hid validation /
    // transient Mongo failures from operators after a successful payment.
    logger.warn("[Payment] notifyPaymentReceived failed", {
      paymentId: String(paymentId),
      userId: String(userId),
      error: error?.message,
    });
  });
}

async function ensureExistingPaymentApplied(existingPayment, session) {
  if (!existingPayment?.user || existingPayment.status !== "completed" || !existingPayment.expiryDate) {
    return;
  }

  if (new Date(existingPayment.expiryDate) <= new Date()) {
    return;
  }

  await User.updateOne(
    { _id: existingPayment.user },
    [
      {
        $set: {
          subscriptionStatus: "active",
          subscriptionExpiry: {
            $max: [{ $ifNull: ["$subscriptionExpiry", "$$NOW"] }, existingPayment.expiryDate],
          },
        },
      },
    ],
    { session }
  );
}

async function activateRazorpaySubscriptionPayment({
  userId,
  currency = "INR",
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature,
  planType = "3_months",
  customDays,
  source = "manual_verify",
}) {
  // Amount is intentionally NOT a parameter — `plan.amount` from the server-side
  // plan config is the sole source of truth. Callers must validate the order /
  // payment amount against Razorpay BEFORE invoking this function (see
  // fetchAndValidateRazorpayPayment).
  const plan = getPlanConfig(planType, { customDays });
  if (!plan?.orderable) {
    throw new ApiError(400, "Invalid plan type", "VALIDATION_ERROR");
  }

  const paymentAmount = plan.amount;

  if (!Number.isFinite(Number(paymentAmount)) || Number(paymentAmount) <= 0) {
    throw new ApiError(400, "Missing payment amount", "VALIDATION_ERROR");
  }
  if (currency !== "INR") {
    throw paymentIntegrityError("Payment currency does not match the server plan", {
      currency,
    });
  }

  if (!razorpayPaymentId) {
    throw new ApiError(400, "Missing Razorpay payment ID", "VALIDATION_ERROR");
  }

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const existingPayment = await Payment.findOne({
      $or: [
        { transactionId: razorpayPaymentId },
        { razorpayPaymentId },
        ...(razorpayOrderId ? [{ razorpayOrderId }] : []),
      ],
    })
      .select("_id user status expiryDate razorpayOrderId razorpayPaymentId")
      .session(session)
      .lean();

    if (existingPayment) {
      await ensureExistingPaymentApplied(existingPayment, session);
      await session.commitTransaction();
      logger.info("[PaymentActivation] payment already processed", {
        paymentId: razorpayPaymentId,
        orderId: razorpayOrderId,
        source,
      });
      if (existingPayment.user) invalidateAuthCache(existingPayment.user).catch(() => {});
      return {
        success: true,
        idempotent: true,
        paymentId: existingPayment._id,
        message: "Payment already verified",
      };
    }

    const userInTxn = await User.findById(userId).session(session);
    if (!userInTxn) {
      throw new ApiError(404, "User not found", "NOT_FOUND");
    }

    const now = new Date();
    // Stack the paid window on top of whichever benefit ends latest: an
    // existing paid subscription, a still-running trial, or "now" (no overlap).
    // Without honoring trial.endsAt, a user paying on day-4 of a 7-day trial
    // would silently lose 3 days they were already entitled to.
    const benefitCandidates = [now.getTime()];
    if (
      userInTxn.subscriptionStatus === "active" &&
      userInTxn.subscriptionExpiry &&
      new Date(userInTxn.subscriptionExpiry) > now
    ) {
      benefitCandidates.push(new Date(userInTxn.subscriptionExpiry).getTime());
    }
    if (userInTxn.trial?.endsAt && new Date(userInTxn.trial.endsAt) > now) {
      benefitCandidates.push(new Date(userInTxn.trial.endsAt).getTime());
    }
    const baseExpiry = new Date(Math.max(...benefitCandidates));
    const expiryDate = addDays(baseExpiry, plan.days);

    const [payment] = await Payment.create(
      [
        {
          user: userId,
          amount: paymentAmount,
          currency,
          status: "completed",
          paymentMethod: "razorpay",
          transactionId: razorpayPaymentId,
          razorpayOrderId,
          razorpayPaymentId,
          razorpaySignature,
          planType: plan.planType,
          expiryDate,
          subscriptionDays: plan.days,
          notes: `Automated subscription via Razorpay (${source})`,
        },
      ],
      { session }
    );

    await User.findByIdAndUpdate(
      userId,
      {
        subscriptionStatus: "active",
        subscriptionPlan: plan.userPlan,
        subscriptionExpiry: expiryDate,
        $inc: { totalPaid: paymentAmount },
      },
      { session }
    );

    await session.commitTransaction();

    invalidateAuthCache(userId).catch(() => {});
    notifyPaymentReceived({
      user: userInTxn,
      userId,
      paymentId: razorpayPaymentId,
      amount: paymentAmount,
      planType: plan.planType,
    });

    // Conversion telemetry — distinguish "converted from active trial" from
    // "subscribed after trial expired" from "subscribed without ever
    // trialing" (legacy users). This is the headline funnel metric.
    const trialWasActive = isTrialActive(userInTxn);
    const trialWasUsed = Boolean(userInTxn.trial?.used);
    analytics.track("subscription_started", {
      userId,
      properties: {
        planType: plan.planType,
        amount: paymentAmount,
        days: plan.days,
        source,
        fromTrial: trialWasActive,
        afterExpiredTrial: !trialWasActive && trialWasUsed,
        neverTrialed: !trialWasUsed,
      },
    });
    if (trialWasActive) {
      analytics.track("subscription_started_from_trial", {
        userId,
        properties: {
          trialEndedAt: userInTxn.trial?.endsAt,
          daysIntoTrial: userInTxn.trial?.startedAt
            ? Math.floor((Date.now() - new Date(userInTxn.trial.startedAt).getTime()) / (24 * 60 * 60 * 1000))
            : null,
        },
      });
    }

    logger.info("[PaymentActivation] subscription activated", {
      userId: String(userId),
      paymentId: razorpayPaymentId,
      orderId: razorpayOrderId,
      planType: plan.planType,
      expiryDate: expiryDate.toISOString(),
      source,
    });

    return {
      success: true,
      idempotent: false,
      paymentId: payment._id,
      expiryDate,
      message: "Payment verified and subscription extended successfully",
    };
  } catch (error) {
    await session.abortTransaction();
    if (error?.code === 11000) {
      logger.info("[PaymentActivation] duplicate payment key", {
        paymentId: razorpayPaymentId,
        orderId: razorpayOrderId,
        source,
      });
      return {
        success: true,
        idempotent: true,
        message: "Payment already verified",
      };
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

async function applyVerifiedRazorpayRefund({
  razorpayPaymentId,
  refundKey,
  totalRefundedAmount,
  fullyRefunded,
}) {
  if (!razorpayPaymentId || !refundKey || !Number.isFinite(totalRefundedAmount) || totalRefundedAmount <= 0) {
    throw new ApiError(400, "Invalid verified refund data", "RAZORPAY_REFUND_INVALID");
  }

  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const payment = await Payment.findOne({ razorpayPaymentId }).session(session);
    if (!payment) {
      throw new ApiError(404, "Original payment record not found", "PAYMENT_NOT_FOUND");
    }

    if (payment.razorpayRefundIds?.includes(refundKey)) {
      await session.commitTransaction();
      return { success: true, idempotent: true, paymentId: payment._id };
    }
    if (totalRefundedAmount > payment.amount) {
      throw paymentIntegrityError("Refunded amount exceeds the recorded payment amount");
    }

    const previousRefundedAmount = Number(payment.refundedAmount || 0);
    const refundDelta = Math.max(0, totalRefundedAmount - previousRefundedAmount);
    const becameFullyRefunded = fullyRefunded && payment.status !== "refunded";

    payment.razorpayRefundIds = [...(payment.razorpayRefundIds || []), refundKey];
    payment.refundedAmount = totalRefundedAmount;
    payment.refundedAt = new Date();
    payment.status = fullyRefunded ? "refunded" : "partially_refunded";
    await payment.save({ session });

    const updateStages = [
      {
        $set: {
          totalPaid: {
            $max: [0, { $subtract: [{ $ifNull: ["$totalPaid", 0] }, refundDelta] }],
          },
        },
      },
    ];

    const subscriptionDays = payment.subscriptionDays || getPlanConfig(payment.planType)?.days || 0;
    if (becameFullyRefunded && subscriptionDays > 0) {
      const durationMs = subscriptionDays * 24 * 60 * 60 * 1000;
      updateStages.push({
        $set: {
          subscriptionExpiry: {
            $subtract: [{ $ifNull: ["$subscriptionExpiry", "$$NOW"] }, durationMs],
          },
        },
      });
      updateStages.push({
        $set: {
          subscriptionStatus: {
            $cond: [{ $gt: ["$subscriptionExpiry", "$$NOW"] }, "active", "inactive"],
          },
        },
      });
    }

    await User.updateOne({ _id: payment.user }, updateStages, { session });
    await session.commitTransaction();
    invalidateAuthCache(payment.user).catch(() => {});

    logger.info("[PaymentRefund] refund applied", {
      paymentId: razorpayPaymentId,
      refundKey,
      refundDelta,
      fullyRefunded,
    });
    return { success: true, idempotent: false, paymentId: payment._id, fullyRefunded };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
}

module.exports = {
  PLAN_CONFIG,
  activateRazorpaySubscriptionPayment,
  applyVerifiedRazorpayRefund,
  createRazorpayOrder,
  fetchAndValidateRazorpayPayment,
  getPlanConfig,
  getOrderablePlanConfig,
  getRazorpayClient,
  verifyRazorpayOrderSignature,
};
