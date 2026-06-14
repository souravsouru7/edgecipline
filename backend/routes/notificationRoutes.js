const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const {
  listNotifications,
  markAllAsRead,
  markAsRead,
  trackOpen,
  trackAction,
  getSetupDisciplineDebug,
} = require("../controllers/userNotificationController");

// Static debug route must appear before /:id parameterised routes
router.get("/debug/setup-discipline/latest", protect, getSetupDisciplineDebug);
router.get("/", protect, listNotifications);
router.patch("/read-all", protect, markAllAsRead);
router.patch("/:id/read", protect, markAsRead);
router.post("/:id/opened", protect, trackOpen);
router.post("/:id/action", protect, trackAction);

module.exports = router;
