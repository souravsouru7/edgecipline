const cloudinary = require("../config/cloudinary");
const { logger } = require("./logger");

// Insert a Cloudinary transformation segment into a delivery URL.
// Works for the canonical secure_url format produced by upload_stream:
//   https://res.cloudinary.com/<cloud>/image/upload/v123/<folder>/<id>.<ext>
function injectTransform(url, transform) {
  if (!url || typeof url !== "string") return "";
  const idx = url.indexOf("/upload/");
  if (idx === -1) return url;
  const before = url.slice(0, idx + 8); // includes "/upload/"
  const after  = url.slice(idx + 8);
  return `${before}${transform}/${after}`;
}

// Produce the standard variants for a trade evidence image.
// All three apply f_auto + q_auto so Cloudinary picks the best format/quality
// for the requesting client (saves bandwidth without us hardcoding format).
function buildImageVariants(url) {
  if (!url) return { thumbnailUrl: "", mediumUrl: "" };
  return {
    thumbnailUrl: injectTransform(url, "w_300,h_300,c_fill,q_auto,f_auto"),
    mediumUrl:    injectTransform(url, "w_800,c_limit,q_auto,f_auto"),
  };
}

// Extract the Cloudinary publicId from a delivery URL.
// Example: https://res.cloudinary.com/xx/image/upload/v123/trades/abc.jpg → trades/abc
function extractPublicId(url) {
  if (!url || typeof url !== "string") return "";
  const idx = url.indexOf("/upload/");
  if (idx === -1) return "";
  let path = url.slice(idx + 8);
  // Strip leading transformation segment (e.g. "w_300,c_fill/")
  if (/^[a-z]_[\w,.-]+\//i.test(path)) {
    path = path.replace(/^[a-z]_[\w,.-]+\//i, "");
  }
  // Strip leading version segment "v123/"
  path = path.replace(/^v\d+\//, "");
  // Strip file extension
  path = path.replace(/\.[a-zA-Z0-9]+$/, "");
  return path;
}

// Best-effort Cloudinary deletion. Never throws — failures are logged.
// Use for trade delete cleanup so a Cloudinary outage doesn't poison the
// trade lifecycle.
async function destroyImage(publicIdOrUrl) {
  if (!publicIdOrUrl) return false;
  const publicId = publicIdOrUrl.includes("/upload/")
    ? extractPublicId(publicIdOrUrl)
    : publicIdOrUrl;
  if (!publicId) return false;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
    return true;
  } catch (err) {
    logger.warn("Cloudinary destroy failed", { publicId, error: err.message });
    return false;
  }
}

// Bulk destroy — runs in parallel with concurrency cap to avoid Cloudinary throttling.
async function destroyImages(items) {
  if (!Array.isArray(items) || items.length === 0) return { destroyed: 0, failed: 0 };
  const targets = items
    .map(it => (typeof it === "string" ? it : it?.publicId || it?.url))
    .filter(Boolean);

  const CONCURRENCY = 5;
  let destroyed = 0;
  let failed = 0;

  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const chunk = targets.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(chunk.map(destroyImage));
    results.forEach(r => {
      if (r.status === "fulfilled" && r.value) destroyed += 1;
      else failed += 1;
    });
  }

  return { destroyed, failed };
}

module.exports = {
  injectTransform,
  buildImageVariants,
  extractPublicId,
  destroyImage,
  destroyImages,
};
