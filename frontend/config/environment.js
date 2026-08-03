// staging-api.stratedge.live is allowlisted so local debug APK builds can
// target staging. It still must pass every other production check (HTTPS,
// port 443, no path beyond /api) — this only exempts it from the generic
// staging/dev/test hostname heuristic below. Never point a release build here.
const PRODUCTION_API_HOSTS = new Set(["api.stratedge.live", "staging-api.stratedge.live"]);
const NON_PRODUCTION_HOST_PART =
  /(^|[.-])(localhost|staging|stage|dev|development|test|testing|qa|sandbox)([.-]|$)/i;
const LOCAL_OR_PRIVATE_HOST =
  /^(localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|0\.0\.0\.0|10\.0\.2\.2)$/i;

export const PUBLIC_ENVIRONMENT = Object.freeze({
  apiUrl: process.env.NEXT_PUBLIC_API_URL,
  firebaseApiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  firebaseAuthDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  firebaseProjectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  firebaseStorageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  firebaseMessagingSenderId:
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  firebaseAppId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  firebaseWebClientId: process.env.NEXT_PUBLIC_FIREBASE_WEB_CLIENT_ID,
  razorpayKeyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
  sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  sentryEnvironment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
  sentryRelease: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
});

const PRODUCTION_REQUIRED_FIELDS = {
  firebaseApiKey: "NEXT_PUBLIC_FIREBASE_API_KEY",
  firebaseAuthDomain: "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  firebaseProjectId: "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  firebaseStorageBucket: "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  firebaseMessagingSenderId: "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  firebaseAppId: "NEXT_PUBLIC_FIREBASE_APP_ID",
};

export class EnvironmentValidationError extends Error {
  constructor(errors) {
    super(`Invalid application environment:\n- ${errors.join("\n- ")}`);
    this.name = "EnvironmentValidationError";
    this.errors = errors;
  }
}

function hasPlaceholder(value) {
  return /^(your_|replace_|example|changeme|<)/i.test(String(value || "").trim());
}

function validateApiUrl(rawValue, isProduction, errors) {
  const value = String(rawValue || "").trim();

  if (!value) {
    errors.push("NEXT_PUBLIC_API_URL is required; no fallback is permitted.");
    return null;
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    errors.push("NEXT_PUBLIC_API_URL must be a valid absolute URL.");
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();
  const normalizedPath = parsed.pathname.replace(/\/+$/, "");

  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    errors.push(
      "NEXT_PUBLIC_API_URL must not contain credentials, query parameters, or a fragment."
    );
  }

  if (normalizedPath && normalizedPath.toLowerCase() !== "/api") {
    errors.push("NEXT_PUBLIC_API_URL path must be empty or /api.");
  }

  if (isProduction) {
    if (parsed.protocol !== "https:") {
      errors.push("Production NEXT_PUBLIC_API_URL must use HTTPS.");
    }
    if (parsed.port && parsed.port !== "443") {
      errors.push("Production NEXT_PUBLIC_API_URL must use the standard HTTPS port.");
    }
    if (LOCAL_OR_PRIVATE_HOST.test(hostname)) {
      errors.push("Production NEXT_PUBLIC_API_URL cannot use a local/private host.");
    }
    if (!PRODUCTION_API_HOSTS.has(hostname) && NON_PRODUCTION_HOST_PART.test(hostname)) {
      errors.push("Production NEXT_PUBLIC_API_URL cannot use a staging/dev/test host.");
    }
    if (!PRODUCTION_API_HOSTS.has(hostname)) {
      errors.push(
        `Production NEXT_PUBLIC_API_URL host must be one of: ${[
          ...PRODUCTION_API_HOSTS,
        ].join(", ")}.`
      );
    }
  } else if (!["http:", "https:"].includes(parsed.protocol)) {
    errors.push("NEXT_PUBLIC_API_URL must use HTTP or HTTPS.");
  }

  const apiBaseUrl = `${parsed.protocol}//${parsed.host}`;
  return {
    apiBaseUrl,
    apiUrl: `${apiBaseUrl}/api`,
  };
}

export function validateEnvironment(
  environment = PUBLIC_ENVIRONMENT,
  { mode = process.env.NODE_ENV } = {}
) {
  const isProduction = mode === "production";
  const errors = [];
  const api = validateApiUrl(environment.apiUrl, isProduction, errors);

  if (isProduction) {
    for (const [field, envName] of Object.entries(PRODUCTION_REQUIRED_FIELDS)) {
      const value = String(environment[field] || "").trim();
      if (!value) {
        errors.push(`${envName} is required for production builds.`);
      } else if (hasPlaceholder(value)) {
        errors.push(`${envName} still contains a placeholder value.`);
      }
    }

    const razorpayKeyId = String(environment.razorpayKeyId || "").trim();
    if (razorpayKeyId && !razorpayKeyId.startsWith("rzp_live_")) {
      errors.push(
        "NEXT_PUBLIC_RAZORPAY_KEY_ID must be a live key in production."
      );
    }

    const sentryDsn = String(environment.sentryDsn || "").trim();
    if (sentryDsn) {
      for (const [field, envName] of Object.entries({
        sentryEnvironment: "NEXT_PUBLIC_SENTRY_ENVIRONMENT",
        sentryRelease: "NEXT_PUBLIC_SENTRY_RELEASE",
      })) {
        const value = String(environment[field] || "").trim();
        if (!value) {
          errors.push(`${envName} is required when NEXT_PUBLIC_SENTRY_DSN is set.`);
        } else if (hasPlaceholder(value)) {
          errors.push(`${envName} still contains a placeholder value.`);
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new EnvironmentValidationError(errors);
  }

  return Object.freeze({
    ...environment,
    ...api,
    mode: isProduction ? "production" : "development",
  });
}
