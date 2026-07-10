const { logger } = require('./logger');

const MAX_TRACKED_JOBS = 10_000;
const MAX_ERROR_MESSAGE_LENGTH = 1000;
const MAX_ERROR_STACK_LENGTH = 4000;
const MAX_IDENTIFIER_LENGTH = 200;

function truncate(value, maxLength) {
  return String(value || "").slice(0, maxLength);
}

function serializeError(error) {
  return {
    name: truncate(error?.name || "Error", 100),
    message: truncate(error?.message || error, MAX_ERROR_MESSAGE_LENGTH),
    stack: truncate(error?.stack, MAX_ERROR_STACK_LENGTH),
  };
}

// In-memory failure tracking (for production, consider Redis)
const jobFailureTracker = {
  failures: new Map(), // jobId -> { count, lastError, timestamps }
  maxFailures: 5,
  maxTrackedJobs: MAX_TRACKED_JOBS,
  
  recordFailure(jobId, error, tradeId) {
    const now = Date.now();
    const safeJobId = truncate(jobId, MAX_IDENTIFIER_LENGTH);
    const safeTradeId = truncate(tradeId, MAX_IDENTIFIER_LENGTH);
    const safeError = serializeError(error);
    this.cleanup(now);
    const existing = this.failures.get(safeJobId);
    
    if (existing) {
      existing.lastError = safeError;
      existing.timestamps.push(now);
      existing.timestamps = existing.timestamps.slice(-this.maxFailures);
      existing.count = existing.timestamps.length;
      this.failures.delete(safeJobId);
      this.failures.set(safeJobId, existing);
      
      logger.warn(`Job repeated failure | jobId=${safeJobId} | tradeId=${safeTradeId} | count=${existing.count}`, {
        error: safeError.message,
        stack: safeError.stack,
        tradeId: safeTradeId,
        jobId: safeJobId,
        timestamp: new Date().toISOString(),
      });
      
      if (existing.count >= this.maxFailures) {
        logger.error(`Job exceeded max failures | jobId=${safeJobId} | tradeId=${safeTradeId}`, {
          totalFailures: existing.count,
          error: safeError.message,
        });
      }
    } else {
      while (this.failures.size >= this.maxTrackedJobs) {
        this.failures.delete(this.failures.keys().next().value);
      }
      this.failures.set(safeJobId, {
        count: 1,
        lastError: safeError,
        timestamps: [now],
        tradeId: safeTradeId,
      });
      
      logger.error(`Job failed | jobId=${safeJobId} | tradeId=${safeTradeId}`, {
        error: safeError.message,
        stack: safeError.stack,
        timestamp: new Date().toISOString(),
      });
    }
  },
  
  getFailureCount(jobId) {
    return this.failures.get(truncate(jobId, MAX_IDENTIFIER_LENGTH))?.count || 0;
  },
  
  isRepeatedFailure(jobId) {
    return this.getFailureCount(jobId) > 1;
  },
  
  cleanup(now = Date.now()) {
    const oneDayAgo = now - (24 * 60 * 60 * 1000);
    for (const [jobId, data] of this.failures.entries()) {
      data.timestamps = data.timestamps.filter(ts => ts > oneDayAgo);
      data.count = data.timestamps.length;
      if (data.timestamps.length === 0) {
        this.failures.delete(jobId);
      }
    }
  },
  
  getStats() {
    const totalTracked = this.failures.size;
    const repeatedFailures = Array.from(this.failures.values())
      .filter(data => data.count > 1).length;
    
    return {
      totalTracked,
      repeatedFailures,
      criticalJobs: Array.from(this.failures.entries())
        .filter(([_, data]) => data.count >= this.maxFailures)
        .map(([jobId, data]) => ({ jobId, count: data.count, tradeId: data.tradeId })),
    };
  },
};

module.exports = { jobFailureTracker };
