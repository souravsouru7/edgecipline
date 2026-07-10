const express = require("express");
const router = express.Router();
const {
  adminListIssues,
  adminGetIssue,
  adminUpdateIssueStatus,
  adminGetAnalytics,
} = require("../../controllers/issueReportController");
const { adminAuth } = require("../../middleware/adminAuth");
const { adminDestructiveRateLimiter } = require("../../middleware/rateLimiter");
const { validateRequest } = require("../../middleware/validateRequest");
const { issueSchemas } = require("../../validation/schemas");

router.get("/analytics/summary", adminAuth, adminGetAnalytics);
router.get("/", adminAuth, validateRequest(issueSchemas.adminList), adminListIssues);
router.get("/:id", adminAuth, validateRequest(issueSchemas.getById), adminGetIssue);
router.patch(
  "/:id/status",
  adminAuth,
  adminDestructiveRateLimiter,
  validateRequest(issueSchemas.adminUpdate),
  adminUpdateIssueStatus
);

module.exports = router;
