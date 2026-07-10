const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const { paymentRateLimiter } = require("../middleware/rateLimiter");
const { createOrder, verifyPayment } = require("../controllers/paymentController");

router.post("/order", protect, paymentRateLimiter, createOrder);
router.post("/verify", protect, paymentRateLimiter, verifyPayment);

module.exports = router;
