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
      // Must cover every key in paymentService's PLAN_CONFIG. A plan added
      // there but missed here is captured by Razorpay and then rejected by
      // Mongoose validation — the customer is charged and never activated.
      // paymentPlanEnum.test.js fails if the two ever drift apart.
      enum: ["monthly", "3_months", "6_months", "yearly", "custom"],
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
    },
    listAmount: {
      type: Number,
      min: 0,
    },
    discountAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    coupon: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Coupon",
      default: null,
    },
    campaign: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      default: null,
    },
    influencer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Influencer",
      default: null,
    },
    checkoutSession: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CheckoutSession",
      default: null,
    },
    attribution: {
      firstInfluencer: { type: mongoose.Schema.Types.ObjectId, ref: "Influencer", default: null },
      convertingCoupon: { type: mongoose.Schema.Types.ObjectId, ref: "Coupon", default: null },
      refSlug: { type: String, default: "", trim: true },
    },
  },
  { timestamps: true }
);

paymentSchema.index({ coupon: 1, createdAt: -1 }, { sparse: true });
paymentSchema.index({ campaign: 1, createdAt: -1 }, { sparse: true });
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
