/**
 * Hand-off store for the short-lived password reset token.
 *
 * The token used to travel from /verify-otp to /reset-password as a query
 * parameter, which put a live credential into browser history, the Referer
 * header of anything the page loaded, and any log that records full URLs.
 * sessionStorage keeps it in the tab that earned it and drops it when the tab
 * closes.
 *
 * The stored copy also carries its own expiry so a stale tab shows "request a
 * new code" instead of firing a request the API will reject.
 */

const STORAGE_KEY = "edgecipline:password-reset";

// Matches the server's reset-token TTL (10 minutes), minus a small margin so
// the UI gives up just before the API would.
const CLIENT_TTL_MS = 9.5 * 60 * 1000;

function getStore() {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null; // Safari private mode and similar
  }
}

export function savePasswordResetSession({ email, resetToken }) {
  const store = getStore();
  if (!store || !email || !resetToken) return false;
  try {
    store.setItem(
      STORAGE_KEY,
      JSON.stringify({ email, resetToken, expiresAt: Date.now() + CLIENT_TTL_MS })
    );
    return true;
  } catch {
    return false;
  }
}

export function readPasswordResetSession() {
  const store = getStore();
  if (!store) return null;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.email || !parsed?.resetToken) return null;
    if (!parsed.expiresAt || parsed.expiresAt <= Date.now()) {
      store.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearPasswordResetSession() {
  const store = getStore();
  if (!store) return;
  try {
    store.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to clean up */
  }
}
