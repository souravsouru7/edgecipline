const express = require("express");
const router = express.Router();
const {
  submitIssue,
  listMyIssues,
  getMyIssue,
} = require("../controllers/issueReportController");
const { protect } = require("../middleware/authMiddleware");
const { uploadIssueReportImages } = require("../middleware/upload.middleware");
const { issueReportRateLimiter } = require("../middleware/rateLimiter");
const { validateRequest } = require("../middleware/validateRequest");
const { issueSchemas } = require("../validation/schemas");

router.post(
  "/",
  protect,
  issueReportRateLimiter,
  uploadIssueReportImages,
  validateRequest(issueSchemas.create),
  submitIssue
);
router.get("/", protect, validateRequest(issueSchemas.list), listMyIssues);
router.get("/:id", protect, validateRequest(issueSchemas.getById), getMyIssue);

module.exports = router;
