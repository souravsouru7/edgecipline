const asyncHandler = require("../utils/asyncHandler");
const uploadService = require("../services/upload.service");

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

exports.getUploadJobStatus = asyncHandler(async (req, res) => {
  const jobStatus = await uploadService.getUploadJobStatus(req.user._id, req.params.id);
  res.json(jobStatus);
});

exports.cancelUploadJob = asyncHandler(async (req, res) => {
  const jobStatus = await uploadService.cancelUploadJob(req.user._id, req.params.id);
  res.json(jobStatus);
});

exports.getUploadQueueHealth = asyncHandler(async (_req, res) => {
  const health = await uploadService.getUploadQueueHealth();
  res.status(health.queueReady ? 200 : 503).json(health);
});
