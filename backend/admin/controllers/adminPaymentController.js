const Payment = require("../../models/Payment");
const User = require("../../models/Users");
const ApiError = require("../../utils/ApiError");
const asyncHandler = require("../../utils/asyncHandler");

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
  const payment = await Payment.findById(req.params.id);

  if (!payment) {
    throw new ApiError(404, "Payment not found", "NOT_FOUND");
  }

    const previousStatus = payment.status;
    payment.status = status;

    // Handle side effects on User profile if status changed to completed or refunded
    if (status === "completed" && previousStatus !== "completed") {
      const daysToAdd = payment.planType === "3_months" ? 90 : 0;
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
          { new: true, select: "subscriptionExpiry" }
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
          },
        },
      ]);
    }

  await payment.save();
  res.json({ message: "Payment status updated", payment });
});

/**
 * @desc    Add a manual payment record
 * @route   POST /api/admin/payments/manual
 * @access  Private/Admin
 */
exports.addManualPayment = asyncHandler(async (req, res) => {
  const { userId, amount, transactionId, planType, notes } = req.body;
  const normalizedTransactionId = (transactionId || `MAN-${Date.now()}`).trim();

  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(404, "User not found", "NOT_FOUND");
  }

  const existingPayment = await Payment.findOne({ transactionId: normalizedTransactionId }).select("_id");
  if (existingPayment) {
    throw new ApiError(400, "Transaction ID already exists. Please use a unique transaction ID.", "VALIDATION_ERROR");
  }

    // Create payment record
    const payment = new Payment({
      user: userId,
      amount: amount || 150,
      transactionId: normalizedTransactionId,
      planType: planType || "3_months",
      paymentMethod: "manual",
      status: "completed",
      notes: notes || "Manual admin entry"
    });

    // Update User immediately since it's manual and "completed"
    let newExpiry;
    const now = new Date();
    if (user.subscriptionExpiry && user.subscriptionExpiry > now) {
      newExpiry = new Date(user.subscriptionExpiry);
    } else {
      newExpiry = now;
    }

    const daysToAdd = payment.planType === "3_months" ? 90 : 30; // 90 for 3 mo, 30 for custom/others
    newExpiry.setDate(newExpiry.getDate() + daysToAdd);

    user.subscriptionExpiry = newExpiry;
    user.subscriptionStatus = "active";
    user.totalPaid = (user.totalPaid || 0) + payment.amount;

    payment.expiryDate = newExpiry;

    // Save payment first so duplicate transaction IDs never extend a user's plan accidentally.
    await payment.save();
    await user.save();

  res.status(201).json({ message: "Manual payment recorded successfully", payment });
});
