const crypto = require("crypto");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const { appConfig } = require("../config");
const {
  activateRazorpaySubscriptionPayment,
  createRazorpayOrder,
  fetchAndValidateRazorpayPayment,
  getPlanConfig,
  getRazorpayClient,
  verifyRazorpayOrderSignature,
} = require("../services/paymentService");

// Sandbox mode is active whenever RAZORPAY_KEY_ID is not set.
// Removes the real Razorpay dependency so the full payment flow can be
// demoed without keys — activates a real subscription in the database.
const isSandboxMode = () => !String(appConfig.razorpay.keyId || "").trim();

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
    ]);
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
  if (isSandboxMode()) {
    const plan = getPlanConfig("3_months");
    return res.json({
      id: `sandbox_order_${crypto.randomBytes(8).toString("hex")}`,
      amount: plan.amount * 100,
      currency: "INR",
      planType: plan.planType,
      sandbox: true,
    });
  }

  const { planType = "3_months" } = req.body;
  const order = await createRazorpayOrder({
    userId: req.user._id,
    planType,
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
    } = req.body;

    const plan = getPlanConfig("3_months");
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
          amount: plan.amount,
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
      amount: plan.amount,
      userPlan: plan.userPlan,
      incrementTotalPaid: !idempotent,
    });

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

  const result = await activateRazorpaySubscriptionPayment({
    ...verifiedPayment,
    razorpaySignature: razorpay_signature,
    source: "manual_verify",
  });

  res.json({
    success: true,
    message: result.message,
    idempotent: result.idempotent,
  });
});
