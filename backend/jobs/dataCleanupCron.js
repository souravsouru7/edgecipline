const Trade = require("../models/Trade");
const { appConfig } = require("../config");
const { logger } = require("../utils/logger");
const cloudinary = require("../config/cloudinary");

/**
 * Data Retention Policy Configuration
 * Defaults can be overridden via environment variables
 */
const RETENTION_POLICY = {
  rawOCRTextDays: appConfig.cleanup.rawOCRTextDays,
  aiRawResponseDays: appConfig.cleanup.aiRawResponseDays,
  imageCleanupDays: appConfig.cleanup.imageCleanupDays,
  // M8: Cap batch size to prevent a misconfigured env var from overwhelming the DB
  batchSize: Math.min(500, appConfig.cleanup.batchSize),
};

/**
 * Safe Cleanup Operation Results Tracker
 */
class CleanupStats {
  constructor() {
    this.startTime = Date.now();
    this.rawOCRTextCleaned = 0;
    this.aiRawResponseCleaned = 0;
    this.imagesDeleted = 0;
    this.errors = [];
    this.batchesProcessed = 0;
    this.totalRecordsScanned = 0;
  }

  get duration() {
    return Date.now() - this.startTime;
  }

  get summary() {
    return {
      duration: `${this.duration}ms`,
      batchesProcessed: this.batchesProcessed,
      totalRecordsScanned: this.totalRecordsScanned,
      rawOCRTextCleaned: this.rawOCRTextCleaned,
      aiRawResponseCleaned: this.aiRawResponseCleaned,
      imagesDeleted: this.imagesDeleted,
      errorsCount: this.errors.length,
      errors: this.errors.slice(0, 10), // First 10 errors only
    };
  }
}

/**
 * Check if a field should be cleaned based on age
 */
function isOlderThanDays(date, days) {
  if (!date) return false;
  const cutoffDate = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));
  return new Date(date) < cutoffDate;
}

/**
 * Extract Cloudinary public IDs from URL
 * Example: https://res.cloudinary.com/demo/image/upload/v1234567890/trades/abc123.png
 * Returns: trades/abc123.png
 */
function extractPublicIdFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  
  try {
    const match = url.match(/\/v\d+\/(.+)\.[a-z]+$/i);
    return match ? match[1] : null;
  } catch (error) {
    logger.error("Failed to extract public ID from URL", { url, error: error.message });
    return null;
  }
}

/**
 * Clean rawOCRText and aiRawResponse fields from old trade records
 */
async function cleanOldTradeData(stats) {
  const { rawOCRTextDays, aiRawResponseDays, batchSize } = RETENTION_POLICY;
  
  logger.info("Starting trade data cleanup", {
    rawOCRTextDays,
    aiRawResponseDays,
    batchSize,
  });

  let skip = 0;
  let hasMore = true;

  while (hasMore) {
    try {
      // Get batch of old trades
      const trades = await Trade.find({})
        .select("_id user rawOCRText aiRawResponse extractedText createdAt")
        .sort({ createdAt: 1 }) // Oldest first
        .skip(skip)
        .limit(batchSize)
        .lean();

      if (trades.length === 0) {
        hasMore = false;
        break;
      }

      stats.batchesProcessed += 1;
      stats.totalRecordsScanned += trades.length;

      // Process each trade in batch
      const updateOperations = [];
      
      for (const trade of trades) {
        try {
          const updates = {};
          
          // Check if rawOCRText should be cleaned
          if (rawOCRTextDays > 0 && trade.rawOCRText && isOlderThanDays(trade.createdAt, rawOCRTextDays)) {
            updates.rawOCRText = "";
          }
          
          // Check if aiRawResponse should be cleaned
          if (aiRawResponseDays > 0 && trade.aiRawResponse && isOlderThanDays(trade.createdAt, aiRawResponseDays)) {
            updates.aiRawResponse = "";
          }
          
          // If any fields need cleaning, add to batch update
          if (Object.keys(updates).length > 0) {
            updateOperations.push({
              updateOne: {
                filter: { _id: trade._id },
                update: { $set: updates },
              },
            });
            
            // Track what was cleaned
            if (updates.rawOCRText !== undefined) stats.rawOCRTextCleaned += 1;
            if (updates.aiRawResponse !== undefined) stats.aiRawResponseCleaned += 1;
          }
        } catch (error) {
          const errorMsg = `Failed to process trade ${trade._id}: ${error.message}`;
          logger.error(errorMsg, { tradeId: trade._id, error: error.message });
          stats.errors.push(errorMsg);
        }
      }

      // Execute batch updates if any
      if (updateOperations.length > 0) {
        // M12: ordered:false so a single doc error doesn't abort the whole batch
        const bulkResult = await Trade.bulkWrite(updateOperations, { ordered: false });
        if (bulkResult.hasWriteErrors && bulkResult.hasWriteErrors()) {
          bulkResult.getWriteErrors().forEach((e) => {
            const msg = `bulkWrite error for op ${e.index}: ${e.errmsg}`;
            logger.error(msg, { index: e.index, code: e.code });
            stats.errors.push(msg);
          });
        }
        logger.info(`Cleaned batch of ${updateOperations.length} trades`, {
          batchNumber: stats.batchesProcessed,
          operationsCount: updateOperations.length,
          writeErrors: bulkResult.hasWriteErrors ? bulkResult.hasWriteErrors() : false,
        });
      }

      skip += batchSize;
      
      // Small delay to prevent DB overload
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      const errorMsg = `Batch processing failed at skip=${skip}: ${error.message}`;
      logger.error(errorMsg, { skip, error: error.message, stack: error.stack });
      stats.errors.push(errorMsg);
      hasMore = false; // Stop on error to prevent data corruption
    }
  }

  logger.info("Trade data cleanup completed", {
    batchesProcessed: stats.batchesProcessed,
    totalRecordsScanned: stats.totalRecordsScanned,
    rawOCRTextCleaned: stats.rawOCRTextCleaned,
    aiRawResponseCleaned: stats.aiRawResponseCleaned,
  });
}

/**
 * Optionally delete old images from Cloudinary
 * WARNING: This is irreversible! Only enable if you're sure.
 */
async function cleanOldImages(stats) {
  const { imageCleanupDays, batchSize } = RETENTION_POLICY;
  
  if (imageCleanupDays <= 0) {
    logger.info("Image cleanup is disabled (CLEANUP_IMAGES_DAYS=0)");
    return;
  }

  logger.warn("Starting image cleanup from Cloudinary", {
    imageCleanupDays,
    warning: "This action is IRREVERSIBLE!",
  });

  let skip = 0;
  let hasMore = true;

  while (hasMore) {
    try {
      // Get batch of old trades with images
      const trades = await Trade.find({
        imageUrl: { $ne: "", $exists: true },
      })
        .select("_id imageUrl createdAt")
        .sort({ createdAt: 1 })
        .skip(skip)
        .limit(batchSize)
        .lean();

      if (trades.length === 0) {
        hasMore = false;
        break;
      }

      stats.batchesProcessed += 1;
      stats.totalRecordsScanned += trades.length;

      // Delete images older than threshold
      for (const trade of trades) {
        try {
          if (isOlderThanDays(trade.createdAt, imageCleanupDays)) {
            const publicId = extractPublicIdFromUrl(trade.imageUrl);
            
            if (publicId) {
              // Destroy image from Cloudinary
              await cloudinary.uploader.destroy(publicId);
              stats.imagesDeleted += 1;
              
              logger.info("Deleted old image from Cloudinary", {
                tradeId: trade._id,
                publicId,
                age: Math.floor((Date.now() - new Date(trade.createdAt)) / (24 * 60 * 60 * 1000)),
              });
              
              // Optional: Clear imageUrl from DB (commented out by default)
              // await Trade.findByIdAndUpdate(trade._id, { imageUrl: "" });
            }
          }
        } catch (error) {
          const errorMsg = `Failed to delete image for trade ${trade._id}: ${error.message}`;
          logger.error(errorMsg, { tradeId: trade._id, error: error.message });
          stats.errors.push(errorMsg);
        }
      }

      skip += batchSize;
      
      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 200));
      
    } catch (error) {
      const errorMsg = `Image batch processing failed at skip=${skip}: ${error.message}`;
      logger.error(errorMsg, { skip, error: error.message, stack: error.stack });
      stats.errors.push(errorMsg);
      hasMore = false;
    }
  }

  logger.info("Image cleanup completed", {
    imagesDeleted: stats.imagesDeleted,
    batchesProcessed: stats.batchesProcessed,
  });
}

const STUCK_PROCESSING_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Finds trades stuck in "processing" for longer than the threshold and marks
 * them failed. This recovers from server crashes between job enqueue and pickup.
 */
async function cleanStuckProcessingTrades(stats) {
  const cutoff = new Date(Date.now() - STUCK_PROCESSING_THRESHOLD_MS);

  try {
    const result = await Trade.updateMany(
      {
        status: "processing",
        processingStartedAt: { $lt: cutoff },
      },
      {
        $set: {
          status: "failed",
          error: "Processing timed out — please re-upload the screenshot.",
          processedAt: new Date(),
        },
      }
    );

    if (result.modifiedCount > 0) {
      logger.warn("Stuck processing trades cleaned up", {
        count: result.modifiedCount,
        cutoff: cutoff.toISOString(),
      });
    }
  } catch (error) {
    logger.error("Failed to clean stuck processing trades", { error: error.message });
    stats.errors.push(`Stuck trade cleanup failed: ${error.message}`);
  }
}

/**
 * Main cleanup job - runs all cleanup tasks
 */
async function runDataCleanupJob() {
  const stats = new CleanupStats();

  logger.info("=== DATA CLEANUP JOB STARTED ===", {
    policy: RETENTION_POLICY,
    startTime: new Date().toISOString(),
  });

  try {
    // Step 1: Recover trades stuck in processing (server crash / Redis loss)
    await cleanStuckProcessingTrades(stats);

    // Step 2: Clean old OCR and AI data
    await cleanOldTradeData(stats);

    // Step 3: Optionally clean old images
    if (RETENTION_POLICY.imageCleanupDays > 0) {
      await cleanOldImages(stats);
    }
    
    logger.info("=== DATA CLEANUP JOB COMPLETED SUCCESSFULLY ===", stats.summary);
    
    return {
      success: true,
      ...stats.summary,
    };
    
  } catch (error) {
    const errorMsg = `Cleanup job failed: ${error.message}`;
    logger.error(errorMsg, { error: error.message, stack: error.stack });
    stats.errors.push(errorMsg);
    
    return {
      success: false,
      error: error.message,
      ...stats.summary,
    };
  }
}

/**
 * Schedule the cleanup job to run daily
 */
function startDataCleanupCron() {
  const enabled = appConfig.cleanup.enabled;
  
  if (!enabled) {
    logger.info("Data cleanup cron job is disabled by ENABLE_DATA_CLEANUP_CRON");
    return;
  }

  // Default: Run daily at 3 AM (server time)
  // Low-traffic time to minimize impact
  const schedule = appConfig.cleanup.schedule;

  if (!require("node-cron").validate(schedule)) {
    throw new Error(`Invalid cleanup cron schedule: "${schedule}". Fix DATA_CLEANUP_CRON_SCHEDULE env var.`);
  }

  require("node-cron").schedule(schedule, () => {
    logger.info("Triggering scheduled data cleanup job");
    runDataCleanupJob().catch((e) => 
      logger.error("Scheduled cleanup job failed", { error: e.message, stack: e.stack })
    );
  });

  logger.info("Data cleanup cron job scheduled", {
    schedule,
    nextRun: "Daily at configured time",
  });
}

module.exports = {
  runDataCleanupJob,
  startDataCleanupCron,
  cleanOldTradeData,
  cleanOldImages,
  RETENTION_POLICY,
  CleanupStats,
};

