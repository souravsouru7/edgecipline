const Payment = require("../../models/Payment");
const User = require("../../models/Users");
const ApiError = require("../../utils/ApiError");
const asyncHandler = require("../../utils/asyncHandler");
const mongoose = require("mongoose");
const { invalidateAuthCache } = require("../../services/authCacheService");
const { getPlanConfig, resolveSubscriptionPlanLabel } = require("../../services/paymentService");
const { logger } = require("../../utils/logger");

const MANUAL_STATUS_TRANSITIONS = {
  pending: new Set(["completed", "failed"]),
  failed: new Set(["completed"]),
  completed: new Set(["refunded"]),
  refunded: new Set(),
  partially_refunded: new Set(),
};

/**
 * @desc    Get all payments for admin
 * @route   GET /api/admin/payments
 * @access  Private/Admin
 */
exports.getAllPayments = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const [payments, total] = await Promise.all([
    Payment.find().populate("user", "name email").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Payment.countDocuments(),
  ]);
  res.json({ payments, total, page, limit });
});

/**
 * @desc    Update payment status (Confirm/Refund)
 * @route   PATCH /api/admin/payments/:id/status
 * @access  Private/Admin
 */
exports.updatePaymentStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!Object.prototype.hasOwnProperty.call(MANUAL_STATUS_TRANSITIONS, status)) {
    throw new ApiError(400, "Invalid payment status", "VALIDATION_ERROR");
  }
  const session = await mongoose.startSession();
  let payment;
  try {
    session.startTransaction();
    payment = await Payment.findById(req.params.id).session(session);

    if (!payment) {
      throw new ApiError(404, "Payment not found", "NOT_FOUND");
    }

    if (payment.paymentMethod === "razorpay") {
      throw new ApiError(
        409,
        "Razorpay payment status is provider-controlled; use verified webhooks or payment verification",
        "PAYMENT_PROVIDER_STATUS_IMMUTABLE"
      );
    }

    const previousStatus = payment.status;
    if (status === previousStatus) {
      await session.commitTransaction();
      return res.json({ message: "Payment status unchanged", payment, idempotent: true });
    }
    if (!MANUAL_STATUS_TRANSITIONS[previousStatus]?.has(status)) {
      throw new ApiError(409, `Invalid payment transition: ${previousStatus} to ${status}`, "PAYMENT_STATUS_TRANSITION_INVALID");
    }

    payment.status = status;

    // Handle side effects on User profile if status changed to completed or refunded
    if (status === "completed" && previousStatus !== "completed") {
      const daysToAdd = payment.subscriptionDays || getPlanConfig(payment.planType)?.days || 0;
      if (daysToAdd > 0) {
        const updatedUser = await User.findByIdAndUpdate(
          payment.user,
          [
            {
              $set: {
                subscriptionExpiry: {
                  $add: [
                    { $max: [{ $ifNull: ["$subscriptionExpiry", "$$NOW"] }, "$$NOW"] },
                    daysToAdd * 24 * 60 * 60 * 1000,
                  ],
                },
                subscriptionStatus: "active",
                totalPaid: { $add: [{ $ifNull: ["$totalPaid", 0] }, payment.amount] },
              },
            },
          ],
          { new: true, select: "subscriptionExpiry", session, updatePipeline: true }
        );
        if (updatedUser) {
          payment.expiryDate = updatedUser.subscriptionExpiry;
        }
      }
    } else if (status === "refunded" && previousStatus === "completed") {
      await User.findByIdAndUpdate(payment.user, [
        {
          $set: {
            totalPaid: { $max: [0, { $subtract: [{ $ifNull: ["$totalPaid", 0] }, payment.amount] }] },
            subscriptionExpiry: {
              $subtract: [
                { $ifNull: ["$subscriptionExpiry", "$$NOW"] },
                (payment.subscriptionDays || getPlanConfig(payment.planType)?.days || 0) * 24 * 60 * 60 * 1000,
              ],
            },
          },
        },
        {
          $set: {
            subscriptionStatus: {
              $cond: [{ $gt: ["$subscriptionExpiry", "$$NOW"] }, "active", "inactive"],
            },
          },
        },
      ], { session, updatePipeline: true });
    }

    await payment.save({ session });
    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }

  // Status change may have flipped subscriptionStatus / subscriptionExpiry
  // on the user. Invalidate so subscription guards see the fresh value.
  if (payment.user) {
    invalidateAuthCache(payment.user).catch(() => {});
  }

  res.json({ message: "Payment status updated", payment });
});

/**
 * @desc    Add a manual payment record
 * @route   POST /api/admin/payments/manual
 * @access  Private/Admin
 */
// Manual entries record money that already moved outside Razorpay (bank
// transfer, UPI, cash). Bounds below are sanity rails against typos, not
// business limits.
const MANUAL_MAX_AMOUNT = 1_000_000;
const MANUAL_MAX_CUSTOM_DAYS = 3650;
const MANUAL_MAX_TRANSACTION_ID_LENGTH = 128;
const MANUAL_MAX_NOTES_LENGTH = 1000;

function hasAtMostTwoDecimals(value) {
  return Math.round(value * 100) === value * 100;
}

exports.addManualPayment = asyncHandler(async (req, res) => {
  const { userId, amount, transactionId, planType = "3_months", customDays, notes } = req.body;

  if (!mongoose.isValidObjectId(userId)) {
    throw new ApiError(400, "A valid user is required", "VALIDATION_ERROR");
  }
  if (transactionId !== undefined && transactionId !== null && typeof transactionId !== "string") {
    throw new ApiError(400, "Transaction ID must be a string", "VALIDATION_ERROR");
  }
  const normalizedTransactionId = String(transactionId || "").trim() || `MAN-${Date.now()}`;
  if (normalizedTransactionId.length > MANUAL_MAX_TRANSACTION_ID_LENGTH) {
    throw new ApiError(400, `Transaction ID must be at most ${MANUAL_MAX_TRANSACTION_ID_LENGTH} characters`, "VALIDATION_ERROR");
  }
  if (notes !== undefined && notes !== null && typeof notes !== "string") {
    throw new ApiError(400, "Notes must be a string", "VALIDATION_ERROR");
  }
  const normalizedNotes = String(notes || "").trim().slice(0, MANUAL_MAX_NOTES_LENGTH) || "Manual admin entry";

  // Accept "899", " 899 ", "899.00"; reject "", "abc", "1e3"-style surprises.
  const amountString = typeof amount === "number" ? String(amount) : String(amount ?? "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(amountString)) {
    throw new ApiError(400, "Amount must be a positive number with at most two decimals", "VALIDATION_ERROR");
  }
  const numericAmount = Number(amountString);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0 || !hasAtMostTwoDecimals(numericAmount)) {
    throw new ApiError(400, "Amount must be a positive number with at most two decimals", "VALIDATION_ERROR");
  }
  if (numericAmount > MANUAL_MAX_AMOUNT) {
    throw new ApiError(400, `Amount cannot exceed ₹${MANUAL_MAX_AMOUNT.toLocaleString("en-IN")}`, "VALIDATION_ERROR");
  }

  const normalizedPlanType = String(planType || "3_months").trim();
  if (normalizedPlanType === "custom") {
    const days = Number(customDays);
    if (!Number.isInteger(days) || days <= 0) {
      throw new ApiError(400, "Custom plans need a whole number of days (1 or more)", "VALIDATION_ERROR");
    }
    if (days > MANUAL_MAX_CUSTOM_DAYS) {
      throw new ApiError(400, `Custom plans cannot exceed ${MANUAL_MAX_CUSTOM_DAYS} days`, "VALIDATION_ERROR");
    }
  }

  const plan = getPlanConfig(normalizedPlanType, { customDays, amount: numericAmount });
  if (!plan || !Number.isFinite(plan.days) || plan.days <= 0) {
    throw new ApiError(400, "Unknown plan type", "VALIDATION_ERROR");
  }

  // Manual entries are how admins record offline deals, discounts and old
  // pricing, so any amount is allowed. When it differs from the configured
  // price we stamp the discrepancy on the record and the audit log so
  // revenue reports can tell a discounted 1-month from a full-price one.
  const configuredAmount = plan.planType !== "custom" && Number.isFinite(plan.amount) ? plan.amount : null;
  const offPrice = configuredAmount !== null && numericAmount !== configuredAmount;
  const finalNotes = offPrice
    ? `${normalizedNotes} [Recorded at ₹${numericAmount}; ${plan.label || plan.planType} plan price is ₹${configuredAmount}]`.slice(0, MANUAL_MAX_NOTES_LENGTH + 120)
    : normalizedNotes;

  const session = await mongoose.startSession();
  let payment;
  try {
    session.startTransaction();
    const existingPayment = await Payment.findOne({ transactionId: normalizedTransactionId }).session(session);
    if (existingPayment) {
      throw new ApiError(409, "Transaction ID already exists", "PAYMENT_DUPLICATE");
    }
    const user = await User.findById(userId).session(session);
    if (!user) {
      throw new ApiError(404, "User not found", "NOT_FOUND");
    }

    const now = new Date();
    const baseExpiry = user.subscriptionExpiry && new Date(user.subscriptionExpiry) > now
      ? new Date(user.subscriptionExpiry)
      : now;
    const expiryDate = new Date(baseExpiry);
    expiryDate.setDate(expiryDate.getDate() + plan.days);

    [payment] = await Payment.create([{
      user: userId,
      amount: numericAmount,
      transactionId: normalizedTransactionId,
      planType: plan.planType,
      paymentMethod: "manual",
      status: "completed",
      notes: finalNotes,
      expiryDate,
      subscriptionDays: plan.days,
    }], { session });

    await User.findByIdAndUpdate(userId, {
      subscriptionExpiry: expiryDate,
      subscriptionStatus: "active",
      subscriptionPlan: resolveSubscriptionPlanLabel(user.subscriptionPlan, plan.userPlan),
      $inc: { totalPaid: numericAmount },
    }, { session });
    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    if (error?.code === 11000) {
      throw new ApiError(409, "Transaction ID already exists", "PAYMENT_DUPLICATE");
    }
    throw error;
  } finally {
    await session.endSession();
  }

  invalidateAuthCache(userId).catch(() => {});

  // Audit: financial write by an admin. Names the actor, target, plan + amount,
  // transaction ID, and resulting payment id so the action is forensically
  // traceable. PII intentionally limited to ObjectIds.
  logger.warn("[Admin] manual payment recorded", {
    adminId: String(req.user?._id),
    userId: String(userId),
    paymentId: String(payment._id),
    transactionId: normalizedTransactionId,
    amount: numericAmount,
    planType: plan.planType,
    subscriptionDays: plan.days,
    configuredAmount,
    offPrice,
  });

  res.status(201).json({ message: "Manual payment recorded successfully", payment });
});
