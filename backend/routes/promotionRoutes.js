"use strict";

const express = require("express");
const router = express.Router();
const { protect, optionalProtect } = require("../middleware/authMiddleware");
const { validateRequest } = require("../middleware/validateRequest");
const {
  couponValidateRateLimiter,
  promotionTouchRateLimiter,
} = require("../middleware/rateLimiter");
const { userPromotionSchemas } = require("../validation/promotionSchemas");
const {
  validateCoupon,
  recordTouch,
  refRedirect,
} = require("../controllers/promotionController");

router.get(
  "/r/:slug",
  promotionTouchRateLimiter,
  validateRequest(userPromotionSchemas.refRedirect),
  refRedirect
);

router.post(
  "/touch",
  promotionTouchRateLimiter,
  optionalProtect,
  validateRequest(userPromotionSchemas.recordTouch),
  recordTouch
);

// Validation is read-only and has its own limiter. It must NOT share the
// `payment` bucket with /payments/order and /payments/verify: a buyer who
// tried a few codes would otherwise have their post-payment verify call
// rejected with 429 after the money was captured.
router.post(
  "/coupons/validate",
  protect,
  couponValidateRateLimiter,
  validateRequest(userPromotionSchemas.validateCoupon),
  validateCoupon
);

module.exports = router;
