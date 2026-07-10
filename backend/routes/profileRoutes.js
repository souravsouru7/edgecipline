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

router.post("/device-tokens", protect, deviceTokenRateLimiter, registerDeviceToken);
router.delete("/device-tokens", protect, deviceTokenRateLimiter, unregisterDeviceToken);
router.get("/notification-preferences", protect, getNotificationPreferences);
router.patch("/notification-preferences", protect, updateNotificationPreferences);

module.exports = router;
