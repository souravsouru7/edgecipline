const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/authMiddleware");
const {
  statusRateLimiter,
  uploadRateLimiter,
} = require("../middleware/rateLimiter");
const { uploadTradeImage, uploadTradeEvidenceImages: uploadTradeEvidenceImagesMiddleware } = require("../middleware/upload.middleware");

const {
  cancelUploadJob,
  getUploadQueueHealth,
  getUploadJobStatus,
  uploadImage,
  uploadScreenshotImage,
  uploadTradeEvidenceImages,
} = require("../controllers/uploadController");

router.post("/image", protect, uploadRateLimiter, uploadTradeImage, uploadScreenshotImage);
router.post("/", protect, uploadRateLimiter, uploadTradeImage, uploadImage);

// Batch upload trade evidence images. Returns array of {url, publicId,
// thumbnailUrl, mediumUrl, ...}. Caller embeds the array in trade.tradeImages
// on the subsequent create/update request.
router.post(
  "/trade-evidence",
  protect,
  uploadRateLimiter,
  uploadTradeEvidenceImagesMiddleware,
  uploadTradeEvidenceImages
);
router.get("/queue-health", protect, statusRateLimiter, getUploadQueueHealth);
router.get("/job-status/:id", protect, statusRateLimiter, getUploadJobStatus);
router.post("/job-status/:id/cancel", protect, statusRateLimiter, cancelUploadJob);
router.post("/cancel/:id", protect, statusRateLimiter, cancelUploadJob);

module.exports = router;
