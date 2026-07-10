const winston = require('winston');
const path = require('path');
const { appConfig } = require('../config');

// Define log levels and colors
const logLevels = {
  levels: {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
  },
  colors: {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    debug: 'cyan',
  },
};

winston.addColors(logLevels.colors);

const SENSITIVE_KEY_PATTERN =
  /(password|passwd|pass|secret|token|jwt|cookie|authorization|api[-_]?key|private[-_]?key|rawocr|ocr|airaw|airesponse|extractedtext|imageurl|screenshot|headers)/i;

const SENSITIVE_VALUE_PATTERN_SOURCE =
  String.raw`(mongodb(?:\+srv)?:\/\/[^\s"]+|cloudinary:\/\/[^\s"]+|https?:\/\/res\.cloudinary\.com\/[^\s"]+|Bearer\s+[A-Za-z0-9._-]+|eyJ[A-Za-z0-9._-]+|AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)`;

function redactValue(value, key = "") {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return "[REDACTED]";
  }

  if (typeof value === "string") {
    return value.replace(
      new RegExp(SENSITIVE_VALUE_PATTERN_SOURCE, "g"),
      "[REDACTED]"
    );
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, key));
  }

  if (value && typeof value === "object") {
    const redacted = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      redacted[childKey] = redactValue(childValue, childKey);
    }
    return redacted;
  }

  return value;
}

function redactMeta(meta) {
  return redactValue(meta);
}

// Custom format for structured logging
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.printf(({ level, message, timestamp, stack, ...meta }) => {
    const redactedMeta = redactMeta(meta);
    const redactedMessage = redactValue(String(message || ""));
    const redactedStack = stack ? redactValue(stack) : stack;
    const metaStr = Object.keys(redactedMeta).length ? ` | ${JSON.stringify(redactedMeta)}` : '';
    return `${timestamp} [${level}]${metaStr}: ${redactedMessage}${redactedStack ? '\n' + redactedStack : ''}`;
  })
);

// Create logger instance
const logger = winston.createLogger({
  // Default to `warn` to keep terminal output focused on actionable issues.
  level: appConfig.logLevel,
  levels: logLevels.levels,
  transports: [
    // Console transport
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        logFormat
      ),
    }),
    // File transport for errors
    new winston.transports.File({
      filename: path.join(__dirname, '..', 'logs', 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // File transport for all logs
    new winston.transports.File({
      filename: path.join(__dirname, '..', 'logs', 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
  ],
});

// Stream object for Morgan HTTP logging
const stream = {
  write: (message) => {
    logger.info(message.trim());
  },
};

module.exports = {
  logger,
  stream,
  redactMeta,
};
