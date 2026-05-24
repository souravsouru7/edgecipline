const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const {
  getNotificationPreferences,
  registerDeviceToken,
  unregisterDeviceToken,
  updateNotificationPreferences,
} = require("../controllers/deviceTokenController");

router.post("/device-tokens", protect, registerDeviceToken);
router.delete("/device-tokens", protect, unregisterDeviceToken);
router.get("/notification-preferences", protect, getNotificationPreferences);
router.patch("/notification-preferences", protect, updateNotificationPreferences);

module.exports = router;
