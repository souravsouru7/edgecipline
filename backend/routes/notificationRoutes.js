const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const { validateRequest } = require("../middleware/validateRequest");
const { notificationSchemas } = require("../validation/schemas");
const {
  listNotifications,
  markAllAsRead,
  markAsRead,
  trackOpen,
  trackDelivered,
  trackAction,
  getSetupDisciplineDebug,
} = require("../controllers/userNotificationController");

// Static debug route must appear before /:id parameterised routes
router.get("/debug/setup-discipline/latest", protect, getSetupDisciplineDebug);
router.get("/", protect, validateRequest(notificationSchemas.list), listNotifications);
router.patch("/read-all", protect, markAllAsRead);
router.patch("/:id/read", protect, validateRequest(notificationSchemas.id), markAsRead);
router.post("/:id/opened", protect, validateRequest(notificationSchemas.id), trackOpen);
router.post("/:id/delivered", protect, validateRequest(notificationSchemas.id), trackDelivered);
router.post("/:id/action", protect, validateRequest(notificationSchemas.action), trackAction);

module.exports = router;
