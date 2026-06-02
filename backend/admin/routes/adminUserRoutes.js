const express = require("express");
const router = express.Router();
const {
  getAllUsers,
  deleteUser,
  toggleUserStatus,
  extendUserPlan,
  getExpiredUsers,
  sendRenewalReminderAction
} = require("../controllers/adminUserController");
const { adminAuth } = require("../../middleware/adminAuth");
const { validateObjectId } = require("../../middleware/validateObjectId");
const { adminDestructiveRateLimiter } = require("../../middleware/rateLimiter");

// All routes are protected by adminAuth.
// Destructive operations also have a per-admin rate limit to prevent
// accidental bulk loops and limit damage from compromised admin sessions.
router.get("/", adminAuth, getAllUsers);
router.get("/expired", adminAuth, getExpiredUsers);
router.post("/:id/remind", adminAuth, validateObjectId("id"), sendRenewalReminderAction);
router.delete("/:id", adminAuth, adminDestructiveRateLimiter, validateObjectId("id"), deleteUser);
router.patch("/:id/status", adminAuth, adminDestructiveRateLimiter, validateObjectId("id"), toggleUserStatus);
router.patch("/:id/extend", adminAuth, adminDestructiveRateLimiter, validateObjectId("id"), extendUserPlan);

module.exports = router;
