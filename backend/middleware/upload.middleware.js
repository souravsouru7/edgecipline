const multer = require("multer");
const path = require("path");
const crypto = require("crypto");
const sharp = require("sharp");
const cloudinary = require("../config/cloudinary");
const { appConfig } = require("../config");
const { logger } = require("../utils/logger");

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const HEIC_MIME_TYPES = new Set(["image/heic", "image/heif"]);
const CLOUDINARY_CONNECTIVITY_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);

function sanitizeFilename(name) {
  return String(name || "").replace(/[^\x20-\x7E]/g, "?").slice(0, 255);
}

const MAGIC_BYTES = [
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47] },
  {
    mime: "image/webp",
    bytes: null,
    check: (buf) =>
      buf.length >= 12 &&
      buf.slice(0, 4).toString() === "RIFF" &&
      buf.slice(8, 12).toString() === "WEBP",
  },
];

function detectMagicBytes(buffer) {
  for (const sig of MAGIC_BYTES) {
    if (sig.check) {
      if (sig.check(buffer)) return sig.mime;
    } else if (buffer.length >= sig.bytes.length) {
      if (sig.bytes.every((b, i) => buffer[i] === b)) return sig.mime;
    }
  }
  return null;
}

// Rejections that carry their own user-facing wording. Kept distinct from
// MulterError so formatUploadError can pass the message through untouched.
function createUploadError(message, code) {
  const error = new Error(message);
  error.uploadCode = code;
  return error;
}

// Everything the magic-byte sniff can't catch: an empty part, a header that
// claims more pixels than we will ever decode, and a file whose header is a
// valid PNG/JPEG but whose pixel data is truncated or garbage. Without the
// decode pass a corrupted screenshot is stored, queued, charged against the
// user's allowance and only "explained" minutes later by the OCR pipeline.
async function assertDecodableImage(buffer) {
  if (buffer.length === 0) {
    throw createUploadError(
      "This file is empty. Please upload a valid screenshot.",
      "EMPTY_FILE"
    );
  }

  if (!detectMagicBytes(buffer)) {
    throw new multer.MulterError("LIMIT_UNEXPECTED_FILE", "file");
  }

  const maxPixels = appConfig.upload.maxImagePixels;

  let metadata;
  try {
    // Header read only — cheap, and it happens before anything allocates a
    // raster, so a decompression bomb is rejected without being decoded.
    metadata = await sharp(buffer, { limitInputPixels: false }).metadata();
  } catch {
    throw createUploadError(
      "This image appears to be corrupted or incomplete. Please re-take the screenshot and try again.",
      "CORRUPT_IMAGE"
    );
  }

  const width = Number(metadata?.width || 0);
  const height = Number(metadata?.height || 0);
  if (!width || !height) {
    throw createUploadError(
      "This image appears to be corrupted or incomplete. Please re-take the screenshot and try again.",
      "CORRUPT_IMAGE"
    );
  }

  if (width * height > maxPixels) {
    throw createUploadError(
      `Image is too large to process (${width}x${height}). Please upload a normal screenshot.`,
      "IMAGE_DIMENSIONS_TOO_LARGE"
    );
  }

  try {
    // Full decode, bounded by the same ceiling. A truncated PNG passes the
    // header check above and only fails here.
    await sharp(buffer, { failOn: "error", limitInputPixels: maxPixels })
      .resize(32, 32, { fit: "inside" })
      .raw()
      .toBuffer();
  } catch {
    throw createUploadError(
      "This image appears to be corrupted or incomplete. Please re-take the screenshot and try again.",
      "CORRUPT_IMAGE"
    );
  }
}

function isCloudinaryConnectivityError(error) {
  const codes = [
    error?.code,
    error?.errno,
    error?.cause?.code,
    error?.error?.code,
  ].filter(Boolean);

  if (codes.some((code) => CLOUDINARY_CONNECTIVITY_CODES.has(String(code)))) {
    return true;
  }

  const message = String(error?.message || "");
  return /api\.cloudinary\.com/i.test(message) && /getaddrinfo|ENOTFOUND|EAI_AGAIN|timeout|network/i.test(message);
}

function isAllowedImage(file) {
  const ext = path.extname(file.originalname || "").toLowerCase();
  const hasAllowedExt = [".jpg", ".jpeg", ".png", ".webp"].includes(ext);
  return hasAllowedExt && ALLOWED_MIME_TYPES.has(file.mimetype);
}

function isHeicImage(file) {
  const ext = path.extname(file.originalname || "").toLowerCase();
  return [".heic", ".heif"].includes(ext) || HEIC_MIME_TYPES.has(String(file.mimetype || "").toLowerCase());
}

function uploadBufferToCloudinary(buffer, folderName) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: folderName,
        resource_type: "image",
        secure: true,
        unique_filename: true,
        use_filename: false,
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      }
    );

    uploadStream.once("error", reject);
    uploadStream.end(buffer);
  });
}

async function removeUploadedFile(file) {
  if (file?.publicId) {
    await cloudinary.uploader.destroy(file.publicId, { resource_type: "image" });
  }
}

function createCloudinaryStorage(folderName) {
  return {
    _handleFile(_req, file, cb) {
      if (!isAllowedImage(file)) {
        if (isHeicImage(file)) {
          const error = new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname);
          error.message = "HEIC/HEIF images are not supported. Please upload a JPEG, PNG, or WEBP screenshot.";
          return cb(error);
        }
        return cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname));
      }

      let settled = false;
      const done = (error, payload) => {
        if (settled) return;
        settled = true;
        cb(error, payload);
      };

      const chunks = [];
      let limited = false;

      file.stream.once("limit", () => {
        limited = true;
      });

      file.stream.on("data", (chunk) => {
        if (!limited) chunks.push(chunk);
      });

      file.stream.on("end", async () => {
        if (limited) {
          return done(new multer.MulterError("LIMIT_FILE_SIZE", file.fieldname));
        }

        const buffer = Buffer.concat(chunks);
        try {
          await assertDecodableImage(buffer);
        } catch (error) {
          if (error instanceof multer.MulterError) {
            error.field = file.fieldname;
          }
          return done(error);
        }

        const imageHash = crypto.createHash("sha256").update(buffer).digest("hex");

        try {
          const result = await uploadBufferToCloudinary(buffer, folderName);
          return done(null, {
            path: result.secure_url,
            imageUrl: result.secure_url,
            publicId: result.public_id,
            bytes: result.bytes,
            format: result.format,
            originalname: sanitizeFilename(file.originalname),
            mimetype: file.mimetype,
            storageProvider: "cloudinary",
            imageHash,
          });
        } catch (error) {
          return done(error);
        }
      });

      file.stream.on("error", (error) => done(error));
      return undefined;
    },

    _removeFile(_req, file, cb) {
      removeUploadedFile(file)
        .then(() => cb(null))
        .catch((error) => cb(error));
    },
  };
}

function createCloudinaryUpload(folderName) {
  return multer({
    storage: createCloudinaryStorage(folderName),
    limits: {
      // busboy trips its limit at `fileSize`, not above it, so passing the
      // configured maximum verbatim rejects a file of exactly that size —
      // the size the UI and the client-side compressor both advertise as OK.
      fileSize: appConfig.upload.maxFileSizeBytes + 1,
      files: 1,
      fields: 20,
      parts: 25,
    },
    fileFilter: (_req, file, cb) => {
      if (!isAllowedImage(file)) {
        if (isHeicImage(file)) {
          const error = new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname);
          error.message = "HEIC/HEIF images are not supported. Please upload a JPEG, PNG, or WEBP screenshot.";
          return cb(error);
        }
        return cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname));
      }

      return cb(null, true);
    },
  });
}

function formatUploadError(error) {
  if (error?.uploadCode) {
    return error.message;
  }

  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return `File too large. Max allowed size is ${Math.floor(appConfig.upload.maxFileSizeBytes / (1024 * 1024))}MB.`;
    }

    if (error.code === "LIMIT_UNEXPECTED_FILE") {
      if (/HEIC|HEIF/i.test(error.message || "")) {
        return error.message;
      }
      return "Invalid file type. Only JPEG, PNG, and WEBP images are allowed.";
    }

    return "Invalid file upload request.";
  }

  if (isCloudinaryConnectivityError(error)) {
    return "Image storage is temporarily unavailable. Check internet/DNS access to Cloudinary and try again.";
  }

  return error?.message || "Image upload failed.";
}

function getUploadErrorStatus(error) {
  return isCloudinaryConnectivityError(error) ? 503 : 400;
}

function createUploadMiddleware({ fieldName, folderName, required = true }) {
  const cloudinaryUpload = createCloudinaryUpload(folderName);

  return (req, res, next) => {
    cloudinaryUpload.single(fieldName)(req, res, (error) => {
      if (error) {
        logger.warn("Image upload rejected", {
          path: req.originalUrl,
          method: req.method,
          error: error.message,
          code: error.code,
          filename: sanitizeFilename(req.file?.originalname || ""),
        });

        return res.status(getUploadErrorStatus(error)).json({
          status: "error",
          message: formatUploadError(error),
        });
      }

      if (required && !req.file?.path) {
        return res.status(400).json({
          status: "error",
          message: "Image file is required.",
        });
      }

      req.uploadedImage = req.file?.path
        ? {
            imageUrl: req.file.path,
            publicId: req.file.publicId,
            bytes: req.file.bytes,
            format: req.file.format,
            originalName: req.file.originalname,
            mimeType: req.file.mimetype,
            storageProvider: req.file.storageProvider,
            imageHash: req.file.imageHash || "",
          }
        : null;

      return next();
    });
  };
}

const MAX_SETUP_IMAGES = 20;

function createMultiUploadMiddleware({
  fieldName,
  maxCount,
  folderName,
  fileSizeBytes,
  optional = false,
}) {
  const upload = multer({
    storage: createCloudinaryStorage(folderName),
    limits: {
      fileSize: (fileSizeBytes || appConfig.upload.maxFileSizeBytes) + 1,
      files: maxCount,
      fields: 20,
      parts: maxCount + 20,
    },
    fileFilter: (_req, file, cb) => {
      if (!isAllowedImage(file)) {
        if (isHeicImage(file)) {
          const error = new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname);
          error.message = "HEIC/HEIF images are not supported. Please upload a JPEG, PNG, or WEBP screenshot.";
          return cb(error);
        }
        return cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname));
      }
      return cb(null, true);
    },
  });

  return (req, res, next) => {
    upload.array(fieldName, maxCount)(req, res, (error) => {
      if (error) {
        logger.warn("Multi-image upload rejected", {
          path: req.originalUrl,
          method: req.method,
          error: error.message,
          code: error.code,
        });

        const successfulFiles = Array.isArray(req.files) ? req.files : [];
        if (successfulFiles.length > 0) {
          Promise.all(
            successfulFiles
              .filter((f) => f.publicId)
              .map((f) =>
                removeUploadedFile(f).catch((destroyErr) =>
                  logger.warn("Failed to clean up partial upload", {
                    publicId: f.publicId,
                    error: destroyErr.message,
                  })
                )
              )
          ).catch(() => {});
        }

        return res.status(getUploadErrorStatus(error)).json({
          status: "error",
          message: formatUploadError(error),
        });
      }

      if (!req.files?.length) {
        if (optional) {
          req.uploadedImages = [];
          return next();
        }
        return res.status(400).json({
          status: "error",
          message: "At least one image file is required.",
        });
      }

      req.uploadedImages = req.files.map((f) => ({
        imageUrl: f.path,
        publicId: f.publicId,
        bytes: f.bytes,
        format: f.format,
        originalName: sanitizeFilename(f.originalname),
        mimeType: f.mimetype,
        storageProvider: f.storageProvider,
      }));

      return next();
    });
  };
}

const uploadTradeImage = createUploadMiddleware({
  fieldName: "image",
  folderName: "trades",
  required: true,
});

const uploadFeedbackScreenshot = createUploadMiddleware({
  fieldName: "screenshot",
  folderName: "feedback",
  required: false,
});

const uploadSetupReferenceImage = createUploadMiddleware({
  fieldName: "image",
  folderName: "setup-references",
  required: true,
});

const uploadSetupReferenceImages = createMultiUploadMiddleware({
  fieldName: "images",
  maxCount: MAX_SETUP_IMAGES,
  folderName: "setup-references",
});

const MAX_TRADE_EVIDENCE_IMAGES = 20;
const MAX_ISSUE_REPORT_IMAGES = 8;

const uploadTradeEvidenceImages = createMultiUploadMiddleware({
  fieldName: "tradeImages",
  maxCount: MAX_TRADE_EVIDENCE_IMAGES,
  folderName: "trade-evidence",
  fileSizeBytes: 5 * 1024 * 1024,
});

const uploadIssueReportImages = createMultiUploadMiddleware({
  fieldName: "screenshots",
  maxCount: MAX_ISSUE_REPORT_IMAGES,
  folderName: "issue-reports",
  fileSizeBytes: 3 * 1024 * 1024,
  optional: true,
});

module.exports = {
  createUploadMiddleware,
  createMultiUploadMiddleware,
  uploadFeedbackScreenshot,
  uploadSetupReferenceImage,
  uploadSetupReferenceImages,
  uploadTradeEvidenceImages,
  uploadTradeImage,
  uploadIssueReportImages,
  MAX_ISSUE_REPORT_IMAGES,
};
