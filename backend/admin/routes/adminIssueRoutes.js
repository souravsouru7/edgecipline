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
const { validateObjectId } = require("../../middleware/validateObjectId");

router.get("/analytics/summary", adminAuth, adminGetAnalytics);
router.get("/", adminAuth, adminListIssues);
router.get("/:id", adminAuth, validateObjectId("id"), adminGetIssue);
router.patch(
  "/:id/status",
  adminAuth,
  adminDestructiveRateLimiter,
  validateObjectId("id"),
  adminUpdateIssueStatus
);

module.exports = router;
