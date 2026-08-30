"use strict";

// ─── Google Play Developer API client ───────────────────────────────────────
//
// Thin wrapper over the two Android Publisher endpoints this integration needs:
//
//   purchases.subscriptionsv2.get      — the authoritative subscription state
//   purchases.subscriptions.acknowledge — confirm we granted entitlement
//
// Built on google-auth-library + global fetch rather than the `googleapis`
// package. `googleapis` bundles client surfaces for several hundred Google APIs
// (tens of MB, and a correspondingly large dependency graph) to give us two
// REST calls. google-auth-library is already in the tree as a dependency of
// firebase-admin and @google-cloud/vision, so this adds signing and token
// caching without adding anything new to install.
//
// SECURITY: the service-account key used here exists only in the backend
// environment. It is never sent to the client, never written to disk by this
// process, never logged (config/index.js masks it in the boot snapshot, and
// utils/logger redacts anything matching /private[-_]?key/). The Android app
// never talks to this API — it only hands us an opaque purchase token.

const { JWT } = require("google-auth-library");
const { appConfig, assertGooglePlayConfig } = require("../config");
const ApiError = require("../utils/ApiError");
const { logger } = require("../utils/logger");
const { captureOperationalError } = require("../config/sentry");

const ANDROID_PUBLISHER_BASE = "https://androidpublisher.googleapis.com/androidpublisher/v3";
const SCOPE = "https://www.googleapis.com/auth/androidpublisher";

// The JWT client caches and refreshes its own access token, so this is built
// once per process. Rebuilt automatically if config changes under a test.
let cachedClient = null;
let cachedClientEmail = null;

function getAuthClient() {
  const config = assertGooglePlayConfig();

  if (cachedClient && cachedClientEmail === config.clientEmail) {
    return cachedClient;
  }

  cachedClient = new JWT({
    email: config.clientEmail,
    key: config.privateKey,
    scopes: [SCOPE],
  });
  cachedClientEmail = config.clientEmail;
  return cachedClient;
}

// Exposed for tests, which swap credentials between cases.
function resetAuthClient() {
  cachedClient = null;
  cachedClientEmail = null;
}

/**
 * Classify a Play API failure so callers can decide whether to retry.
 *
 * This distinction is the difference between "the user did not really buy
 * this" and "Google was briefly unavailable". Getting it wrong in either
 * direction is expensive: treat a 503 as invalid and a paying customer is
 * refused; treat a 404 as retryable and a forged token is retried forever.
 */
function classifyPlayError(status) {
  // 400/404 — the token is not a thing Google recognises for this package.
  // 410 — the purchase is gone (very old, or the token was already replaced).
  if (status === 400 || status === 404 || status === 410) {
    return { retryable: false, code: "GOOGLE_PLAY_PURCHASE_NOT_FOUND", statusCode: 400 };
  }
  // 401/403 — OUR credentials are wrong or the service account lost access to
  // the Play Console. Never the user's fault, and never a reason to deny an
  // entitlement they may have paid for. Surfaced as a 502 so it pages us.
  if (status === 401 || status === 403) {
    return { retryable: true, code: "GOOGLE_PLAY_AUTH_FAILED", statusCode: 502 };
  }
  if (status === 429) {
    return { retryable: true, code: "GOOGLE_PLAY_RATE_LIMITED", statusCode: 503 };
  }
  return { retryable: true, code: "GOOGLE_PLAY_UNAVAILABLE", statusCode: 502 };
}

async function callPlayApi(path, { method = "GET", body, operation } = {}) {
  const config = assertGooglePlayConfig();
  const client = getAuthClient();

  let headers;
  try {
    headers = await client.getRequestHeaders();
  } catch (error) {
    // Bad key material, clock skew, or no network to Google's token endpoint.
    // Fail closed and loudly — this is a misconfiguration, not a user error.
    captureOperationalError(error, {
      subsystem: "google_play",
      tags: { operation: "authorize" },
    });
    logger.error("GOOGLE_PLAY_AUTH_ERROR", {
      operation,
      // Never the key itself; the client email is not secret and is what an
      // operator needs in order to fix Play Console permissions.
      clientEmail: config.clientEmail,
      error: error?.message,
    });
    throw new ApiError(
      502,
      "Unable to reach Google Play for verification",
      "GOOGLE_PLAY_AUTH_FAILED"
    );
  }

  // AbortSignal.timeout keeps a hung Google connection from holding an Express
  // worker for the full socket timeout.
  const controller = AbortSignal.timeout(config.apiTimeoutMs);

  let response;
  try {
    response = await fetch(`${ANDROID_PUBLISHER_BASE}${path}`, {
      method,
      // getRequestHeaders() returns a Headers instance on newer versions of
      // google-auth-library and a plain object on older ones; spreading either
      // through Object.fromEntries-friendly iteration is not safe, so hand it
      // straight to fetch, which accepts both.
      headers: {
        ...(typeof headers?.entries === "function"
          ? Object.fromEntries(headers.entries())
          : headers),
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller,
    });
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    logger.warn("GOOGLE_PLAY_REQUEST_FAILED", {
      operation,
      timedOut,
      error: error?.message,
    });
    throw new ApiError(
      502,
      "Google Play verification is temporarily unavailable",
      timedOut ? "GOOGLE_PLAY_TIMEOUT" : "GOOGLE_PLAY_UNAVAILABLE"
    );
  }

  if (response.status === 204) return {};

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const { code, statusCode, retryable } = classifyPlayError(response.status);
    // Google's error body carries a human-readable reason and no user PII, so
    // it is safe and genuinely useful to log.
    logger.warn("GOOGLE_PLAY_API_ERROR", {
      operation,
      httpStatus: response.status,
      code,
      retryable,
      reason: payload?.error?.message || null,
    });
    const error = new ApiError(
      statusCode,
      statusCode >= 500
        ? "Google Play verification is temporarily unavailable"
        : "Google Play does not recognise this purchase",
      code
    );
    error.retryable = retryable;
    error.playHttpStatus = response.status;
    throw error;
  }

  return payload || {};
}

/**
 * Fetch the authoritative state of a subscription purchase.
 *
 * Everything the entitlement decision rests on comes from here — product,
 * base plan, state, expiry, acknowledgement, and the account identifier the
 * client passed at purchase time. Nothing the Android app sends is trusted
 * beyond the token used to make this call.
 *
 * https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2/get
 */
async function getSubscriptionPurchase(purchaseToken) {
  const config = assertGooglePlayConfig();
  return callPlayApi(
    `/applications/${encodeURIComponent(config.packageName)}` +
      `/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`,
    { operation: "subscriptionsv2.get" }
  );
}

/**
 * Acknowledge a subscription purchase (Phase 6).
 *
 * Google AUTOMATICALLY REFUNDS a subscription purchase that has not been
 * acknowledged within three days and revokes the entitlement. So this is not
 * bookkeeping — skipping it silently gives the money back.
 *
 * Idempotent from our side: acknowledging an already-acknowledged purchase
 * returns 400 with reason "already acknowledged", which the caller treats as
 * success rather than as a failure. The caller is also responsible for never
 * calling this before verification has passed.
 *
 * Note this is the v1 `purchases.subscriptions` endpoint — subscriptionsv2 is
 * read-only and has no acknowledge method, so acknowledgement still goes
 * through the older resource. That is Google's current design, not an
 * oversight here.
 */
async function acknowledgeSubscriptionPurchase(productId, purchaseToken) {
  const config = assertGooglePlayConfig();
  return callPlayApi(
    `/applications/${encodeURIComponent(config.packageName)}` +
      `/purchases/subscriptions/${encodeURIComponent(productId)}` +
      `/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`,
    { method: "POST", body: {}, operation: "subscriptions.acknowledge" }
  );
}

module.exports = {
  getSubscriptionPurchase,
  acknowledgeSubscriptionPurchase,
  // Exported for testing
  classifyPlayError,
  resetAuthClient,
  ANDROID_PUBLISHER_BASE,
};
