const Payment = require("../../models/Payment");
const User = require("../../models/Users");
const ApiError = require("../../utils/ApiError");
const asyncHandler = require("../../utils/asyncHandler");
const mongoose = require("mongoose");
const { invalidateAuthCache } = require("../../services/authCacheService");
const { getPlanConfig } = require("../../services/paymentService");
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
          { new: true, select: "subscriptionExpiry", session }
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
      ], { session });
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
exports.addManualPayment = asyncHandler(async (req, res) => {
  const { userId, amount, transactionId, planType = "3_months", customDays, notes } = req.body;
  if (transactionId !== undefined && typeof transactionId !== "string") {
    throw new ApiError(400, "Transaction ID must be a string", "VALIDATION_ERROR");
  }
  const normalizedTransactionId = String(transactionId || `MAN-${Date.now()}`).trim();
  const numericAmount = Number(amount);
  const plan = getPlanConfig(planType, { customDays, amount: numericAmount });
  if (!Number.isFinite(numericAmount) || numericAmount <= 0 || !plan || plan.days <= 0) {
    throw new ApiError(400, "Valid amount, plan type, and subscription duration are required", "VALIDATION_ERROR");
  }
  if (Number.isFinite(plan.amount) && plan.planType !== "custom" && numericAmount !== plan.amount) {
    throw new ApiError(400, "Manual payment amount does not match the configured plan price", "PAYMENT_INTEGRITY_CHECK_FAILED");
  }

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
      notes: notes || "Manual admin entry",
      expiryDate,
      subscriptionDays: plan.days,
    }], { session });

    await User.findByIdAndUpdate(userId, {
      subscriptionExpiry: expiryDate,
      subscriptionStatus: "active",
      subscriptionPlan: plan.userPlan,
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
  });

  res.status(201).json({ message: "Manual payment recorded successfully", payment });
});
