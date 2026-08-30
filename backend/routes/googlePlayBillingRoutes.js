"use strict";

const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const { paymentRateLimiter, statusRateLimiter } = require("../middleware/rateLimiter");
const {
  getBillingConfig,
  verifyGooglePlayPurchase,
  restoreGooglePlayPurchases,
  getGooglePlaySubscription,
} = require("../controllers/googlePlayBillingController");

// Mounted at /api/payments/google-play, alongside the Razorpay routes rather
// than in a parallel billing namespace — both providers feed one entitlement,
// and splitting them across two API surfaces would invite that to drift.
//
// Every route is authenticated. The user id always comes from the token; no
// endpoint here accepts one in the body.

// Read-only and polled by the paywall on open, so it gets the status limiter
// rather than the much tighter payment one.
router.get("/config", protect, statusRateLimiter, getBillingConfig);
router.get("/subscription", protect, statusRateLimiter, getGooglePlaySubscription);

// State-changing. paymentRateLimiter is the same limiter the Razorpay
// order/verify pair uses, which also blunts token-guessing against verify.
router.post("/verify", protect, paymentRateLimiter, verifyGooglePlayPurchase);
router.post("/restore", protect, paymentRateLimiter, restoreGooglePlayPurchases);

module.exports = router;
