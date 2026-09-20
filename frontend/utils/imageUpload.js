import { decodeToBitmap, calculateTargetSize, renderToBlob } from "@/utils/imageCompression";

// Strict pre-upload pass for OCR screenshots. Unlike compressImage() (which
// never throws and is used for evidence/support attachments), this one has a
// hard size ceiling because the OCR endpoint rejects anything above it, and
// it refuses formats the server cannot read rather than passing them through.
// The canvas pipeline itself is shared with imageCompression.js.

const TARGET_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1600;
const MIN_JPEG_QUALITY = 0.55;

const HEIC_RE = /\.(hei[cf])$/i;
const SUPPORTED_RE = /\.(jpe?g|png|webp)$/i;
const SUPPORTED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const HEIC_MIME_TYPES = new Set(["image/heic", "image/heif"]);

function isHeicFile(file) {
  const type = String(file?.type || "").toLowerCase();
  return HEIC_MIME_TYPES.has(type) || HEIC_RE.test(file?.name || "");
}

function hasSupportedImageType(file) {
  const type = String(file?.type || "").toLowerCase();
  return SUPPORTED_MIME_TYPES.has(type) || SUPPORTED_RE.test(file?.name || "");
}

function getOutputName(name = "trade-screenshot") {
  return String(name).replace(/\.[^.]+$/, "") + ".jpg";
}

export async function prepareImageForUpload(file, { targetBytes = TARGET_UPLOAD_BYTES } = {}) {
  if (!file) return file;

  if (isHeicFile(file)) {
    throw new Error("HEIC/HEIF screenshots are not supported yet. On Android, use a PNG/JPEG screenshot or change camera image format to JPEG.");
  }

  if (!hasSupportedImageType(file)) {
    throw new Error("Invalid file type. Please upload a JPEG, PNG, or WEBP screenshot.");
  }

  if (file.size <= targetBytes && SUPPORTED_MIME_TYPES.has(String(file.type || "").toLowerCase())) {
    return file;
  }

  if (typeof window === "undefined" || typeof document === "undefined") {
    return file;
  }

  let bitmap;
  try {
    bitmap = await decodeToBitmap(file);
  } catch {
    throw new Error("Could not read this image. Please upload a JPEG, PNG, or WEBP screenshot.");
  }

  try {
    const sourceWidth = bitmap.width ?? bitmap.naturalWidth;
    const sourceHeight = bitmap.height ?? bitmap.naturalHeight;
    if (!sourceWidth || !sourceHeight) {
      throw new Error("Could not process this image. Please try a JPEG or PNG screenshot.");
    }
    const { width, height } = calculateTargetSize(sourceWidth, sourceHeight, MAX_IMAGE_DIMENSION);

    // Step quality down until the encode fits the ceiling.
    let quality = 0.84;
    let blob = await renderToBlob(bitmap, width, height, quality);
    while (blob && blob.size > targetBytes && quality > MIN_JPEG_QUALITY) {
      quality -= 0.08;
      blob = await renderToBlob(bitmap, width, height, quality);
    }

    if (!blob) {
      throw new Error("Could not compress this image. Please try a JPEG or PNG screenshot.");
    }
    if (blob.size > targetBytes) {
      throw new Error(`Image is still too large after compression (${(blob.size / 1024 / 1024).toFixed(1)} MB). Please crop the screenshot and try again.`);
    }

    return new File([blob], getOutputName(file.name), {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } finally {
    if (typeof bitmap.close === "function") bitmap.close();
  }
}

export function validateSelectableImage(file, { maxSourceBytes = 12 * 1024 * 1024 } = {}) {
  if (!file) return null;
  if (isHeicFile(file)) {
    return "HEIC/HEIF screenshots are not supported yet. Please upload a PNG/JPEG screenshot.";
  }
  if (!hasSupportedImageType(file)) {
    return "Invalid file type. Please upload JPEG, PNG, or WEBP.";
  }
  if (file.size > maxSourceBytes) {
    return `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Please crop the screenshot and try again.`;
  }
  return null;
}
