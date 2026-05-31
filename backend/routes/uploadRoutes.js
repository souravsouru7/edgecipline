const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/authMiddleware");
const {
  statusRateLimiter,
  uploadRateLimiter,
} = require("../middleware/rateLimiter");
const { uploadTradeImage } = require("../middleware/upload.middleware");

const {
  getUploadJobStatus,
  uploadImage,
  uploadScreenshotImage,
} = require("../controllers/uploadController");

router.post("/image", protect, uploadRateLimiter, uploadTradeImage, uploadScreenshotImage);
router.post("/", protect, uploadRateLimiter, uploadTradeImage, uploadImage);
router.get("/job-status/:id", protect, statusRateLimiter, getUploadJobStatus);

module.exports = router;
