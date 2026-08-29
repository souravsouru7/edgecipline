"use strict";

const express = require("express");
const router = express.Router();
const { protect, optionalProtect } = require("../middleware/authMiddleware");
const { validateRequest } = require("../middleware/validateRequest");
const {
  couponValidateRateLimiter,
  promotionTouchRateLimiter,
  paymentRateLimiter,
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

router.post(
  "/coupons/validate",
  protect,
  couponValidateRateLimiter,
  paymentRateLimiter,
  validateRequest(userPromotionSchemas.validateCoupon),
  validateCoupon
);

module.exports = router;
