const Sentry = require("@sentry/node");

let initialized = false;
let fatalHandlersBound = false;

const SENSITIVE_KEY = /password|secret|token|cookie|authorization|api[-_]?key|private[-_]?key|body|raw|image|email/i;
const SENSITIVE_VALUE_PATTERN =
  /(mongodb(?:\+srv)?:\/\/[^\s"]+|cloudinary:\/\/[^\s"]+|https?:\/\/res\.cloudinary\.com\/[^\s"]+|Bearer\s+[A-Za-z0-9._-]+|[A-Za-z0-9_-]{3,}\.[A-Za-z0-9_-]{3,}\.[A-Za-z0-9_-]{3,}|eyJ[A-Za-z0-9._-]+|AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9_-]{20,}|[A-Za-z]:[\\/][^\s"']+|\/(?:Users|home|var|etc|srv|app)\/[^\s"']+|-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----)/g;

function sanitize(value, key = "") {
  if (SENSITIVE_KEY.test(key)) return "[Filtered]";
  if (typeof value === "string") return value.replace(SENSITIVE_VALUE_PATTERN, "[Filtered]");
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [childKey, sanitize(childValue, childKey)])
    );
  }
  return value;
}

function sanitizeEvent(event) {
  if (event.request) {
    event.request.cookies = undefined;
    event.request.data = undefined;
    event.request.query_string = undefined;
    if (event.request.url) event.request.url = String(event.request.url).split("?")[0];
    if (event.request.headers) event.request.headers = sanitize(event.request.headers);
  }
  if (event.user) event.user = event.user.id ? { id: String(event.user.id) } : undefined;
  event.extra = sanitize(event.extra || {});
  event.contexts = sanitize(event.contexts || {});
  if (Array.isArray(event.exception?.values)) {
    event.exception.values = event.exception.values.map((entry) => ({
      ...entry,
      value: sanitize(entry.value),
      stacktrace: entry.stacktrace
        ? {
            ...entry.stacktrace,
            frames: entry.stacktrace.frames?.map((frame) => ({
              ...frame,
              filename: sanitize(frame.filename),
              abs_path: sanitize(frame.abs_path),
              context_line: sanitize(frame.context_line),
              pre_context: sanitize(frame.pre_context),
              post_context: sanitize(frame.post_context),
            })),
          }
        : entry.stacktrace,
    }));
  }
  return event;
}

function initSentry({ processName = "api" } = {}) {
  if (initialized) return Sentry;

  const dsn = String(process.env.SENTRY_DSN || "").trim();
  const environment = process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development";
  if (!dsn) {
    if (environment === "production") {
      throw new Error("Missing required production env var: SENTRY_DSN");
    }
    return Sentry;
  }

  const tracesSampleRate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.2);
  Sentry.init({
    dsn,
    environment,
    release: process.env.SENTRY_RELEASE || process.env.npm_package_version,
    serverName: process.env.SENTRY_SERVER_NAME,
    enabled: true,
    sendDefaultPii: false,
    tracesSampleRate: Number.isFinite(tracesSampleRate) ? tracesSampleRate : 0.2,
    initialScope: { tags: { process: processName } },
    beforeSend: sanitizeEvent,
  });
  initialized = true;
  return Sentry;
}

function captureOperationalError(error, { level = "error", subsystem, tags = {}, extra = {}, userId } = {}) {
  if (!initialized) return null;
  const normalizedError = error instanceof Error ? error : new Error(String(error));

  return Sentry.withScope((scope) => {
    scope.setLevel(level);
    if (subsystem) scope.setTag("subsystem", subsystem);
    for (const [key, value] of Object.entries(tags)) {
      if (value !== undefined && value !== null) scope.setTag(key, String(value));
    }
    scope.setExtras(sanitize(extra));
    if (userId) scope.setUser({ id: String(userId) });
    return Sentry.captureException(normalizedError);
  });
}

function requestSentryContext(req, _res, next) {
  if (!initialized) return next();
  return Sentry.withIsolationScope((scope) => {
    scope.setTag("request_id", req.requestId);
    scope.setTag("route", req.originalUrl.split("?")[0]);
    scope.setContext("request", {
      id: req.requestId,
      method: req.method,
      route: req.originalUrl.split("?")[0],
      ip: req.ip,
    });
    next();
  });
}

function bindFatalHandlers({ logger = console, processName = "node" } = {}) {
  if (fatalHandlersBound) return;
  const terminate = async (kind, reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    logger.error(`${kind} - process will exit`, { error: error.message, stack: error.stack });
    captureOperationalError(error, {
      level: "fatal",
      subsystem: "process",
      tags: { kind, process: processName },
    });
    if (initialized) await Sentry.flush(2000);
    process.exit(1);
  };
  process.on("uncaughtException", (error) => terminate("uncaught_exception", error));
  process.on("unhandledRejection", (reason) => terminate("unhandled_rejection", reason));
  fatalHandlersBound = true;
}

async function flushSentry(timeoutMs = 2000) {
  if (!initialized) return true;
  return Sentry.flush(timeoutMs);
}

module.exports = {
  Sentry,
  bindFatalHandlers,
  captureOperationalError,
  flushSentry,
  initSentry,
  requestSentryContext,
};
