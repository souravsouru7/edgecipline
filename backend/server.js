
const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");

// Load .env before any module that reads process.env at require-time (e.g. config/cloudinary via jobs/dataCleanupCron).
require("dotenv").config();

// Sentry must be initialized before any other require so it can instrument all modules.
const {
  Sentry,
  bindFatalHandlers,
  flushSentry,
  initSentry,
  requestSentryContext,
} = require("./config/sentry");
initSentry({ processName: "api" });

// Register global handlers before any module imports so that synchronous throws
// and unhandled rejections from requires (config, DB, etc.) are captured rather
// than silently crashing the process. Use console here because the logger module
// hasn't been loaded yet at this point.
process.on("uncaughtException", (error) => {
  console.error("[FATAL] Uncaught Exception — process will exit", error.message, error.stack);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  console.error("[FATAL] Unhandled Rejection — process will exit", msg, stack);
  process.exit(1);
});

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");
const swaggerUi = require("swagger-ui-express");

const connectDB = require("./config/db");
const { appConfig } = require("./config");
const {
  getRateLimiterHealth,
  globalRateLimiter,
} = require("./middleware/rateLimiter");
const { sanitizeInput } = require("./middleware/sanitizeInput");
const { errorHandler } = require("./middleware/errorHandler");
const { logger, stream } = require("./utils/logger");
const { timeoutMiddleware } = require("./middleware/timeout");
const { requestContext } = require("./middleware/requestContext");
const { standardizeResponse } = require("./middleware/standardizeResponse");
const openApiDocument = require("./docs/openapi");

// Replace the early console-only guards with Sentry-aware fatal handlers.
process.removeAllListeners("uncaughtException");
process.removeAllListeners("unhandledRejection");
bindFatalHandlers({ logger, processName: "api" });

if (false) process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception — process will exit", { error: error.message, stack: error.stack });
  process.exit(1);
});

if (false) process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled Rejection — process will exit", {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
  process.exit(1);
});

const { connectRedis, isRedisReady } = require("./config/redis");
const { startDataCleanupCron } = require("./jobs/dataCleanupCron");
const { startOcrScreenshotRetentionCron } = require("./jobs/ocrScreenshotRetentionCron");
const { startWeeklyReportsCron } = require("./jobs/weeklyReportsCron");
const { startSessionReminderCron } = require("./jobs/sessionReminderCron");
const { startMorningMentorCron } = require("./jobs/morningMentorCron");
const { startSubscriptionExpiryCron } = require("./jobs/subscriptionExpiryCron");
const { startSubscriptionRescueCron } = require("./jobs/subscriptionRescueCron");
const { startWebhookReconciliationCron } = require("./jobs/webhookReconciliationCron");
const { startWebhookRetentionCron } = require("./jobs/webhookRetentionCron");
const { startStreakProtectorCron } = require("./jobs/streakProtectorCron");
const { startReflectionReminderCron } = require("./jobs/reflectionReminderCron");
const { startMissionProgressCron } = require("./jobs/missionProgressCron");
const { startSupportAutoCloseCron } = require("./jobs/supportAutoCloseCron");
const { startOcrWorker } = require("./workers/ocrWorker");
const { startSmartNotificationWorker } = require("./workers/smartNotificationWorker");

connectDB();
connectRedis();

// In local/dev environments, start the OCR worker in-process so uploads do not
// remain stuck in "processing" when only the API server is running.
if (appConfig.env !== "production" && process.env.ENABLE_EMBEDDED_OCR_WORKER !== "false") {
  startOcrWorker({ initializeConnections: false, mode: "embedded" }).catch((error) => {
    logger.error("Failed to start embedded OCR worker", {
      error: error.message,
      stack: error.stack,
    });
  });
}

// Smart-notification worker runs in-process for dev + opt-in for production.
// In production, set ENABLE_EMBEDDED_SMART_NOTIFICATION_WORKER=true to run it
// alongside the API; otherwise run a dedicated worker process:
//   node backend/workers/smartNotificationWorker.js
const enableSmartWorker =
  appConfig.env !== "production" ||
  process.env.ENABLE_EMBEDDED_SMART_NOTIFICATION_WORKER === "true";

if (enableSmartWorker && process.env.DISABLE_EMBEDDED_SMART_NOTIFICATION_WORKER !== "true") {
  startSmartNotificationWorker({ initializeConnections: false, mode: "embedded" }).catch((error) => {
    logger.error("Failed to start embedded smart-notification worker", {
      error: error.message,
      stack: error.stack,
    });
  });
}

logger.info("[Timezone] Server timezone configuration", {
  timezoneOffsetHours: appConfig.timezoneOffsetHours,
  currentUtc: new Date().toISOString(),
  inferredLocal: new Date(Date.now() + appConfig.timezoneOffsetHours * 3600000).toISOString().replace("Z", " (local-approx)"),
});

// Weekly AI reports are generated on-demand only (user clicks Generate Report).
// This cron only sends a lightweight reminder notification; it does not call AI.
startWeeklyReportsCron();
startSessionReminderCron();
startMorningMentorCron();
startSubscriptionExpiryCron();
startSubscriptionRescueCron();
startWebhookReconciliationCron();
startWebhookRetentionCron();
startStreakProtectorCron();
startReflectionReminderCron();
startMissionProgressCron();
startSupportAutoCloseCron();
startDataCleanupCron();
startOcrScreenshotRetentionCron();

const app = express();

// req.ip, req.ips, req.protocol, rate-limit keys, and security logs all depend
// on this boundary. Production requires an explicit TRUST_PROXY value.
app.set("trust proxy", appConfig.proxy.trust);
app.use(requestContext);
app.use(requestSentryContext);

const normalizeOrigin = (value) => {
  if (!value) return "";
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return String(value).trim().replace(/\/+$/, "").toLowerCase();
  }
};

const isAllowedProductionOrigin = (origin) => {
  if (!origin) return true;
  const normalizedOrigin = normalizeOrigin(origin);

  const staticAllowedOrigins = new Set([
    "https://stratedge.live",
    "https://www.stratedge.live",
    "https://stratedge-stageing.vercel.app",
    "https://edgecipline.soutavr5.workers.dev",
  ]);

  if (staticAllowedOrigins.has(normalizedOrigin)) {
    return true;
  }

  // Allow known Stratedge subdomains used for production web/app clients.
  if (/^https:\/\/([a-z0-9-]+\.)?stratedge\.live$/i.test(normalizedOrigin)) {
    return true;
  }

  // Staging / preview frontends — explicit whitelist only.
  // A wildcard *.vercel.app regex was previously used here, but it would allow
  // any random Vercel deployment to make authenticated cross-origin requests.
  // Add your specific Vercel preview URLs to the ALLOWED_ORIGINS env var instead,
  // or list them here as absolute string matches.
  const allowedVercelPreviews = (process.env.ALLOWED_VERCEL_PREVIEWS || "")
    .split(",")
    .map((u) => normalizeOrigin(u.trim()))
    .filter(Boolean);

  return allowedVercelPreviews.includes(normalizedOrigin);
};

const corsOptions = {
  origin: function (origin, callback) {
    // In development, allow all origins (localhost, LAN IPs, etc.)
    if (appConfig.env !== "production") {
      return callback(null, true);
    }

    const allowedOrigins = appConfig.cors.allowedOrigins.map((item) => normalizeOrigin(item));
    const normalizedOrigin = normalizeOrigin(origin);

    if (appConfig.cors.debug) {
      console.log(`CORS Check | Origin: ${origin} | Normalized: ${normalizedOrigin} | AllowedList: ${allowedOrigins.join(", ")}`);
    }

    // Allow requests with no origin (mobile apps, curl) and Capacitor Android app
    if (
      !origin ||
      isAllowedProductionOrigin(origin) ||
      allowedOrigins.includes(normalizedOrigin) ||
      String(origin).startsWith("capacitor://localhost")
    ) {
      callback(null, true);
    } else {
      console.warn(`CORS Rejected | Origin: ${origin}`);
      callback(null, false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Client-Platform', 'X-Request-ID', 'X-Device-ID', 'X-Session-ID'],
};

// HTTPS redirect — must come before CORS so redirects are not blocked
if (appConfig.env === "production") {
  app.use((req, res, next) => {
    if (req.headers["x-forwarded-proto"] && req.headers["x-forwarded-proto"] !== "https") {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
  });
}

// Handle OPTIONS preflight requests explicitly before any other middleware.
// Express/path-to-regexp in this stack rejects "*" as a route path.
app.options(/.*/, cors(corsOptions));
app.use(cors(corsOptions));

// HTTP security headers
// crossOriginOpenerPolicy must allow-popups so Firebase Auth popup (Google Sign-In)
// can call window.closed across origins without being blocked.
app.use(helmet({
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  // M2: Strict CSP — API server serves no HTML pages, so lock down everything
  contentSecurityPolicy: appConfig.env === "production" ? {
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  } : false,
  // M2: HSTS — enforce HTTPS for 1 year (only in production behind TLS)
  strictTransportSecurity: appConfig.env === "production" ? {
    maxAge: 31536000,
    includeSubDomains: true,
  } : false,
}));

// Global timeout middleware (apply early)
app.use(timeoutMiddleware);

// Request logging middleware
app.use(morgan('combined', { stream, skip: (req) => req.path === '/' }));

// Log important API events
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logMeta = {
      method: req.method,
      route: req.originalUrl,
      status: res.statusCode,
      duration: `${duration}ms`,
      userAgent: req.get('user-agent'),
      requestId: req.requestId,
      ip: req.ip,
    };

    if (res.statusCode >= 500) {
      logger.warn(`API request failed | method=${req.method} | route=${req.originalUrl} | status=${res.statusCode} | duration=${duration}ms`, {
        ...logMeta,
      });
    } else if (res.statusCode >= 400) {
      logger.debug(`API client error | method=${req.method} | route=${req.originalUrl} | status=${res.statusCode} | duration=${duration}ms`, {
        ...logMeta,
      });
    } else {
      logger.info(`API request | method=${req.method} | route=${req.originalUrl} | status=${res.statusCode} | duration=${duration}ms`, {
        ...logMeta,
      });
    }
  });
  next();
});

// Razorpay webhook signature verification requires the exact raw request body.
// Mount this before express.json(), sanitization, and auth middleware.
app.use(
  "/api/payments/webhook",
  standardizeResponse,
  express.raw({ type: "application/json", limit: "1mb" }),
  require("./routes/razorpayWebhookRoutes")
);

// Google Play real-time developer notifications, delivered by Cloud Pub/Sub.
// Also mounted on the raw body: authentication here is an OIDC token rather
// than a body HMAC, so the raw buffer is not strictly required — but keeping
// both webhooks on the same pre-JSON path means neither can be silently
// reordered behind express.json() later, and sanitizeInput must not rewrite a
// payload we hand back to Google's own parser.
//
// NOTE the path: /api/payments/webhook/google-play would be swallowed by the
// Razorpay mount above, which matches that whole prefix.
app.use(
  "/api/webhooks/google-play",
  standardizeResponse,
  express.raw({ type: "application/json", limit: "1mb" }),
  require("./routes/googlePlayNotificationRoutes")
);

app.use(express.json({ limit: "1mb" }));

// Parse cookies — required for httpOnly refresh-token cookie
app.use(cookieParser());

// Interactive and machine-readable API contract. The route-specific CSP
// allows Swagger UI's bundled assets without weakening API responses.
app.get("/api/docs/openapi.json", (_req, res) => res.json(openApiDocument));
app.use(
  "/api/docs",
  (_req, res, next) => {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
      "script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'"
    );
    next();
  },
  swaggerUi.serve,
  swaggerUi.setup(openApiDocument, {
    customSiteTitle: "StratEdge API",
    swaggerOptions: { persistAuthorization: true },
  })
);

// Prevent browsers from caching API responses
app.use("/api", (_req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  next();
});

// Every JSON response under /api uses the same success/error envelope.
app.use("/api", standardizeResponse);

// Apply global input sanitization (body, query, params)
app.use(sanitizeInput);

// Apply global rate limiter to all routes
app.use(globalRateLimiter);

// Auth routes use per-route rate limiters (authRateLimiter for credentials,
// refreshRateLimiter for token refresh, profileRateLimiter for /me endpoints).
// Applying a single strict limiter at the router level caused 429s on frequent /me calls.
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/trades", require("./routes/tradeRoutes"));
app.use("/api/setups", require("./routes/setupRoutes"));
app.use("/api/checklists", require("./routes/checklistRoutes"));
app.use("/api/dashboard", require("./routes/dashboardRoutes"));
app.use("/api/analytics", require("./routes/analyticsRoutes"));
app.use("/api/upload", require("./routes/uploadRoutes"));
app.use("/api/reports", require("./routes/weeklyReportRoutes"));
app.use("/api/trading-dna", require("./routes/tradingDnaRoutes"));
app.use("/api/notifications", require("./routes/notificationRoutes"));
app.use("/api/streaks", require("./routes/streakRoutes"));
app.use("/api/reflections", require("./routes/reflectionRoutes"));
app.use("/api/coach", require("./routes/coachRoutes"));
app.use("/api/onboarding", require("./routes/onboardingRoutes"));
app.use("/api/missions", require("./routes/missionRoutes"));

// Customer support. /api/support/config, /home, /articles* are intentionally
// PUBLIC — /support is the support URL submitted to Google Play and App Store
// Connect, and both open it with no session. Everything under /tickets and
// /attachments requires authentication.
app.use("/api/support", require("./routes/supportRoutes"));

// Admin routes (completely separate workspace)
app.use("/api/admin/auth", require("./admin/routes/adminAuthRoutes"));
app.use("/api/admin/analytics", require("./admin/routes/adminAnalyticsRoutes"));
app.use("/api/admin/users", require("./admin/routes/adminUserRoutes"));
app.use("/api/admin/payments", require("./admin/routes/adminPaymentRoutes"));
app.use("/api/admin/trades", require("./admin/routes/adminTradeRoutes"));
app.use("/api/admin/notifications", require("./admin/routes/adminNotificationRoutes"));
app.use("/api/admin/auth-cache-metrics", require("./admin/routes/adminCacheMetricsRoutes"));
app.use("/api/admin/feedback", require("./admin/routes/adminFeedbackRoutes"));
app.use("/api/admin/issues", require("./admin/routes/adminIssueRoutes"));
app.use("/api/admin/missions", require("./admin/routes/adminMissionRoutes"));
// Agent-facing support console. Guarded by supportAuth (admin session + a
// supportRole capability check re-derived from the database on every request),
// not by adminAuth — see middleware/supportAuth.
app.use("/api/admin/support", require("./admin/routes/adminSupportRoutes"));
app.use("/api/admin/promotions", require("./admin/routes/adminPromotionRoutes"));

// User feedback submission
app.use("/api/feedback", require("./routes/feedbackRoutes"));
app.use("/api/issues", require("./routes/issueReportRoutes"));

// Payment routes
app.use("/api/payments", require("./routes/paymentRoutes"));
// Android in-app purchases. Razorpay stays the web processor; Play Billing is
// mandatory for digital goods inside the Android app. Both feed the same
// entitlement — see utils/premium.
app.use("/api/payments/google-play", require("./routes/googlePlayBillingRoutes"));
app.use("/api/promotions", require("./routes/promotionRoutes"));

// Trial & smart-paywall routes (7-day premium trial)
app.use("/api/trial", require("./routes/trialRoutes"));

// Subscription rescue funnel — renewal banners + analytics beacons
app.use("/api/rescue", require("./routes/rescueRoutes"));

// Profile routes (FCM token registration)
app.use("/api/profile", require("./routes/profileRoutes"));

// Indian Market-specific routes (completely separate workspace)
app.use("/api/indian/trades", require("./routes/indianMarketRoutes"));
app.use("/api/indian/analytics", require("./routes/indianAnalyticsRoutes"));
app.use("/api/indian/intelligence", require("./routes/indianIntelligenceRoutes"));

function getHealthSnapshot() {
  const mongoose = require("mongoose");
  const dbState = mongoose.connection.readyState; // 1 = connected
  const redisReady = isRedisReady();
  const rateLimiter = getRateLimiterHealth();

  if (dbState !== 1) {
    return {
      httpStatus: 503,
      body: {
        service: "stratedge-api",
        env: appConfig.env,
        status: "unhealthy",
        db: "disconnected",
        redis: redisReady ? "connected" : "disconnected",
        rateLimiter,
        uptime: process.uptime(),
      },
    };
  }

  const degraded = !redisReady || rateLimiter.degraded;
  return {
    httpStatus: degraded ? 503 : 200,
    body: {
      service: "stratedge-api",
      env: appConfig.env,
      status: degraded ? "degraded" : "ok",
      db: "connected",
      redis: redisReady ? "connected" : "disconnected",
      rateLimiter,
      uptime: process.uptime(),
    },
  };
}

app.get("/", (_req, res) => {
  const snapshot = getHealthSnapshot();
  res.status(snapshot.httpStatus).json(snapshot.body);
});

app.get("/health", (_req, res) => {
  const snapshot = getHealthSnapshot();
  res.status(snapshot.httpStatus).json(snapshot.body);
});


// Fallback 404 for unknown routes
app.use((_req, res) => {
  res.status(404).json({ message: "Endpoint not found" });
});

// Sentry error handler must come before your own error handler
if (process.env.SENTRY_DSN) {
  app.use(Sentry.expressErrorHandler());
}

// Central error handler (must be last)
app.use(errorHandler);

const PORT = appConfig.port;

const { getCookieConfigSummary } = require("./services/tokenService");

const server = app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  console.log(`Server running on port ${PORT}`);
  logger.info("AUTH_COOKIE_CONFIG", getCookieConfigSummary());
});

// Graceful shutdown
const shutdown = async (signal) => {
  logger.info(`${signal} received — shutting down gracefully`);
  server.close(async () => {
    logger.info("HTTP server closed");
    try {
      const mongoose = require("mongoose");
      await mongoose.connection.close();
      const { client } = require("./config/redis");
      await client.quit();
      await flushSentry(2000);
    } catch (e) {
      logger.error("Shutdown cleanup error", { error: e.message });
    }
    process.exit(0);
  });

  // Force exit after 15s if graceful close hangs
  setTimeout(() => {
    logger.error("Forced shutdown after timeout");
    process.exit(1);
  }, 15_000);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
