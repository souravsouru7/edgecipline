const express = require("express");
const router = express.Router();
const { 
  getNotifications, 
  markAsRead, 
  markAllAsRead,
  sendCustomNotification,
} = require("../../controllers/notificationController");
const { adminAuth } = require("../../middleware/adminAuth");

router.get("/", adminAuth, getNotifications);
router.post("/custom", adminAuth, sendCustomNotification);
router.patch("/:id/read", adminAuth, markAsRead);
router.post("/read-all", adminAuth, markAllAsRead);

module.exports = router;
