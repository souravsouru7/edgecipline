const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const {
  listNotifications,
  markAllAsRead,
  markAsRead,
} = require("../controllers/userNotificationController");

router.get("/", protect, listNotifications);
router.patch("/read-all", protect, markAllAsRead);
router.patch("/:id/read", protect, markAsRead);

module.exports = router;
