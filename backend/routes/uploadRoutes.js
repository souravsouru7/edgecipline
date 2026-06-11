const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/authMiddleware");
const {
  statusRateLimiter,
  uploadRateLimiter,
} = require("../middleware/rateLimiter");
const { uploadTradeImage } = require("../middleware/upload.middleware");

const {
  cancelUploadJob,
  getUploadJobStatus,
  uploadImage,
  uploadScreenshotImage,
} = require("../controllers/uploadController");

router.post("/image", protect, uploadRateLimiter, uploadTradeImage, uploadScreenshotImage);
router.post("/", protect, uploadRateLimiter, uploadTradeImage, uploadImage);
router.get("/job-status/:id", protect, statusRateLimiter, getUploadJobStatus);
router.post("/job-status/:id/cancel", protect, statusRateLimiter, cancelUploadJob);
router.post("/cancel/:id", protect, statusRateLimiter, cancelUploadJob);

module.exports = router;
