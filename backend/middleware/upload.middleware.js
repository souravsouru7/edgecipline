const multer = require("multer");
const path = require("path");
const { PassThrough } = require("stream");
const cloudinary = require("../config/cloudinary");
const { appConfig } = require("../config");
const { logger } = require("../utils/logger");

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const HEIC_MIME_TYPES = new Set(["image/heic", "image/heif"]);

function sanitizeFilename(name) {
  return String(name || "").replace(/[^\x20-\x7E]/g, "?").slice(0, 255);
}

// Magic byte signatures for allowed image types.
// Checks the actual file content — not the client-supplied filename or Content-Type header.
const MAGIC_BYTES = [
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/png",  bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: "image/webp", bytes: null, check: (buf) => buf.length >= 12 && buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP" },
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

function isAllowedImage(file) {
  const ext = path.extname(file.originalname || "").toLowerCase();
  const hasAllowedExt = [".jpg", ".jpeg", ".png", ".webp"].includes(ext);
  return hasAllowedExt && ALLOWED_MIME_TYPES.has(file.mimetype);
}

function isHeicImage(file) {
  const ext = path.extname(file.originalname || "").toLowerCase();
  return [".heic", ".heif"].includes(ext) || HEIC_MIME_TYPES.has(String(file.mimetype || "").toLowerCase());
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

      // Buffer the first 12 bytes to verify magic bytes before streaming the rest to Cloudinary.
      const chunks = [];
      let headerChecked = false;
      const passThrough = new PassThrough();

      file.stream.on("data", (chunk) => {
        if (!headerChecked) {
          chunks.push(chunk);
          const combined = Buffer.concat(chunks);
          if (combined.length >= 12) {
            headerChecked = true;
            const detectedMime = detectMagicBytes(combined);
            if (!detectedMime) {
              file.stream.destroy();
              return done(new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname));
            }
            passThrough.write(combined);
          }
        } else {
          passThrough.write(chunk);
        }
      });

      file.stream.on("end", () => {
        if (!headerChecked) {
          // File was smaller than 12 bytes — definitely not a valid image
          return done(new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname));
        }
        passThrough.end();
      });

      file.stream.on("error", (error) => passThrough.destroy(error));

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
            return done(error);
          }

          return done(null, {
            path: result.secure_url,
            imageUrl: result.secure_url,
            publicId: result.public_id,
            bytes: result.bytes,
            format: result.format,
            originalname: sanitizeFilename(file.originalname),
            mimetype: file.mimetype,
          });
        }
      );

      passThrough.once("limit", () => {
        uploadStream.destroy(new multer.MulterError("LIMIT_FILE_SIZE", file.fieldname));
      });

      passThrough.once("error", (error) => uploadStream.destroy(error));
      uploadStream.once("error", (error) => done(error));

      passThrough.pipe(uploadStream);
      return undefined;
    },

    _removeFile(_req, file, cb) {
      if (!file.publicId) {
        cb(null);
        return;
      }

      cloudinary.uploader.destroy(file.publicId, { resource_type: "image" })
        .then(() => cb(null))
        .catch((error) => cb(error));
    },
  };
}

function createCloudinaryUpload(folderName) {
  return multer({
    storage: createCloudinaryStorage(folderName),
    limits: {
      fileSize: appConfig.upload.maxFileSizeBytes,
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

  return error?.message || "Image upload failed.";
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

      return res.status(400).json({
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
          }
        : null;

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

module.exports = {
  createUploadMiddleware,
  uploadFeedbackScreenshot,
  uploadSetupReferenceImage,
  uploadTradeImage,
};
