const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const { deviceTokenRateLimiter } = require("../middleware/rateLimiter");
const {
  getNotificationPreferences,
  registerDeviceToken,
  unregisterDeviceToken,
  updateNotificationPreferences,
} = require("../controllers/deviceTokenController");
const { getRiskLimits, updateRiskLimits } = require("../controllers/riskLimitsController");

router.post("/device-tokens", protect, deviceTokenRateLimiter, registerDeviceToken);
router.delete("/device-tokens", protect, deviceTokenRateLimiter, unregisterDeviceToken);
router.get("/notification-preferences", protect, getNotificationPreferences);
router.patch("/notification-preferences", protect, updateNotificationPreferences);
router.get("/risk-limits", protect, getRiskLimits);
router.patch("/risk-limits", protect, updateRiskLimits);

module.exports = router;
