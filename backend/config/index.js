require("dotenv").config();

function normalizePrivateKey(value) {
  return value ? value.replace(/\\n/g, "\n") : "";
}

function maskSecret(value, visiblePrefix = 4, visibleSuffix = 4) {
  const raw = String(value || "");
  if (!raw) return "[missing]";
  if (raw.length <= visiblePrefix + visibleSuffix) return "***";
  return `${raw.slice(0, visiblePrefix)}***${raw.slice(-visibleSuffix)}`;
}

function readBoolean(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return value === "true" || value === "1" || value === "yes";
}

function readNumber(name, fallback) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric env var ${name}`);
  }
  return parsed;
}

function readList(name) {
  const value = process.env[name];
  if (value == null || value === "") return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function requireEnv(name) {
  const value = process.env[name];
  if (value == null || String(value).trim() === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function requireSecret(name) {
  const value = requireEnv(name);
  if (String(value).length < 32) {
    throw new Error(`${name} must be at least 32 characters`);
  }
  return value;
}

function requireDistinctSecrets(leftName, rightName) {
  const left = requireSecret(leftName);
  const right = requireSecret(rightName);
  if (left === right) {
    throw new Error(`${leftName} and ${rightName} must be different secrets`);
  }
  return { left, right };
}

function normalizeMongoUri(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    throw new Error("Missing required env var: MONGO_URI");
  }
  if (raw.startsWith("mongodb://") || raw.startsWith("mongodb+srv://")) {
    return raw;
  }
  return `mongodb://${raw.replace(/^\/+/, "")}`;
}

const jwtSecrets = requireDistinctSecrets("JWT_SECRET", "ADMIN_JWT_SECRET");
const { parseTrustProxy } = require("./trustProxy");

const appConfig = {
  env: process.env.NODE_ENV || "development",
  port: readNumber("PORT", 5000),
  logLevel: process.env.LOG_LEVEL || "info",
  proxy: {
    trust: parseTrustProxy(process.env.TRUST_PROXY, {
      isProduction: (process.env.NODE_ENV || "development") === "production",
    }),
  },
  mongoUri: normalizeMongoUri(requireEnv("MONGO_URI")),
  mongoDnsServers: readList("MONGO_DNS_SERVERS"),
  jwt: {
    secret: jwtSecrets.left,
    expiresIn: process.env.JWT_EXPIRES_IN || "15m",
    // Dedicated admin signing secret. Never use the user JWT secret here.
    adminSecret: jwtSecrets.right,
  },
  cloudinary: {
    cloudName: requireEnv("CLOUD_NAME"),
    apiKey: requireEnv("CLOUD_API_KEY"),
    apiSecret: requireEnv("CLOUD_API_SECRET"),
  },
  redis: {
    url: process.env.REDIS_URL || "redis://localhost:6379",
  },
  ocrQueue: {
    name: process.env.OCR_QUEUE_NAME || "ocrQueue",
    attempts: readNumber("OCR_JOB_ATTEMPTS", 3),
    backoffMs: readNumber("OCR_JOB_BACKOFF_MS", 5000),
    initialDelayMs: readNumber("OCR_JOB_INITIAL_DELAY_MS", 2000),
    completedRetentionAgeSeconds: readNumber("OCR_COMPLETED_RETENTION_AGE_SECONDS", 24 * 60 * 60),
    completedRetentionCount: readNumber("OCR_COMPLETED_RETENTION_COUNT", 10000),
    failedRetentionAgeSeconds: readNumber("OCR_FAILED_RETENTION_AGE_SECONDS", 7 * 24 * 60 * 60),
    failedRetentionCount: readNumber("OCR_FAILED_RETENTION_COUNT", 10000),
    maxRecoveryAttempts: readNumber("OCR_QUEUE_RECOVERY_ATTEMPTS", 2),
  },
  ocrWorker: {
    concurrency: readNumber("OCR_WORKER_CONCURRENCY", 5),
    lockDurationMs: readNumber("OCR_WORKER_LOCK_DURATION_MS", 300000),
    maxStalledCount: readNumber("OCR_WORKER_MAX_STALLED_COUNT", 2),
  },
  smartNotificationQueue: {
    name:           process.env.SMART_NOTIFICATION_QUEUE_NAME || "smartNotificationsQueue",
    attempts:       readNumber("SMART_NOTIFICATION_ATTEMPTS", 3),
    backoffMs:      readNumber("SMART_NOTIFICATION_BACKOFF_MS", 3000),
    concurrency:    readNumber("SMART_NOTIFICATION_WORKER_CONCURRENCY", 8),
    lockDurationMs: readNumber("SMART_NOTIFICATION_LOCK_DURATION_MS", 60000),
  },
  tradingDnaQueue: {
    name:                         process.env.TRADING_DNA_QUEUE_NAME || "tradingDnaQueue",
    attempts:                     readNumber("TRADING_DNA_JOB_ATTEMPTS", 2),
    backoffMs:                    readNumber("TRADING_DNA_JOB_BACKOFF_MS", 10000),
    // Keep completed jobs for 5 min — long enough for the frontend to poll
    // the final state once, short enough that the queue doesn't accumulate.
    // Final report is persisted in Mongo regardless.
    completedRetentionAgeSeconds: readNumber("TRADING_DNA_COMPLETED_RETENTION_AGE_SECONDS", 300),
    completedRetentionCount:      readNumber("TRADING_DNA_COMPLETED_RETENTION_COUNT", 1000),
    failedRetentionAgeSeconds:    readNumber("TRADING_DNA_FAILED_RETENTION_AGE_SECONDS", 7 * 24 * 60 * 60),
    failedRetentionCount:         readNumber("TRADING_DNA_FAILED_RETENTION_COUNT", 1000),
  },
  tradingDnaWorker: {
    // Concurrency 2 by default — each job calls Gemini, which is the real
    // bottleneck. Bump per-replica if Gemini quota allows.
    concurrency:    readNumber("TRADING_DNA_WORKER_CONCURRENCY", 2),
    // Generation takes 30–90s; keep the lock comfortably above the upper end
    // so a slow Gemini response does not mark the job as stalled.
    lockDurationMs: readNumber("TRADING_DNA_WORKER_LOCK_DURATION_MS", 180000),
    maxStalledCount: readNumber("TRADING_DNA_WORKER_MAX_STALLED_COUNT", 1),
  },
  upload: {
    maxFileSizeBytes: readNumber("UPLOAD_MAX_FILE_SIZE_BYTES", 2 * 1024 * 1024),
    // Decoded-pixel ceiling, checked from the image header before anything
    // decodes the file. A compressed "image bomb" is small on the wire but
    // expands to gigabytes in memory; broker screenshots never come close to
    // this, so anything above it is rejected rather than stored and processed.
    maxImagePixels: readNumber("UPLOAD_MAX_IMAGE_PIXELS", 50 * 1000 * 1000),
  },
  mongodb: {
    maxPoolSize: readNumber("MONGO_MAX_POOL_SIZE", 50),
    minPoolSize: readNumber("MONGO_MIN_POOL_SIZE", 5),
  },
  cleanup: {
    enabled: readBoolean("ENABLE_DATA_CLEANUP_CRON", true),
    schedule: process.env.DATA_CLEANUP_CRON_SCHEDULE || "0 3 * * *",
    rawOCRTextDays: readNumber("CLEANUP_RAW_OCR_DAYS", 7),
    aiRawResponseDays: readNumber("CLEANUP_AI_RESPONSE_DAYS", 7),
    imageCleanupDays: readNumber("CLEANUP_IMAGES_DAYS", 0),
    batchSize: readNumber("CLEANUP_BATCH_SIZE", 100),
  },
  weeklyReports: {
    enabled: readBoolean("ENABLE_WEEKLY_REPORTS_CRON", true),
    schedule: process.env.WEEKLY_REPORTS_CRON || "0 9 * * *",
  },
  sessionReminders: {
    enabled: readBoolean("ENABLE_SESSION_REMINDERS_CRON", true),
    schedule: process.env.SESSION_REMINDERS_CRON || "*/15 * * * *",
    timezone: process.env.SESSION_REMINDERS_TIMEZONE || "Asia/Kolkata",
  },
  morningMentor: {
    enabled: readBoolean("ENABLE_MORNING_MENTOR_CRON", true),
    schedule: process.env.MORNING_MENTOR_CRON || "0 7 * * *",
    timezone: process.env.MORNING_MENTOR_TIMEZONE || "Asia/Kolkata",
    timezoneOffsetHours: readNumber("MORNING_MENTOR_TIMEZONE_OFFSET_HOURS", 5.5),
  },
  subscriptionExpiry: {
    enabled: readBoolean("ENABLE_SUBSCRIPTION_EXPIRY_CRON", true),
    schedule: process.env.SUBSCRIPTION_EXPIRY_CRON || "0 * * * *",
    batchSize: readNumber("SUBSCRIPTION_EXPIRY_BATCH_SIZE", 500),
  },
  // Safety net for Razorpay webhooks whose processing kept throwing until the
  // provider stopped retrying. Without it, a transient Mongo/Razorpay outage
  // during delivery means money taken and no subscription granted.
  webhookReconciliation: {
    enabled: readBoolean("ENABLE_WEBHOOK_RECONCILIATION_CRON", true),
    schedule: process.env.WEBHOOK_RECONCILIATION_CRON || "*/15 * * * *",
    batchSize: readNumber("WEBHOOK_RECONCILIATION_BATCH_SIZE", 50),
  },
  // Drops stored webhook payloads after the retention window. Never deletes
  // the event document itself — eventId is the replay-protection key.
  webhookRetention: {
    enabled: readBoolean("ENABLE_WEBHOOK_RETENTION_CRON", true),
    schedule: process.env.WEBHOOK_RETENTION_CRON || "30 3 * * *",
    days: readNumber("WEBHOOK_RETENTION_DAYS", 90),
    batchSize: readNumber("WEBHOOK_RETENTION_BATCH_SIZE", 500),
  },
  // Hourly rescue funnel — checks all 7 touchpoint windows on each run.
  // Idempotency is enforced by the RescueDispatch unique index, so multiple
  // instances are safe; the distributed lock is only an efficiency win.
  subscriptionRescue: {
    enabled: readBoolean("ENABLE_SUBSCRIPTION_RESCUE_CRON", true),
    schedule: process.env.SUBSCRIPTION_RESCUE_CRON || "15 * * * *",
    batchSize: readNumber("SUBSCRIPTION_RESCUE_BATCH_SIZE", 200),
  },
  streakProtector: {
    enabled: readBoolean("ENABLE_STREAK_PROTECTOR_CRON", true),
    // Default 21:00 IST — late enough that an active trader has logged,
    // early enough to act before midnight breaks the streak.
    schedule: process.env.STREAK_PROTECTOR_CRON || "0 21 * * *",
    timezone: process.env.STREAK_PROTECTOR_TIMEZONE || "Asia/Kolkata",
    // Minimum streak length that qualifies for a protective nudge. We don't
    // nag users with a 1- or 2-day streak — premature reminders erode trust.
    minStreak: readNumber("STREAK_PROTECTOR_MIN_STREAK", 3),
  },
  reflectionReminder: {
    enabled: readBoolean("ENABLE_REFLECTION_REMINDER_CRON", true),
    // Default 19:30 IST — markets are closed, dinner crowd, before the user
    // disengages for the night. Window the next cron firing must beat: 23:59.
    schedule: process.env.REFLECTION_REMINDER_CRON || "30 19 * * *",
    timezone: process.env.REFLECTION_REMINDER_TIMEZONE || "Asia/Kolkata",
    concurrency: readNumber("REFLECTION_REMINDER_CRON_CONCURRENCY", 0),
  },
  cron: {
    // Default 50; per-cron override via {CRON_NAME}_CONCURRENCY env vars.
    concurrency:              readNumber("CRON_CONCURRENCY", 50),
    morningMentorConcurrency: readNumber("MORNING_MENTOR_CRON_CONCURRENCY", 0),
    weeklyReportsConcurrency: readNumber("WEEKLY_REPORTS_CRON_CONCURRENCY", 0),
    sessionReminderConcurrency: readNumber("SESSION_REMINDER_CRON_CONCURRENCY", 0),
    streakProtectorConcurrency: readNumber("STREAK_PROTECTOR_CRON_CONCURRENCY", 0),
    reflectionReminderConcurrency: readNumber("REFLECTION_REMINDER_CRON_CONCURRENCY", 0),
  },
  cors: {
    allowedOrigins: (process.env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    debug: readBoolean("CORS_DEBUG", false),
  },
  timezoneOffsetHours: readNumber("TIMEZONE_OFFSET_HOURS", 5.5),
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID || "",
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL || "",
    privateKey: normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY),
  },
  googleVision: {
    projectId: process.env.GOOGLE_VISION_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || "",
    clientEmail: process.env.GOOGLE_VISION_CLIENT_EMAIL || "",
    privateKey: normalizePrivateKey(process.env.GOOGLE_VISION_PRIVATE_KEY),
  },
  ai: {
    openaiApiKey: process.env.OPENAI_API_KEY || "",
    openaiModel: process.env.OPENAI_TRADE_MODEL || "gpt-4o-mini",
    geminiApiKey: process.env.GEMINI_API_KEY || "",
    geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    geminiTradeModel: process.env.GEMINI_TRADE_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash",
  },
  trial: {
    // The 7-day free trial is retired: the free tier is now the 2-trades-per-
    // market allowance and nothing else. Flipping this back to true restores
    // the old behaviour wholesale — granting on signup, the countdown banner,
    // and trial users counting as premium.
    enabled: readBoolean("TRIAL_ENABLED", false),
    days: readNumber("TRIAL_DAYS", 7),
  },
  trades: {
    // Free accounts may log this many trades in EACH market. Premium — an
    // active paid plan, the 7-day trial, or an admin — is unlimited.
    freeLimit: readNumber("FREE_TRADE_LIMIT", 2),
    // Kill switch. The limit is only honest if there is somewhere to pay: with
    // the purchase surface compiled out (NEXT_PUBLIC_PAYMENTS_ENABLED=false,
    // which is what the mobile store policies require) an enforced limit
    // strands free users with no way to unblock themselves. Set this to false
    // to ship the code inert until checkout is live.
    freeLimitEnforced: readBoolean("FREE_TRADE_LIMIT_ENFORCED", true),
  },
  // ── Customer support ──────────────────────────────────────────────────────
  // Centralised so the WhatsApp number and support address exist in exactly
  // one place. The frontend reads these from GET /api/support/config rather
  // than NEXT_PUBLIC_* build vars, because /support is a store-submitted URL
  // in a STATIC export — a number baked into the bundle cannot be corrected
  // without shipping a new build to both app stores.
  support: {
    // E.164 digits only, no "+" and no spaces. wa.me rejects anything else,
    // and normalising here means callers never have to think about it.
    whatsappNumber: String(process.env.SUPPORT_WHATSAPP_NUMBER || "917510606322").replace(/[^\d]/g, ""),
    whatsappEnabled: readBoolean("SUPPORT_WHATSAPP_ENABLED", true),
    email: process.env.SUPPORT_EMAIL || "info@edgecipline.com",
    // Kill switch for the ticket surface. With this off, the Help Center still
    // renders articles and the WhatsApp/email CTAs — self-service and the
    // external channels must never depend on the ticket system being healthy.
    ticketsEnabled: readBoolean("SUPPORT_TICKETS_ENABLED", true),
    maxAttachmentsPerMessage: readNumber("SUPPORT_MAX_ATTACHMENTS", 5),
    maxAttachmentBytes: readNumber("SUPPORT_MAX_ATTACHMENT_BYTES", 5 * 1024 * 1024),
    // Signed-URL lifetime for attachment downloads. Long enough for a browser
    // to follow the redirect and fetch the image, short enough that a URL
    // copied out of devtools is useless within the minute.
    attachmentUrlTtlSeconds: readNumber("SUPPORT_ATTACHMENT_URL_TTL_SECONDS", 60),
    // Cap on open tickets one customer may hold at once. Stops a loop or an
    // abusive account from flooding the queue without punishing a customer
    // who genuinely has several unrelated problems.
    maxOpenTicketsPerUser: readNumber("SUPPORT_MAX_OPEN_TICKETS_PER_USER", 10),
    // Nightly job that closes resolved tickets past the reopen window.
    autoClose: {
      enabled: readBoolean("ENABLE_SUPPORT_AUTO_CLOSE_CRON", true),
      schedule: process.env.SUPPORT_AUTO_CLOSE_CRON || "0 2 * * *",
      batchSize: readNumber("SUPPORT_AUTO_CLOSE_BATCH_SIZE", 500),
    },
    // Email notifications for ticket events. Independent of push: a customer
    // with notifications disabled on their phone still needs the reply.
    emailNotificationsEnabled: readBoolean("SUPPORT_EMAIL_NOTIFICATIONS_ENABLED", true),
    // Absolute base for links inside support emails.
    appBaseUrl: process.env.SUPPORT_APP_BASE_URL || process.env.APP_BASE_URL || "https://stratedge.live",
    // Salt for the anonymous article-feedback fingerprint. Falls back to the
    // admin JWT secret so a missing env var degrades to "still salted with
    // something secret" rather than to an unsalted, rainbow-tableable hash of
    // a visitor's IP address.
    feedbackFingerprintSalt:
      process.env.SUPPORT_FEEDBACK_FINGERPRINT_SALT || jwtSecrets.right,
  },
  smtp: {
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: readNumber("SMTP_PORT", 587),
    secure: readBoolean("SMTP_SECURE", false),
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.SMTP_FROM || process.env.SMTP_USER || "no-reply@stratedge.live",
  },
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || "",
    keySecret: process.env.RAZORPAY_KEY_SECRET || "",
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || "",
    // Sandbox payments activate a REAL subscription against the REAL database
    // from a fabricated payment ID. Any authenticated user can self-grant
    // premium. Keying that purely on NODE_ENV was too weak: a staging box that
    // forgets to set NODE_ENV=production points at a real database and becomes
    // a free-premium faucet. This now requires deliberate, explicit opt-in AND
    // a non-production environment — both, never either.
    allowSandboxPayments:
      readBoolean("ALLOW_SANDBOX_PAYMENTS", false) &&
      (process.env.NODE_ENV || "development") !== "production",
  },
  // ── Google Play Billing ───────────────────────────────────────────────────
  // Android subscriptions. Razorpay stays the web processor; Play's own
  // billing is mandatory for digital goods inside the Android app, so the two
  // coexist and feed the same entitlement.
  //
  // Credentials follow the same PROJECT/CLIENT_EMAIL/PRIVATE_KEY triple as
  // `firebase` and `googleVision` above rather than a service-account JSON
  // file: a file has to exist somewhere on disk, which is how key material
  // ends up baked into an image or committed by accident. These are BACKEND
  // ONLY — never NEXT_PUBLIC_*, never shipped in the APK. The Android app
  // never talks to the Play Developer API; it only hands us a purchase token.
  googlePlay: {
    // Must equal the APK's applicationId. Verified against the value Google
    // echoes back, so a token minted against another app cannot be replayed.
    packageName: process.env.GOOGLE_PLAY_PACKAGE_NAME || "com.edgecipline",
    clientEmail: process.env.GOOGLE_PLAY_CLIENT_EMAIL || "",
    privateKey: normalizePrivateKey(process.env.GOOGLE_PLAY_PRIVATE_KEY),
    // Service account for the Pub/Sub push subscription that delivers RTDNs.
    // Google signs each push with an OIDC token whose email claim must equal
    // this; without it any host on the internet could POST fake lifecycle
    // events at the webhook. Required in production.
    rtdnServiceAccountEmail: process.env.GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT || "",
    // The exact https URL configured as the Pub/Sub push endpoint. Google
    // includes it as the OIDC `aud` claim; checking it stops a token minted
    // for some other service from being replayed here.
    rtdnAudience: process.env.GOOGLE_PLAY_RTDN_AUDIENCE || "",
    // HMAC key behind the obfuscatedAccountId that binds a Play purchase to an
    // Edgecipline account. Falls back to the admin JWT secret so a missing var
    // still salts the hash — same degradation as support.feedbackFingerprintSalt.
    // APPEND-ONLY: rotating this breaks the identity check for restores of
    // purchases we have not already bound. See utils/playAccountIdentity.
    accountSalt: process.env.GOOGLE_PLAY_ACCOUNT_SALT || "",
    // Master switch. Off by default so the endpoints 503 rather than
    // half-work until Play Console and the service account are actually set
    // up. Turning this on with credentials missing fails at boot, not at the
    // first purchase.
    enabled: readBoolean("GOOGLE_PLAY_BILLING_ENABLED", false),
    // Play API calls sit in the request path of a user who has already been
    // charged, so this is deliberately generous — a timeout here means a
    // retry, never a lost purchase.
    apiTimeoutMs: readNumber("GOOGLE_PLAY_API_TIMEOUT_MS", 15000),
  },
  resend: {
    apiKey: process.env.RESEND_API_KEY || "",
    from: process.env.RESEND_FROM || "Stratedge <noreply@stratedge.live>",
  },
  rateLimit: {
    globalWindowMs: readNumber("RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000),
    globalMaxRequests: readNumber("RATE_LIMIT_MAX_REQUESTS", 100),
    authWindowMs: readNumber("AUTH_RATE_LIMIT_WINDOW_MS", 60 * 1000),
    authMaxRequests: readNumber("AUTH_RATE_LIMIT_MAX_REQUESTS", 5),
    uploadWindowMs: readNumber("UPLOAD_RATE_LIMIT_WINDOW_MS", 60 * 1000),
    uploadMaxRequests: readNumber("UPLOAD_RATE_LIMIT_MAX_REQUESTS", 20),
    statusWindowMs: readNumber("STATUS_RATE_LIMIT_WINDOW_MS", 60 * 1000),
    statusMaxRequests: readNumber("STATUS_RATE_LIMIT_MAX_REQUESTS", 30),
  },
  timeouts: {
    apiTimeout: readNumber("API_REQUEST_TIMEOUT_MS", 15000),
    ocrTimeout: readNumber("OCR_SERVICE_TIMEOUT_MS", 90000),        // 90s — Tesseract on large images needs time
    aiTimeout: readNumber("AI_SERVICE_TIMEOUT_MS", 45000),          // 45s for AI call
    dbTimeout: readNumber("DB_OPERATION_TIMEOUT_MS", 10000),
    externalApiTimeout: readNumber("EXTERNAL_API_TIMEOUT_MS", 10000),
    processingTimeoutMs: readNumber("PROCESSING_TIMEOUT_MS", 300000), // 5 min overall job limit
  },
};

function assertFirebaseAdminConfig() {
  if (!appConfig.firebase.projectId || !appConfig.firebase.clientEmail || !appConfig.firebase.privateKey) {
    const error = new Error(
      "Missing Firebase Admin env vars. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY."
    );
    error.code = "FIREBASE_CONFIG_MISSING";
    throw error;
  }
  return appConfig.firebase;
}

function assertGoogleVisionConfig() {
  if (
    !appConfig.googleVision.projectId ||
    !appConfig.googleVision.clientEmail ||
    !appConfig.googleVision.privateKey
  ) {
    const error = new Error(
      "Missing Google Vision env vars. Set GOOGLE_VISION_PROJECT_ID, GOOGLE_VISION_CLIENT_EMAIL, and GOOGLE_VISION_PRIVATE_KEY."
    );
    error.code = "GOOGLE_VISION_CONFIG_MISSING";
    throw error;
  }
  return appConfig.googleVision;
}

// Fail CLOSED. Every caller of this sits upstream of granting a paid
// entitlement, so a missing credential must raise rather than be treated as
// "verification skipped". The message names the exact env vars because the
// person hitting it is an operator mid-deploy, not a user.
function assertGooglePlayConfig() {
  const { packageName, clientEmail, privateKey, enabled } = appConfig.googlePlay;

  if (!enabled) {
    const error = new Error(
      "Google Play billing is disabled. Set GOOGLE_PLAY_BILLING_ENABLED=true once " +
      "the Play Console products and service account are configured."
    );
    error.code = "GOOGLE_PLAY_DISABLED";
    throw error;
  }

  if (!packageName || !clientEmail || !privateKey) {
    const error = new Error(
      "Missing Google Play env vars. Set GOOGLE_PLAY_PACKAGE_NAME, " +
      "GOOGLE_PLAY_CLIENT_EMAIL, and GOOGLE_PLAY_PRIVATE_KEY."
    );
    error.code = "GOOGLE_PLAY_CONFIG_MISSING";
    throw error;
  }

  return appConfig.googlePlay;
}

// The RTDN webhook authenticates by verifying Google's OIDC push token, so
// these two are as load-bearing as the signing secret is for Razorpay. Checked
// separately from the API credentials because the webhook can be stood up
// before or after the purchase path.
function assertGooglePlayRtdnConfig() {
  const { rtdnServiceAccountEmail, rtdnAudience } = appConfig.googlePlay;

  if (!rtdnServiceAccountEmail || !rtdnAudience) {
    const error = new Error(
      "Missing Google Play RTDN env vars. Set GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT and " +
      "GOOGLE_PLAY_RTDN_AUDIENCE to the Pub/Sub push subscription's service account " +
      "and endpoint URL."
    );
    error.code = "GOOGLE_PLAY_RTDN_CONFIG_MISSING";
    throw error;
  }

  return appConfig.googlePlay;
}

function getMaskedConfigSnapshot() {
  return {
    env: appConfig.env,
    port: appConfig.port,
    mongoUri: maskSecret(appConfig.mongoUri, 12, 6),
    cloudinaryCloudName: appConfig.cloudinary.cloudName,
    cloudinaryApiKey: maskSecret(appConfig.cloudinary.apiKey),
    redisConfigured: Boolean(appConfig.redis.url),
    firebaseProjectId: appConfig.firebase.projectId || "[missing]",
    firebaseClientEmail: appConfig.firebase.clientEmail || "[missing]",
    googleVisionProjectId: appConfig.googleVision.projectId || "[missing]",
    googleVisionClientEmail: appConfig.googleVision.clientEmail || "[missing]",
    openaiConfigured: Boolean(appConfig.ai.openaiApiKey),
    geminiConfigured: Boolean(appConfig.ai.geminiApiKey),
    smtpUser: appConfig.smtp.user ? maskSecret(appConfig.smtp.user, 3, 8) : "[missing]",
    // Password reset lives or dies on these two. The sender is printed in full
    // because its domain has to be verified at resend.com/domains — a boot log
    // that only says "configured: true" hides the one setting that breaks it.
    resendConfigured: Boolean(appConfig.resend.apiKey),
    resendFrom: appConfig.resend.from || "[missing]",
    // Play billing is the Android revenue path; if it is enabled but the
    // service account is absent, every purchase fails verification and the
    // user is charged without being activated. Print enough to spot that at
    // boot — the package name and the client email, never the private key.
    googlePlayEnabled: appConfig.googlePlay.enabled,
    googlePlayPackageName: appConfig.googlePlay.packageName || "[missing]",
    googlePlayClientEmail: appConfig.googlePlay.clientEmail || "[missing]",
    googlePlayRtdnConfigured: Boolean(
      appConfig.googlePlay.rtdnServiceAccountEmail && appConfig.googlePlay.rtdnAudience
    ),
  };
}

module.exports = {
  appConfig,
  assertFirebaseAdminConfig,
  assertGooglePlayConfig,
  assertGooglePlayRtdnConfig,
  assertGoogleVisionConfig,
  getMaskedConfigSnapshot,
  maskSecret,
};
