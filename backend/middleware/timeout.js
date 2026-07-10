const { appConfig } = require("../config");
const { logger } = require("../utils/logger");

/**
 * Global Timeout Configuration
 * Defaults can be overridden via environment variables
 */
const TIMEOUT_CONFIG = {
  apiTimeout: appConfig.timeouts.apiTimeout,
  ocrTimeout: appConfig.timeouts.ocrTimeout,
  aiTimeout: appConfig.timeouts.aiTimeout,
  dbTimeout: appConfig.timeouts.dbTimeout,
  externalApiTimeout: appConfig.timeouts.externalApiTimeout,
};

/**
 * Global Timeout Middleware
 * Applies timeout to all incoming requests
 * Prevents hanging requests and ensures system responsiveness
 */
function timeoutMiddleware(req, res, next) {
  const timeout = TIMEOUT_CONFIG.apiTimeout;
  const startTime = Date.now();
  let timedOut = false;

  // Create timeout timer (let so extendTimeout can reassign it)
  let timeoutTimer = setTimeout(() => {
    timedOut = true;
    
    const duration = Date.now() - startTime;
    
    logger.warn(`Request timeout | method=${req.method} | route=${req.originalUrl} | duration=${duration}ms`, {
      method: req.method,
      route: req.originalUrl,
      ip: req.ip,
      duration: `${duration}ms`,
      timeout: `${timeout}ms`,
      userAgent: req.get('user-agent'),
    });

    // Send timeout response if headers not already sent
    if (!res.headersSent) {
      res.status(408).json({
        message: "Request timeout, please try again",
        error: "REQUEST_TIMEOUT",
        timeout: `${timeout}ms`,
      });
    }
    // Tear down the underlying socket so the handler's outstanding DB queries
    // and external calls actually stop consuming resources after the client
    // has been told their request timed out. Without this, a slow handler
    // keeps running to completion off-screen.
    try { req.socket?.destroy(); } catch { /* ignore */ }
  }, timeout);

  // Clean up timeout when response finishes
  res.on('finish', () => {
    clearTimeout(timeoutTimer);
    
    const duration = Date.now() - startTime;
    if (timedOut) {
      logger.error(`Request timed out after response | method=${req.method} | route=${req.originalUrl} | duration=${duration}ms`, {
        method: req.method,
        route: req.originalUrl,
        duration: `${duration}ms`,
      });
    }
  });

  // Handle client abort
  req.on('aborted', () => {
    clearTimeout(timeoutTimer);
    logger.info(`Client aborted request | method=${req.method} | route=${req.originalUrl}`, {
      method: req.method,
      route: req.originalUrl,
    });
  });

  // Attach timeout info to request for downstream use
  req.timeoutConfig = {
    startTime,
    timeout,
    get remainingTime() {
      return Math.max(0, timeout - (Date.now() - startTime));
    },
    // Allow individual routes to extend the deadline before it fires.
    // Call req.timeoutConfig.extendTimeout(120_000) at the top of a slow handler.
    extendTimeout(newMs) {
      clearTimeout(timeoutTimer);
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        const duration = Date.now() - startTime;
        logger.warn(`Request timeout (extended) | method=${req.method} | route=${req.originalUrl} | duration=${duration}ms`);
        if (!res.headersSent) {
          res.status(408).json({
            message: "Request timeout, please try again",
            error: "REQUEST_TIMEOUT",
            timeout: `${newMs}ms`,
          });
        }
        try { req.socket?.destroy(); } catch { /* ignore */ }
      }, newMs);
    },
  };

  next();
}

/**
 * Create a promise that rejects after specified timeout
 * @param {Promise} promise - The promise to wrap
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} operationName - Name of operation for logging
 * @returns {Promise} - Wrapped promise with timeout
 */
async function withTimeout(promise, operationName, timeoutMs = TIMEOUT_CONFIG.externalApiTimeout) {
  const startTime = Date.now();
  
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        const duration = Date.now() - startTime;
        const error = new Error(`${operationName} timed out after ${duration}ms (limit: ${timeoutMs}ms)`);
        error.name = 'TimeoutError';
        error.code = 'ETIMEDOUT';
        error.duration = duration;
        
        logger.error(`${operationName} timeout`, {
          operation: operationName,
          duration: `${duration}ms`,
          timeout: `${timeoutMs}ms`,
        });
        
        reject(error);
      }, timeoutMs);
    }),
  ]);
}

/**
 * Wrap async function with timeout and automatic cleanup
 * @param {Function} fn - Async function to wrap
 * @param {string} operationName - Name of operation for logging
 * @param {number} timeoutMs - Custom timeout (optional)
 * @returns {Function} - Wrapped function
 */
function withTimeoutWrapper(fn, operationName, timeoutMs) {
  return async function(...args) {
    const timeout = timeoutMs || TIMEOUT_CONFIG[`${operationName.toLowerCase()}Timeout`] || TIMEOUT_CONFIG.externalApiTimeout;
    
    try {
      const result = await withTimeout(fn.apply(this, args), operationName, timeout);
      
      logger.debug(`${operationName} completed successfully`, {
        operation: operationName,
        duration: `${Date.now() - this.timeoutConfig?.startTime || 0}ms`,
      });
      
      return result;
    } catch (error) {
      if (error.name === 'TimeoutError') {
        logger.error(`${operationName} failed due to timeout`, {
          operation: operationName,
          error: error.message,
          duration: error.duration,
        });
      }
      throw error;
    }
  };
}

/**
 * Check if request has timed out
 * @param {Object} req - Express request object
 * @returns {boolean} - True if timed out
 */
function isTimedOut(req) {
  if (!req.timeoutConfig) return false;
  return req.timeoutConfig.remainingTime <= 0;
}

/**
 * Get remaining time for current request
 * @param {Object} req - Express request object
 * @returns {number} - Remaining time in milliseconds
 */
function getRemainingTime(req) {
  if (!req.timeoutConfig) return Infinity;
  return req.timeoutConfig.remainingTime;
}

module.exports = {
  timeoutMiddleware,
  withTimeout,
  withTimeoutWrapper,
  isTimedOut,
  getRemainingTime,
  TIMEOUT_CONFIG,
};
