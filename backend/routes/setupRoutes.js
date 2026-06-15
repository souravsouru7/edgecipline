const express = require("express");
const router = express.Router();

const { getSetups, saveSetups, uploadSetupReferenceImage, uploadSetupReferenceImages } = require("../controllers/setupController");
const { protect } = require("../middleware/authMiddleware");
const {
  uploadSetupReferenceImage: uploadSetupReferenceImageMiddleware,
  uploadSetupReferenceImages: uploadSetupReferenceImagesMiddleware,
} = require("../middleware/upload.middleware");

// Get all setups for current user
router.get("/", protect, getSetups);

// Single image upload (legacy, backward-compat)
router.post("/image", protect, uploadSetupReferenceImageMiddleware, uploadSetupReferenceImage);

// Batch image upload — up to 20 images in one request
router.post("/images", protect, uploadSetupReferenceImagesMiddleware, uploadSetupReferenceImages);

// Replace all setups for current user
router.put("/", protect, saveSetups);

module.exports = router;

