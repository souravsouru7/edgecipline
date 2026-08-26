class ApiError extends Error {
  /**
   * @param {boolean} expose  5xx messages are masked as "Something went wrong"
   *   by the error handler, because most of them carry internal detail. Set
   *   this for a 5xx the app raises deliberately with wording written for the
   *   user (e.g. "the queue is temporarily unavailable, try again"), where
   *   hiding the message leaves them with no idea what to do next.
   */
  constructor(statusCode, message, errorCode = "INTERNAL_ERROR", details = null, expose = false) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
    this.expose = expose;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

module.exports = ApiError;
