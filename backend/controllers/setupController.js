const asyncHandler = require("../utils/asyncHandler");
const setupService = require("../services/setup.service");

const getSetups = asyncHandler(async (req, res) => {
  const strategies = await setupService.getSetups(req.user._id, req.query.marketType || "Forex");
  res.json(strategies);
});

const uploadSetupReferenceImage = asyncHandler(async (req, res) => {
  if (!req.uploadedImage?.imageUrl) {
    res.status(400).json({ message: "Image file is required." });
    return;
  }

  res.json({
    imageUrl: req.uploadedImage.imageUrl,
    publicId: req.uploadedImage.publicId,
    bytes: req.uploadedImage.bytes,
    format: req.uploadedImage.format,
  });
});

const uploadSetupReferenceImages = asyncHandler(async (req, res) => {
  if (!req.uploadedImages?.length) {
    res.status(400).json({ message: "At least one image file is required." });
    return;
  }

  res.json(
    req.uploadedImages.map(img => ({
      imageUrl: img.imageUrl,
      publicId: img.publicId,
      bytes: img.bytes,
      format: img.format,
    }))
  );
});

const saveSetups = asyncHandler(async (req, res) => {
  const created = await setupService.saveSetups(
    req.user._id,
    req.query.marketType || "Forex",
    req.body.strategies
  );
  res.json(created);
});

module.exports = {
  getSetups,
  saveSetups,
  uploadSetupReferenceImage,
  uploadSetupReferenceImages,
};
