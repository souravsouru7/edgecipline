const { appConfig } = require("../config");
const { logger } = require("../utils/logger");
const { withTimeout: raceWithTimeout } = require("../utils/withTimeout");

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
 * Answer 408, then close the connection — in that order.
 *
 * The socket used to be destroyed on the same tick the 408 was written, which
 * could drop the response before it left the server: the phone saw silence,
 * sat out its own 20s timeout and showed "Request timed out" with no hint the
 * server had answered. Now the socket closes once the 408 is flushed (or after
 * a short grace period). Closing it still stops a slow handler's outstanding
 * work from holding the connection.
 *
 * res.locals.requestTimedOut lets the idempotency middleware tell this 408
 * apart from a handler failure: the handler may still be about to commit, so
 * its claim must survive for a retry to replay the real result.
 */
const SOCKET_CLOSE_GRACE_MS = 1000;

function respondTimedOut(req, res, timeoutMs) {
  res.locals.requestTimedOut = true;
  const destroySocket = () => {
    try { req.socket?.destroy(); } catch { /* ignore */ }
  };

  if (res.headersSent) {
    destroySocket();
    return;
  }

  res.once("finish", destroySocket);
  const fallback = setTimeout(destroySocket, SOCKET_CLOSE_GRACE_MS);
  fallback.unref?.();
  res.status(408).json({
    message: "Request timeout, please try again",
    error: "REQUEST_TIMEOUT",
    timeout: `${timeoutMs}ms`,
  });
}

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

    respondTimedOut(req, res, timeout);
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
        respondTimedOut(req, res, newMs);
      }, newMs);
    },
  };

  next();
}

// Shared with every service that races an external call; see utils/withTimeout.
function withTimeout(promise, operationName, timeoutMs = TIMEOUT_CONFIG.externalApiTimeout) {
  return raceWithTimeout(promise, operationName, timeoutMs);
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
