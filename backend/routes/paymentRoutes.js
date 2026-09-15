const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const { paymentRateLimiter } = require("../middleware/rateLimiter");
const { validateRequest } = require("../middleware/validateRequest");
const { userPromotionSchemas } = require("../validation/promotionSchemas");
const { createOrder, verifyPayment } = require("../controllers/paymentController");

router.post(
  "/order",
  protect,
  paymentRateLimiter,
  validateRequest(userPromotionSchemas.createOrder),
  createOrder
);
router.post("/verify", protect, paymentRateLimiter, verifyPayment);

module.exports = router;
