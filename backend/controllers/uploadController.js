const asyncHandler = require("../utils/asyncHandler");
const uploadService = require("../services/upload.service");
const { buildImageVariants } = require("../utils/cloudinaryHelpers");

exports.uploadImage = asyncHandler(async (req, res) => {
  const result = await uploadService.submitTradeUpload({
    user: req.user,
    body: req.body,
    query: req.query,
    uploadedImage: req.uploadedImage,
    file: req.file,
  });

  res.status(202).json(result);
});

exports.uploadScreenshotImage = asyncHandler(async (req, res) => {
  if (!req.uploadedImage?.imageUrl) {
    res.status(400).json({
      status: "error",
      message: "Image file is required.",
    });
    return;
  }

  res.status(201).json({
    imageUrl: req.uploadedImage.imageUrl,
    screenshotUrl: req.uploadedImage.imageUrl,
    url: req.uploadedImage.imageUrl,
    publicId: req.uploadedImage.publicId,
  });
});

// Batch trade evidence image upload. Returns array of metadata per image
// so the client can attach them to a trade in a subsequent create/update call.
exports.uploadTradeEvidenceImages = asyncHandler(async (req, res) => {
  if (!req.uploadedImages?.length) {
    res.status(400).json({
      status: "error",
      message: "At least one image is required.",
    });
    return;
  }

  const now = new Date();
  const payload = req.uploadedImages.map((img, idx) => {
    const variants = buildImageVariants(img.imageUrl);
    return {
      url: img.imageUrl,
      publicId: img.publicId,
      fileName: img.originalName || "",
      uploadedAt: now,
      order: idx,
      size: img.bytes || 0,
      format: img.format || "",
      thumbnailUrl: variants.thumbnailUrl,
      mediumUrl: variants.mediumUrl,
    };
  });

  res.status(201).json(payload);
});

exports.getUploadJobStatus = asyncHandler(async (req, res) => {
  const jobStatus = await uploadService.getUploadJobStatus(req.user._id, req.params.id);
  res.json(jobStatus);
});

exports.cancelUploadJob = asyncHandler(async (req, res) => {
  const jobStatus = await uploadService.cancelUploadJob(req.user._id, req.params.id);
  res.json(jobStatus);
});

exports.getUploadQueueHealth = asyncHandler(async (req, res) => {
  const health = await uploadService.getUploadQueueHealth();
  const status = health.queueReady ? 200 : 503;

  // Non-admin callers get a sanitized readiness probe — they don't need to
  // see per-state job counts. Admins get the full picture.
  if (req.user?.role !== "admin") {
    return res.status(status).json({
      redisReady: health.redisReady,
      queueReady: health.queueReady,
    });
  }
  res.status(status).json(health);
});
