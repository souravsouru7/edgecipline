const express = require("express");
const router = express.Router();

const { getSetups, saveSetups, uploadSetupReferenceImage, uploadSetupReferenceImages } = require("../controllers/setupController");
const { protect } = require("../middleware/authMiddleware");
const { uploadRateLimiter } = require("../middleware/rateLimiter");
const {
  uploadSetupReferenceImage: uploadSetupReferenceImageMiddleware,
  uploadSetupReferenceImages: uploadSetupReferenceImagesMiddleware,
} = require("../middleware/upload.middleware");

// Get all setups for current user
router.get("/", protect, getSetups);

// Single image upload (legacy, backward-compat) — rate-limited to prevent
// abuse of Cloudinary storage.
router.post("/image", protect, uploadRateLimiter, uploadSetupReferenceImageMiddleware, uploadSetupReferenceImage);

// Batch image upload — up to 20 images in one request. Same limiter applies.
router.post("/images", protect, uploadRateLimiter, uploadSetupReferenceImagesMiddleware, uploadSetupReferenceImages);

// Replace all setups for current user
router.put("/", protect, saveSetups);

module.exports = router;

