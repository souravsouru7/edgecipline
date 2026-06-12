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

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read this image. Please upload a JPEG, PNG, or WEBP screenshot."));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Could not compress this image. Please try a JPEG or PNG screenshot."));
        return;
      }
      resolve(blob);
    }, type, quality);
  });
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

  const image = await loadImageFromFile(file);
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not process this image. Please try a JPEG or PNG screenshot.");
  }

  ctx.drawImage(image, 0, 0, width, height);

  let quality = 0.84;
  let blob = await canvasToBlob(canvas, "image/jpeg", quality);
  while (blob.size > targetBytes && quality > MIN_JPEG_QUALITY) {
    quality -= 0.08;
    blob = await canvasToBlob(canvas, "image/jpeg", quality);
  }

  if (blob.size > targetBytes) {
    throw new Error(`Image is still too large after compression (${(blob.size / 1024 / 1024).toFixed(1)} MB). Please crop the screenshot and try again.`);
  }

  return new File([blob], getOutputName(file.name), {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
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
