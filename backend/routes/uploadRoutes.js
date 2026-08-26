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

// These handlers push the file to Cloudinary inside the request, which on a
// slow connection takes longer than the 15s global API deadline. When that
// deadline fired the caller got a timeout while the server carried on and
// created the OCR job anyway — a failure on screen, a real job in the
// database. The client already waits 120s for this call.
const UPLOAD_REQUEST_TIMEOUT_MS = Number(process.env.UPLOAD_REQUEST_TIMEOUT_MS || 60000);

const allowSlowUpload = (req, _res, next) => {
  req.timeoutConfig?.extendTimeout?.(UPLOAD_REQUEST_TIMEOUT_MS);
  next();
};

router.post("/image", protect, uploadRateLimiter, allowSlowUpload, uploadTradeImage, uploadScreenshotImage);
router.post("/", protect, uploadRateLimiter, allowSlowUpload, uploadTradeImage, uploadImage);

// Batch upload trade evidence images. Returns array of {url, publicId,
// thumbnailUrl, mediumUrl, ...}. Caller embeds the array in trade.tradeImages
// on the subsequent create/update request.
router.post(
  "/trade-evidence",
  protect,
  uploadRateLimiter,
  allowSlowUpload,
  uploadTradeEvidenceImagesMiddleware,
  uploadTradeEvidenceImages
);
router.get("/queue-health", protect, statusRateLimiter, getUploadQueueHealth);
router.get("/job-status/:id", protect, statusRateLimiter, getUploadJobStatus);
router.post("/job-status/:id/cancel", protect, statusRateLimiter, cancelUploadJob);
router.post("/cancel/:id", protect, statusRateLimiter, cancelUploadJob);

module.exports = router;
