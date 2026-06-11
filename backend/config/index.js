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

const appConfig = {
  env: process.env.NODE_ENV || "development",
  port: readNumber("PORT", 5000),
  logLevel: process.env.LOG_LEVEL || "info",
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
  },
  ocrWorker: {
    concurrency: readNumber("OCR_WORKER_CONCURRENCY", 5),
    lockDurationMs: readNumber("OCR_WORKER_LOCK_DURATION_MS", 300000),
  },
  upload: {
    maxFileSizeBytes: readNumber("UPLOAD_MAX_FILE_SIZE_BYTES", 2 * 1024 * 1024),
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
  morningMentor: {
    enabled: readBoolean("ENABLE_MORNING_MENTOR_CRON", true),
    schedule: process.env.MORNING_MENTOR_CRON || "0 7 * * *",
    timezone: process.env.MORNING_MENTOR_TIMEZONE || "Asia/Kolkata",
    timezoneOffsetHours: readNumber("MORNING_MENTOR_TIMEZONE_OFFSET_HOURS", 5.5),
  },
  cors: {
    allowedOrigins: (process.env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    debug: readBoolean("CORS_DEBUG", false),
  },
  timezoneOffsetHours: readNumber("TIMEZONE_OFFSET_HOURS", 0),
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
  };
}

module.exports = {
  appConfig,
  assertFirebaseAdminConfig,
  assertGoogleVisionConfig,
  getMaskedConfigSnapshot,
  maskSecret,
};
