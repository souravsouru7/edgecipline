const asyncHandler = require("../utils/asyncHandler");
const { processRazorpayWebhook } = require("../services/razorpayWebhookService");

exports.handleRazorpayWebhook = asyncHandler(async (req, res) => {
  // The webhook only needs a 2xx acknowledgement. Internal processing detail
  // (eventId, idempotent, inProgress, processingResult) belongs in our logs,
  // not in a response sent back to Razorpay — spreading the whole result
  // object auto-exposes any new internal field added later.
  await processRazorpayWebhook({
    rawBody: req.body,
    signature: req.get("x-razorpay-signature"),
  });

  res.status(200).json({ received: true });
});
