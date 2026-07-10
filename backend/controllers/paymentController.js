const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const {
  activateRazorpaySubscriptionPayment,
  createRazorpayOrder,
  fetchAndValidateRazorpayPayment,
  getRazorpayClient,
  verifyRazorpayOrderSignature,
} = require("../services/paymentService");

exports.createOrder = asyncHandler(async (req, res) => {
  const { planType = "3_months" } = req.body;
  const order = await createRazorpayOrder({
    userId: req.user._id,
    planType,
  });

  res.json(order);
});

exports.verifyPayment = asyncHandler(async (req, res) => {
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
