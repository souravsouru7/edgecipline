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

// All routes are protected by adminAuth
router.get("/", adminAuth, getAllUsers);
router.get("/expired", adminAuth, getExpiredUsers);
router.post("/:id/remind", adminAuth, validateObjectId("id"), sendRenewalReminderAction);
router.delete("/:id", adminAuth, validateObjectId("id"), deleteUser);
router.patch("/:id/status", adminAuth, validateObjectId("id"), toggleUserStatus);
router.patch("/:id/extend", adminAuth, validateObjectId("id"), extendUserPlan);

module.exports = router;
