"use strict";

const { logger } = require("./logger");

/**
 * Race `promise` against a deadline.
 *
 * One implementation for every external call (Gemini, Vision, Tesseract,
 * Resend/SMTP, image downloads). Guarantees, in order of how much they have
 * bitten us before:
 *
 *   - The timer is cleared when the promise settles first, so a fast call
 *     does not keep the event loop alive for the full deadline.
 *   - The original promise gets a no-op catch. Without it, a Gemini call that
 *     keeps running past the deadline eventually rejects with nothing
 *     listening, which is an unhandled rejection that crashes the worker and
 *     triggers a PM2 restart.
 *   - The rejection carries `name: "TimeoutError"` and `code: "ETIMEDOUT"` so
 *     callers can classify it without parsing the message.
 *
 * @param {Promise} promise
 * @param {string} operationName  used in the error message and log line
 * @param {number} timeoutMs
 */
function withTimeout(promise, operationName, timeoutMs) {
  const startTime = Date.now();
  let timer;

  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const duration = Date.now() - startTime;
      const error = new Error(`${operationName} timed out after ${duration}ms (limit: ${timeoutMs}ms)`);
      error.name = "TimeoutError";
      error.code = "ETIMEDOUT";
      error.duration = duration;

      logger.error(`${operationName} timeout`, {
        operation: operationName,
        duration: `${duration}ms`,
        timeout: `${timeoutMs}ms`,
      });

      reject(error);
    }, timeoutMs);
  });

  Promise.resolve(promise).catch(() => {});
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

module.exports = { withTimeout };
