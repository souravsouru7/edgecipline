

// The ONLY host a production build may talk to. Do not add staging here: the
// static export bakes this URL into the JS chunks, so a release AAB/IPA built
// against staging cannot be repaired after the fact — it ships pointing at
// staging data.
const PRODUCTION_API_HOSTS = new Set(["api.stratedge.live"]);

// Escape hatch for internal QA builds that need a production-mode bundle
// pointed at staging. It is opt-in per build and must never be set in a
// release pipeline; leaving it unset is what makes the guard above load-
// bearing. Previously staging sat in PRODUCTION_API_HOSTS permanently, which
// meant nothing actually enforced "never point a release build here".
const STAGING_API_HOSTS = new Set(["staging-api.stratedge.live"]);
const STAGING_API_OPT_IN =
  String(process.env.NEXT_PUBLIC_ALLOW_STAGING_API || "").trim() === "true";

function allowedProductionHosts() {
  return STAGING_API_OPT_IN
    ? new Set([...PRODUCTION_API_HOSTS, ...STAGING_API_HOSTS])
    : PRODUCTION_API_HOSTS;
}
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

// Matches anywhere in the value, not just the start. The previous
// start-anchored version let `rzp_live_placeholder` pass the "must be a live
// Razorpay key" check, which defeated the guard entirely — the token that
// marks a value as fake usually sits at the end, not the front.
const PLACEHOLDER_TOKEN =
  /(your[_-]|replace[_-]|example|changeme|placeholder|dummy|sample|todo|xxx+|<[^>]*>)/i;

function hasPlaceholder(value) {
  return PLACEHOLDER_TOKEN.test(String(value || "").trim());
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
    const allowedHosts = allowedProductionHosts();

    if (parsed.protocol !== "https:") {
      errors.push("Production NEXT_PUBLIC_API_URL must use HTTPS.");
    }
    if (parsed.port && parsed.port !== "443") {
      errors.push("Production NEXT_PUBLIC_API_URL must use the standard HTTPS port.");
    }
    if (LOCAL_OR_PRIVATE_HOST.test(hostname)) {
      errors.push("Production NEXT_PUBLIC_API_URL cannot use a local/private host.");
    }
    if (!allowedHosts.has(hostname) && NON_PRODUCTION_HOST_PART.test(hostname)) {
      errors.push(
        "Production NEXT_PUBLIC_API_URL cannot use a staging/dev/test host. " +
        "Set NEXT_PUBLIC_ALLOW_STAGING_API=true only for internal QA builds."
      );
    }
    if (!allowedHosts.has(hostname)) {
      errors.push(
        `Production NEXT_PUBLIC_API_URL host must be one of: ${[
          ...allowedHosts,
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
    // The prefix check alone is not enough — `rzp_live_placeholder` satisfies
    // it while being obviously fake, which is exactly what shipped before.
    if (razorpayKeyId && hasPlaceholder(razorpayKeyId)) {
      errors.push(
        "NEXT_PUBLIC_RAZORPAY_KEY_ID still contains a placeholder value."
      );
    }
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
