const express = require("express");
const router = express.Router();
const { submitFeedback } = require("../controllers/feedbackController");
const { protect } = require("../middleware/authMiddleware");
const { issueReportRateLimiter } = require("../middleware/rateLimiter");
const { uploadFeedbackScreenshot } = require("../middleware/upload.middleware");

// Reuse issueReportRateLimiter — same shape (user-submitted text + optional
// attachment, abuse-prone). 10/hour is enough for any legitimate flow.
router.post("/", protect, issueReportRateLimiter, uploadFeedbackScreenshot, submitFeedback);

module.exports = router;
