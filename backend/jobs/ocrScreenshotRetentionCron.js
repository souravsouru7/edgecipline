const cron = require("node-cron");
const cloudinary = require("../config/cloudinary");
const { OCRJob } = require("../models/OCRJob");
const Trade = require("../models/Trade");
const IndianTrade = require("../models/IndianTrade");
const { logger } = require("../utils/logger");

/**
 * OCR screenshot retention sweep.
 *
 * OCRJob rows are removed by a MongoDB TTL index on `expiresAt` (24h). A TTL
 * delete fires no application hook, so the Cloudinary asset the row pointed at
 * would survive with nothing left in the database referencing it -- an
 * unreachable, publicly addressable screenshot that no cleanup path can ever
 * find again. This sweep deletes the asset shortly *before* the row expires,
 * while the link between the two still exists.
 *
 * Confirmed jobs are skipped: once a screenshot is saved as a trade, the Trade
 * document owns that asset and its own retention rules apply (see
 * jobs/dataCleanupCron.js). Every candidate is re-checked against both trade
 * collections before deletion, so a shared asset is never pulled out from
 * under a saved trade.
 */

// How far ahead of the TTL delete we sweep. Comfortably longer than the cron
// interval so a single missed run still leaves time to catch the row.
const LEAD_TIME_MS = Number(process.env.OCR_IMAGE_SWEEP_LEAD_MS || 2 * 60 * 60 * 1000);
const DEFAULT_SCHEDULE = process.env.OCR_IMAGE_SWEEP_CRON || "20 * * * *";
const BATCH_LIMIT = Math.min(500, Number(process.env.OCR_IMAGE_SWEEP_BATCH || 200));

async function isReferencedByTrade(imageUrl) {
  if (!imageUrl) return false;
  const query = { $or: [{ imageUrl }, { screenshot: imageUrl }] };
  const [forex, indian] = await Promise.all([
    Trade.exists(query),
    IndianTrade.exists(query),
  ]);
  return Boolean(forex || indian);
}

async function sweepExpiringOcrScreenshots({ limit = BATCH_LIMIT } = {}) {
  const cutoff = new Date(Date.now() + LEAD_TIME_MS);
  const stats = { scanned: 0, deleted: 0, skippedReferenced: 0, errors: 0 };

  const jobs = await OCRJob.find({
    status: { $ne: "CONFIRMED" },
    expiresAt: { $lte: cutoff },
    "uploadedImage.publicId": { $nin: ["", null] },
  })
    .select("_id user status uploadedImage expiresAt")
    .limit(limit)
    .lean();

  for (const job of jobs) {
    stats.scanned += 1;
    const publicId = job.uploadedImage?.publicId;
    if (!publicId) continue;

    try {
      if (await isReferencedByTrade(job.uploadedImage?.imageUrl)) {
        stats.skippedReferenced += 1;
        continue;
      }

      await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
      // Clearing the id makes the sweep idempotent -- a retry (or the cancel
      // path) will not try to destroy an already-deleted asset.
      await OCRJob.updateOne({ _id: job._id }, { $set: { "uploadedImage.publicId": "" } });
      stats.deleted += 1;
    } catch (error) {
      stats.errors += 1;
      logger.warn("Failed to delete expiring OCR screenshot", {
        jobId: job._id?.toString?.(),
        publicId,
        error: error.message,
      });
    }
  }

  if (stats.scanned > 0) {
    logger.info("OCR screenshot retention sweep finished", stats);
  }
  return stats;
}

function startOcrScreenshotRetentionCron(schedule = DEFAULT_SCHEDULE) {
  if (!cron.validate(schedule)) {
    throw new Error(`Invalid OCR image sweep schedule: "${schedule}". Fix OCR_IMAGE_SWEEP_CRON env var.`);
  }

  cron.schedule(schedule, () => {
    sweepExpiringOcrScreenshots().catch((error) =>
      logger.error("OCR screenshot retention sweep failed", {
        error: error.message,
        stack: error.stack,
      })
    );
  });

  logger.info("OCR screenshot retention sweep scheduled", { schedule, leadTimeMs: LEAD_TIME_MS });
}

module.exports = {
  sweepExpiringOcrScreenshots,
  startOcrScreenshotRetentionCron,
  LEAD_TIME_MS,
};
