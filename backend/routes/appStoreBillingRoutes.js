"use strict";

// Apple In-App Purchase. Mounted at /api/payments/app-store, next to the
// Google Play routes. The Server Notifications webhook is mounted separately
// (routes/appStoreNotificationRoutes) because it is unauthenticated.

const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const { paymentRateLimiter, statusRateLimiter } = require("../middleware/rateLimiter");
const {
  getAppStoreConfig,
  getAppStoreSubscription,
  verifyAppStorePurchase,
  restoreAppStorePurchases,
} = require("../controllers/appStoreBillingController");

router.get("/config", protect, statusRateLimiter, getAppStoreConfig);
router.get("/subscription", protect, statusRateLimiter, getAppStoreSubscription);
router.post("/verify", protect, paymentRateLimiter, verifyAppStorePurchase);
router.post("/restore", protect, paymentRateLimiter, restoreAppStorePurchases);

module.exports = router;
