const express = require("express");
const router = express.Router();
const {
  getNotifications,
  markAsRead,
  markAllAsRead,
  sendCustomNotification,
} = require("../../controllers/notificationController");
const { getNotificationAnalytics, getQueueMetrics } = require("../controllers/adminNotificationAnalyticsController");
const { adminAuth } = require("../../middleware/adminAuth");

router.get("/analytics",     adminAuth, getNotificationAnalytics);
router.get("/queue-metrics", adminAuth, getQueueMetrics);
router.get("/", adminAuth, getNotifications);
router.post("/custom", adminAuth, sendCustomNotification);
router.patch("/:id/read", adminAuth, markAsRead);
router.post("/read-all", adminAuth, markAllAsRead);

module.exports = router;
