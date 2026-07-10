const express = require("express");
const router = express.Router();
const { handleRazorpayWebhook } = require("../controllers/razorpayWebhookController");
const { webhookRateLimiter } = require("../middleware/rateLimiter");

router.post("/", webhookRateLimiter, handleRazorpayWebhook);

module.exports = router;
