const express = require("express");
const router = express.Router();
const {
  submitIssue,
  listMyIssues,
  getMyIssue,
} = require("../controllers/issueReportController");
const { protect } = require("../middleware/authMiddleware");
const { uploadSupportAttachments } = require("../middleware/upload.middleware");
const { issueReportRateLimiter } = require("../middleware/rateLimiter");
const { validateRequest } = require("../middleware/validateRequest");
const { issueSchemas } = require("../validation/schemas");

// An issue report opens a support ticket, and its screenshots become that
// ticket's attachments — so they go up through the SUPPORT uploader (private,
// `authenticated` delivery) rather than the public one. Field name is
// "attachments", matching the ticket form.
router.post(
  "/",
  protect,
  issueReportRateLimiter,
  uploadSupportAttachments,
  validateRequest(issueSchemas.create),
  submitIssue
);
router.get("/", protect, validateRequest(issueSchemas.list), listMyIssues);
router.get("/:id", protect, validateRequest(issueSchemas.getById), getMyIssue);

module.exports = router;
