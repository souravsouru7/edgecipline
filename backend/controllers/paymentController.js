const crypto = require("crypto");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const { logger } = require("../utils/logger");
const { appConfig } = require("../config");
const {
  activateRazorpaySubscriptionPayment,
  createRazorpayOrder,
  fetchAndValidateRazorpayPayment,
  getPlanConfig,
  getOrderablePlanConfig,
  getRazorpayClient,
  verifyRazorpayOrderSignature,
} = require("../services/paymentService");

// Sandbox mode removes the real Razorpay dependency so the full payment flow
// can be demoed without keys — but it activates a REAL subscription in the
// REAL database from a fabricated payment ID, so any authenticated user who
// can reach it can grant themselves premium.
//
// Missing credentials are therefore NOT sufficient to enter sandbox mode, and
// are never treated as a successful payment. Sandbox requires BOTH:
//   1. no configured RAZORPAY_KEY_ID, and
//   2. ALLOW_SANDBOX_PAYMENTS=true on a non-production NODE_ENV
//      (the environment half is enforced in config/index.js, so production
//       cannot opt in even by setting the flag).
//
// Any other combination fails closed with 503. Previously this keyed on
// NODE_ENV alone, which meant a staging box that forgot NODE_ENV=production
// silently became a free-premium faucet against a real database.
const isSandboxMode = () => {
  const keyMissing = !String(appConfig.razorpay.keyId || "").trim();
  if (!keyMissing) return false;
  if (appConfig.razorpay.allowSandboxPayments) return true;
  throw new ApiError(503, "Razorpay is not configured", "RAZORPAY_CONFIG_MISSING");
};

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getSafeSandboxId(value, prefix) {
  const raw = String(value || "").trim();
  if (raw.startsWith(prefix) && raw.length <= 120) return raw;
  return `${prefix}${crypto.randomBytes(8).toString("hex")}`;
}

function getSandboxBaseExpiry(user, now) {
  const candidates = [now.getTime()];
  if (
    user?.subscriptionStatus === "active" &&
    user.subscriptionExpiry &&
    new Date(user.subscriptionExpiry) > now
  ) {
    candidates.push(new Date(user.subscriptionExpiry).getTime());
  }
  if (user?.trial?.endsAt && new Date(user.trial.endsAt) > now) {
    candidates.push(new Date(user.trial.endsAt).getTime());
  }
  return new Date(Math.max(...candidates));
}

async function applySandboxSubscription({ userId, expiryDate, amount, userPlan, incrementTotalPaid }) {
  const User = require("../models/Users");
  if (!incrementTotalPaid) {
    await User.findByIdAndUpdate(userId, [
      {
        $set: {
          subscriptionStatus: "active",
          subscriptionPlan: userPlan,
          subscriptionExpiry: {
            $max: [{ $ifNull: ["$subscriptionExpiry", "$$NOW"] }, expiryDate],
          },
        },
      },
    ], { updatePipeline: true });
    return;
  }

  const update = {
    $set: {
      subscriptionStatus: "active",
      subscriptionPlan: userPlan,
      subscriptionExpiry: expiryDate,
    },
  };

  if (incrementTotalPaid) {
    update.$inc = { totalPaid: amount };
  }

  await User.findByIdAndUpdate(userId, update);
}

exports.createOrder = asyncHandler(async (req, res) => {
  const { planType = "3_months", couponCode } = req.body;

  if (isSandboxMode()) {
    const plan = getOrderablePlanConfig(planType);
    if (!plan) {
      throw new ApiError(400, "Unknown or unpurchasable plan", "INVALID_PLAN_TYPE");
    }
    const { quoteCheckout, publicQuote } = require("../services/promotionQuote.service");
    const {
      persistCheckoutSession,
    } = require("../services/promotionFulfillment.service");
    const { CHECKOUT_SESSION_TTL_MS } = require("../constants/promotions");

    const quote = await quoteCheckout({
      user: req.user,
      plan,
      couponCode,
    });
    const orderId = `sandbox_order_${crypto.randomBytes(8).toString("hex")}`;
    await persistCheckoutSession({
      user: req.user._id,
      razorpayOrderId: orderId,
      planType: plan.planType,
      listAmount: quote.listAmount,
      discountAmount: quote.discountAmount,
      payableAmount: quote.payableAmount,
      coupon: quote.coupon?._id || null,
      campaign: quote.campaignId || null,
      influencer: quote.influencerId || null,
      codeUsed: quote.codeUsed || "",
      rulesSnapshot: quote.rulesSnapshot || {},
      status: "open",
      expiresAt: new Date(Date.now() + CHECKOUT_SESSION_TTL_MS),
    });
    return res.json({
      id: orderId,
      amount: quote.payablePaise,
      currency: "INR",
      planType: plan.planType,
      sandbox: true,
      quote: publicQuote(quote),
    });
  }

  const order = await createRazorpayOrder({
    userId: req.user._id,
    planType,
    couponCode,
  });
  res.json(order);
});

exports.verifyPayment = asyncHandler(async (req, res) => {
  if (isSandboxMode()) {
    // Bypass transactions — standalone MongoDB doesn't support them.
    // Directly update user + create payment record without a session.
    const User = require("../models/Users");
    const Payment = require("../models/Payment");
    const { invalidateAuthCache } = require("../services/authCacheService");

    const {
      razorpay_order_id,
      razorpay_payment_id,
      planType: requestedPlanType,
    } = req.body;

    // Sandbox orders aren't persisted, so the tier has to come back from the
    // client here. Without it every sandbox purchase grants 90 days no matter
    // which plan was picked. Still validated against PLAN_CONFIG, and this
    // path is already dev-gated.
    const plan = getOrderablePlanConfig(requestedPlanType || "3_months");
    if (!plan?.orderable) {
      throw new ApiError(500, "Sandbox payment plan is not configured", "PAYMENT_PLAN_CONFIG_INVALID");
    }

    const sandboxPaymentId = getSafeSandboxId(razorpay_payment_id, "sandbox_pay_");
    const sandboxOrderId = getSafeSandboxId(razorpay_order_id, "sandbox_order_");
    const now = new Date();
    const user = await User.findById(req.user._id);
    if (!user) {
      throw new ApiError(404, "User not found", "NOT_FOUND");
    }

    let chargedAmount = plan.amount;
    let listAmount = plan.amount;
    let discountAmount = 0;
    const promo = {};
    const mongoose = require("mongoose");
    if (mongoose.connection.readyState === 1) {
      const CheckoutSession = require("../models/CheckoutSession");
      const checkout = await CheckoutSession.findOne({
        razorpayOrderId: sandboxOrderId,
        user: user._id,
      }).lean();
      if (checkout) {
        chargedAmount = checkout.payableAmount;
        listAmount = checkout.listAmount;
        discountAmount = checkout.discountAmount;
        promo.couponId = checkout.coupon || null;
        promo.campaignId = checkout.campaign || null;
        promo.influencerId = checkout.influencer || null;
        promo.listAmount = listAmount;
        promo.discountAmount = discountAmount;
        promo.codeUsed = checkout.codeUsed || null;
      }
    }

    let payment = await Payment.findOne({
      $or: [
        { transactionId: sandboxPaymentId },
        { razorpayPaymentId: sandboxPaymentId },
        { razorpayOrderId: sandboxOrderId },
      ],
    });
    let idempotent = Boolean(payment);
    let expiryDate = payment?.expiryDate || addDays(getSandboxBaseExpiry(user, now), plan.days);

    if (payment && payment.status !== "completed") {
      throw new ApiError(409, "Sandbox payment was not completed", "PAYMENT_STATUS_TRANSITION_INVALID");
    }

    try {
      if (!payment) {
        payment = await Payment.create({
          user: user._id,
          amount: chargedAmount,
          currency: "INR",
          status: "completed",
          paymentMethod: "razorpay",
          transactionId: sandboxPaymentId,
          razorpayOrderId: sandboxOrderId,
          razorpayPaymentId: sandboxPaymentId,
          razorpaySignature: "sandbox_signature",
          planType: plan.planType,
          expiryDate,
          subscriptionDays: plan.days,
          listAmount,
          discountAmount,
          coupon: promo.couponId || null,
          campaign: promo.campaignId || null,
          influencer: promo.influencerId || null,
          notes: "Sandbox demo payment - no real charge",
        });
      }
    } catch (err) {
      // Duplicate key -> already activated by a parallel request.
      if (err?.code !== 11000) throw err;
      payment = await Payment.findOne({
        $or: [
          { transactionId: sandboxPaymentId },
          { razorpayPaymentId: sandboxPaymentId },
          { razorpayOrderId: sandboxOrderId },
        ],
      });
      idempotent = true;
      expiryDate = payment?.expiryDate || expiryDate;
    }

    await applySandboxSubscription({
      userId: user._id,
      expiryDate,
      amount: chargedAmount,
      userPlan: plan.userPlan,
      incrementTotalPaid: !idempotent,
    });

    if (!idempotent) {
      try {
        const { recordRedemption, markCheckoutPaid } = require("../services/promotionFulfillment.service");
        await markCheckoutPaid(sandboxOrderId);
        await recordRedemption({
          payment,
          promo,
          userId: user._id,
          planType: plan.planType,
        });
      } catch {
        /* non-fatal in sandbox / unit tests */
      }
    }

    invalidateAuthCache(user._id).catch(() => {});

    return res.json({
      success: true,
      message: idempotent
        ? "Sandbox: subscription already activated"
        : "Sandbox: subscription activated for 90 days",
      sandbox: true,
      idempotent,
      expiryDate,
    });
  }

  getRazorpayClient();

  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    planType = "3_months",
  } = req.body;

  const signaturesMatch = verifyRazorpayOrderSignature({
    orderId: razorpay_order_id,
    paymentId: razorpay_payment_id,
    signature: razorpay_signature,
  });

  if (!signaturesMatch) {
    throw new ApiError(400, "Invalid payment signature", "PAYMENT_SIGNATURE_INVALID");
  }

  const verifiedPayment = await fetchAndValidateRazorpayPayment({
    orderId: razorpay_order_id,
    paymentId: razorpay_payment_id,
    expectedUserId: req.user._id,
  });

  if (planType && planType !== verifiedPayment.planType) {
    throw new ApiError(400, "Payment plan does not match the Razorpay order", "PAYMENT_INTEGRITY_CHECK_FAILED");
  }

  // Past this point Razorpay has ALREADY captured the money. If activation
  // then fails, letting a bare 500 reach the browser renders "Something went
  // wrong" over a completed payment — which invites the user to pay a second
  // time. The webhook and the reconciliation cron settle this asynchronously,
  // so report it as received-and-pending and page an operator instead.
  let result;
  try {
    result = await activateRazorpaySubscriptionPayment({
      ...verifiedPayment,
      razorpaySignature: razorpay_signature,
      source: "manual_verify",
    });
  } catch (error) {
    logger.error("PAYMENT_ACTIVATION_FAILED_AFTER_CAPTURE", {
      userId: String(req.user._id),
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
      amount: verifiedPayment.amount,
      planType: verifiedPayment.planType,
      error: error?.message,
    });
    res.status(202).json({
      success: true,
      pending: true,
      message:
        "Payment received. We're still activating your plan — this usually takes under a minute. "
        + "Please don't pay again; contact support if it hasn't appeared shortly.",
    });
    return;
  }

  res.json({
    success: true,
    message: result.message,
    idempotent: result.idempotent,
    // Drives the "Active until ..." line in the premium celebration.
    expiryDate: result.expiryDate || null,
    planType: verifiedPayment.planType,
  });
});
