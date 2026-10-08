"use client";

/**
 * Turns any thrown thing into a sentence a user should read.
 *
 * The split this enforces:
 *
 *   developer log → the detailed technical reason, kept in full
 *   user message  → what happened and what to do next
 *
 * Shipping through Capacitor means an error can originate from the native
 * bridge, Firebase, axios, or the backend, and most of those strings are
 * unreadable or actively misleading in an app:
 *
 *   "ChecklistNotification" plugin is not implemented on ios
 *   auth/popup-closed-by-user
 *   Request failed with status undefined
 *   allow popups for localhost:3000
 *
 * A reviewer seeing any of those reads it as an unfinished app. So nothing
 * reaches the UI unless it passes isTechnicalMessage(); everything else falls
 * back to copy written for the situation.
 *
 * This deliberately does NOT flatten every failure into "Something went wrong" —
 * see the network and offline branches, and the per-call fallbacks. A specific
 * message the user can act on is the goal; the generic one is the last resort.
 */

import * as Sentry from "@sentry/nextjs";

/**
 * Text that means "written for a developer".
 *
 * Each entry is something actually reachable in this app, not a guess:
 * the Capacitor bridge's own wording, Firebase's `auth/*` codes, the axios
 * fallback built in services/apiClient.js, Chromium net errors, stack frames,
 * Mongo/Mongoose text leaking through an unsanitised 500, and the dev host that
 * used to be hardcoded into the Google sign-in copy.
 */
const TECHNICAL_PATTERNS = [
  /plugin\s+.*is not implemented/i,
  /not implemented on (ios|android|web)/i,
  /capacitor(exception|:\/\/)/i,
  /localhost(:\d+)?|127\.0\.0\.1|0\.0\.0\.0|10\.0\.2\.2/i,
  /\bauth\/[a-z-]+\b/i,
  /firebase(error)?\s*:/i,
  /\bFirebaseError\b/,
  /request failed with status/i,
  /\bERR_[A-Z0-9_]+\b/,
  /\b(AxiosError|Network Error|Failed to fetch|NetworkError)\b/i,
  /\bat\s+[\w$.<>]+\s*\(/,
  /\b(MongoError|MongoServerError|CastError|ValidationError)\b|E11000/,
  /\[object\s+\w+\]/,
  /^\s*[[{]/,
  /\bcom\.(edgecipline|google|android|apple)\b/,
  /\b(NSError|OSStatus|NSLocalizedDescription)\b/,
  /\bundefined\b|\bnull\b|\bNaN\b/,
  /<\/?[a-z][\s\S]*>/i,
];

/** Browser-only advice. Meaningless in an app, and it dates the copy on web too. */
const BROWSER_ADVICE_PATTERNS = [
  /allow popups?/i,
  /popup (was )?blocked/i,
  /refresh the page/i,
  /browser settings/i,
  /another tab/i,
  /different browser/i,
];

/** True when `text` should never be rendered to a user. */
export function isTechnicalMessage(text) {
  if (typeof text !== "string") return true;
  const trimmed = text.trim();
  if (!trimmed) return true;
  // A paragraph is a log line, not a toast. Real user copy is one sentence.
  if (trimmed.length > 180) return true;
  // A single token with no space is a code, not a sentence.
  if (!/\s/.test(trimmed)) return true;
  return (
    TECHNICAL_PATTERNS.some((pattern) => pattern.test(trimmed)) ||
    BROWSER_ADVICE_PATTERNS.some((pattern) => pattern.test(trimmed))
  );
}

/**
 * True when the failure is the network rather than the request.
 *
 * Worth separating because "check your connection" is actionable where a generic
 * apology is not — the user can do something about it.
 */
export function isConnectivityError(error) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const text = [error?.code, error?.name, error?.message].filter(Boolean).join(" ");
  // The Chromium ERR_CONNECTION_*/ERR_NAME_* family all mean "the request never
  // left", which is the same thing to a user as being offline — and far more
  // useful to say than a generic apology.
  if (/network-request-failed|Network Error|Failed to fetch|ECONNABORTED|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|timeout/i.test(text)) {
    return true;
  }
  if (/\bERR_(NETWORK|INTERNET_DISCONNECTED|CONNECTION_[A-Z_]+|NAME_NOT_RESOLVED|NETWORK_CHANGED|ADDRESS_UNREACHABLE)\b/i.test(text)) {
    return true;
  }
  // The API layer surfaces an upstream outage as a 5xx with no body.
  return error?.status === 0;
}

export const OFFLINE_MESSAGE =
  "You appear to be offline. Check your connection and try again.";

/**
 * The message to show for `error`.
 *
 * Order of preference:
 *   1. a connectivity hint, when that is what actually went wrong
 *   2. the backend's own message — those are written for users already
 *   3. the error's message, but only if it reads like a sentence
 *   4. `fallback`, which the caller writes for its specific situation
 *
 * @param {unknown} error
 * @param {string} fallback - situation-specific copy. Required: a caller that
 *   cannot say what failed should not be calling this.
 * @returns {string}
 */
export function getUserMessage(error, fallback) {
  if (isConnectivityError(error)) return OFFLINE_MESSAGE;

  // services/apiClient.js puts the API's sanitised message here.
  const serverMessage = error?.data?.message || error?.response?.data?.message;
  if (serverMessage && !isTechnicalMessage(serverMessage)) return serverMessage;

  const message = typeof error === "string" ? error : error?.message;
  if (message && !isTechnicalMessage(message)) return message;

  return fallback;
}

/**
 * Records the technical reason and returns the user-facing sentence.
 *
 * This is the one-call version of the contract at the top of the file, so a
 * caller cannot accidentally keep the technical string and drop the log, or the
 * other way round. Observability is unaffected: the full error still reaches the
 * console and Sentry with its code, status and message.
 *
 * @param {string} event - stable snake_case id, e.g. "trade_update_failed".
 * @param {unknown} error
 * @param {string} fallback
 * @returns {string} the message to show the user.
 */
export function reportUserError(event, error, fallback) {
  // Never the request body, never a token — only the failure's own shape.
  const detail = {
    event,
    code: error?.code || error?.data?.errorCode || null,
    status: error?.status ?? error?.response?.status ?? null,
    message: error?.message || null,
    requestId: error?.data?.requestId || null,
  };

  try {
    console.warn(`[${event}]`, detail);
  } catch {
    /* console unavailable */
  }

  try {
    Sentry.captureException(error instanceof Error ? error : new Error(event), {
      tags: { area: "user_error", event },
      extra: detail,
    });
  } catch {
    // Sentry not initialised (web dev, or the SDK was pruned) — the console
    // line above is still the record.
  }

  return getUserMessage(error, fallback);
}
