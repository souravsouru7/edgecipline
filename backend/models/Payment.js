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
      required: true
    },
    currency: {
      type: String,
      default: "INR"
    },
    status: {
      type: String,
      enum: ["pending", "completed", "refunded", "failed"],
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
      enum: ["3_months", "custom"],
      default: "3_months"
    },
    expiryDate: {
      type: Date
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
      type: String
    }
  },
  { timestamps: true }
);

paymentSchema.index({ user: 1, createdAt: -1 });
paymentSchema.index({ status: 1, createdAt: -1 });
// M13: Enable efficient lookup by razorpay order ID during webhook processing
paymentSchema.index({ razorpayOrderId: 1 }, { sparse: true });
paymentSchema.index(
  { razorpayPaymentId: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: {
      paymentMethod: "razorpay",
      razorpayPaymentId: { $type: "string" },
    },
  }
);

module.exports = mongoose.model("Payment", paymentSchema);
