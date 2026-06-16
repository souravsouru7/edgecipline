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
const { validateObjectId } = require("../middleware/validateObjectId");

router.post("/", protect, issueReportRateLimiter, uploadIssueReportImages, submitIssue);
router.get("/", protect, listMyIssues);
router.get("/:id", protect, validateObjectId("id"), getMyIssue);

module.exports = router;
