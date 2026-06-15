"use client";

// Canvas-based image compression. Zero dependencies. Runs in any modern
// browser including Capacitor WebView on Android (Chromium) and iOS
// (WKWebView). Falls back to the original File on any failure path.

const DEFAULTS = {
  maxDimension: 1280,
  quality:      0.75,
  // Skip compression for files already smaller than this — adding a
  // canvas pass on a 300 KB image often costs more than it saves.
  minBytesToCompress: 800 * 1024,        // 800 KB
  // Hard ceiling on input dimensions. Above this we still try, but log
  // so operators can spot anomalous uploads (medical-grade screenshots etc).
  warnIfWiderThan: 4000,
  // Only image MIME types — PDFs and other non-image uploads pass through
  // untouched.
  compressibleTypes: new Set([
    "image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif",
  ]),
};

function pickOutputExtension(originalName, originalType) {
  // Always output JPEG regardless of input. Strip original extension; add .jpg.
  const base = String(originalName || "image").replace(/\.[^.]+$/, "");
  return `${base}.jpg`;
}

async function decodeToBitmap(file) {
  // createImageBitmap is the fastest path and works on Capacitor Android
  // and iOS WebView. Falls back to HTMLImageElement if unavailable.
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // fall through to HTMLImageElement decode
    }
  }
  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

function calculateTargetSize(width, height, maxDimension) {
  if (width <= maxDimension && height <= maxDimension) {
    return { width, height, scaled: false };
  }
  if (width >= height) {
    const scale = maxDimension / width;
    return {
      width:  maxDimension,
      height: Math.round(height * scale),
      scaled: true,
    };
  }
  const scale = maxDimension / height;
  return {
    width:  Math.round(width * scale),
    height: maxDimension,
    scaled: true,
  };
}

async function renderToBlob(source, targetWidth, targetHeight, quality) {
  // Prefer OffscreenCanvas — it doesn't block the main thread layout pipeline.
  if (typeof OffscreenCanvas === "function") {
    try {
      const canvas = new OffscreenCanvas(targetWidth, targetHeight);
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(source, 0, 0, targetWidth, targetHeight);
      return await canvas.convertToBlob({ type: "image/jpeg", quality });
    } catch {
      // Fall through to HTMLCanvasElement.
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, targetWidth, targetHeight);
  return await new Promise((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", quality);
  });
}

/**
 * Compress an image File for upload.
 *
 * Behaviour:
 *   - PDFs / non-image MIME types        → returned untouched.
 *   - Image files already < 800 KB       → returned untouched.
 *   - Image files >= 800 KB              → resized to max 1280px on the
 *                                          long edge, JPEG q=0.75. If the
 *                                          compressed result is LARGER than
 *                                          the original (rare; small icons),
 *                                          we return the original.
 *   - Any error                          → original file (never blocks the
 *                                          upload — degraded mode is OK).
 *
 * Returns: { file, originalSize, compressedSize, compressionRatio, skipped, reason }
 */
/**
 * Compress an array of image files one at a time (low-memory friendly).
 *
 * Sequential is intentional: parallel canvas decodes can OOM on older Android
 * devices. The throughput cost is small (compression is fast vs. upload).
 *
 * @returns {Promise<File[]>} array of compressed File objects in the same order
 */
export async function compressImages(files, options = {}) {
  if (!Array.isArray(files) || files.length === 0) return [];
  const results = [];
  for (const f of files) {
    try {
      const out = await compressImage(f, options);
      results.push(out?.file || f);
    } catch {
      results.push(f);
    }
  }
  return results;
}

export async function compressImage(file, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const originalSize = file?.size || 0;

  if (!file || !(file instanceof Blob)) {
    return { file, originalSize, compressedSize: originalSize, compressionRatio: 1, skipped: true, reason: "not_a_file" };
  }

  if (!opts.compressibleTypes.has(String(file.type || "").toLowerCase())) {
    return { file, originalSize, compressedSize: originalSize, compressionRatio: 1, skipped: true, reason: "non_image_type" };
  }

  if (originalSize < opts.minBytesToCompress) {
    return { file, originalSize, compressedSize: originalSize, compressionRatio: 1, skipped: true, reason: "already_small" };
  }

  let bitmap;
  try {
    bitmap = await decodeToBitmap(file);
  } catch (error) {
    return {
      file,
      originalSize,
      compressedSize: originalSize,
      compressionRatio: 1,
      skipped: true,
      reason: "decode_failed",
      error: error?.message || String(error),
    };
  }

  const sourceWidth  = bitmap.width  ?? bitmap.naturalWidth;
  const sourceHeight = bitmap.height ?? bitmap.naturalHeight;
  if (!sourceWidth || !sourceHeight) {
    if (typeof bitmap.close === "function") bitmap.close();
    return { file, originalSize, compressedSize: originalSize, compressionRatio: 1, skipped: true, reason: "no_dimensions" };
  }

  const { width, height, scaled } = calculateTargetSize(sourceWidth, sourceHeight, opts.maxDimension);

  let blob;
  try {
    blob = await renderToBlob(bitmap, width, height, opts.quality);
  } catch (error) {
    if (typeof bitmap.close === "function") bitmap.close();
    return {
      file,
      originalSize,
      compressedSize: originalSize,
      compressionRatio: 1,
      skipped: true,
      reason: "render_failed",
      error: error?.message || String(error),
    };
  } finally {
    if (typeof bitmap.close === "function") bitmap.close();
  }

  if (!blob) {
    return { file, originalSize, compressedSize: originalSize, compressionRatio: 1, skipped: true, reason: "blob_null" };
  }

  // If the canvas re-encode produced a larger blob (sometimes happens with
  // already-optimal JPEGs), keep the original.
  if (blob.size >= originalSize) {
    return { file, originalSize, compressedSize: originalSize, compressionRatio: 1, skipped: true, reason: "no_size_win" };
  }

  const compressed = new File(
    [blob],
    pickOutputExtension(file.name, file.type),
    { type: "image/jpeg", lastModified: Date.now() }
  );

  return {
    file:             compressed,
    originalSize,
    compressedSize:   compressed.size,
    compressionRatio: Number((originalSize / compressed.size).toFixed(2)),
    skipped:          false,
    scaled,
    targetWidth:      width,
    targetHeight:     height,
    sourceWidth,
    sourceHeight,
  };
}
