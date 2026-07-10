const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    amount: {
      type: Number,
      required: true,
      min: 1
    },
    currency: {
      type: String,
      enum: ["INR", "USD"],
      default: "INR"
    },
    status: {
      type: String,
      enum: ["pending", "completed", "partially_refunded", "refunded", "failed"],
      default: "pending"
    },
    paymentMethod: {
      type: String,
      enum: ["razorpay", "manual", "stripe"],
      default: "manual"
    },
    transactionId: {
      type: String,
      unique: true,
      required: true
    },
    planType: {
      type: String,
      enum: ["3_months", "monthly", "yearly", "custom"],
      default: "3_months"
    },
    expiryDate: {
      type: Date
    },
    subscriptionDays: {
      type: Number,
      min: 1
    },
    notes: {
      type: String
    },
    razorpayOrderId: {
      type: String
    },
    razorpayPaymentId: {
      type: String,
      index: false
    },
    razorpaySignature: {
      type: String,
      select: false
    },
    razorpayRefundIds: {
      type: [String],
      default: []
    },
    refundedAmount: {
      type: Number,
      default: 0,
      min: 0
    },
    refundedAt: {
      type: Date
    }
  },
  { timestamps: true }
);

paymentSchema.index({ user: 1, createdAt: -1 });
paymentSchema.index({ status: 1, createdAt: -1 });
paymentSchema.index({ createdAt: -1 });
// M13: Enable efficient lookup by razorpay order ID during webhook processing
paymentSchema.index(
  { razorpayOrderId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      paymentMethod: "razorpay",
      razorpayOrderId: { $type: "string" },
    },
  }
);
paymentSchema.index(
  { razorpayPaymentId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      paymentMethod: "razorpay",
      razorpayPaymentId: { $type: "string" },
    },
  }
);

module.exports = mongoose.model("Payment", paymentSchema);
