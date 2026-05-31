const express = require("express");
const router = express.Router();
const { logChecklistResult, getChecklistStats } = require("../controllers/checklistController");
const {
  getNotificationSettings,
  saveNotificationSettings,
} = require("../controllers/checklistNotificationController");
const { protect } = require("../middleware/authMiddleware");

router.route("/track").post(protect, logChecklistResult).get(protect, getChecklistStats);

router
  .route("/notification-settings")
  .get(protect, getNotificationSettings)
  .put(protect, saveNotificationSettings);

module.exports = router;
