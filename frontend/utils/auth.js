/**
 * Client-side access-token management.
 *
 * Web:
 *  - Access token lives in module memory only.
 *  - A legacy localStorage token is migrated into memory once, then removed.
 *
 * Capacitor Android:
 *  - Access token is persisted through the first-party EdgeAuthStorage plugin.
 *  - EdgeAuthStorage encrypts values with Android Keystore AES-GCM.
 *  - localStorage is used only as a one-time legacy migration source and is
 *    cleared immediately afterward.
 *
 * Capacitor iOS:
 *  - Same EdgeAuthStorage plugin name and contract, backed by the iOS Keychain.
 *
 * `utils/authStorage.js` picks the adapter per platform; this module never
 * reaches for a native plugin itself.
 *
 * Refresh tokens remain backend-owned httpOnly cookies.
 *
 * Persistence is best-effort by design
 * ------------------------------------
 * Memory is the source of truth for "is this request authenticated"; storage
 * only decides whether the session survives a process kill. So every storage
 * helper below reports failure as a value — `false` / `null` — and never by
 * throwing. A device that cannot write to its own Keychain is still a device
 * whose user just signed in successfully, and must still reach the dashboard.
 *
 * Genuine auth failures (bad credentials, 401, revoked refresh family) are not
 * storage failures and keep flowing through the API layer untouched.
 */

import { AUTH_STORAGE_KIND, getAuthStorage } from "./authStorage.js";

const LEGACY_TOKEN_KEY = "token";
const SECURE_TOKEN_KEY = "accessToken";

// Debug logging — set localStorage.authDebug = "1" in dev to enable.
function __authLog(...args) {
  if (typeof window !== "undefined" && window.localStorage?.getItem?.("authDebug") === "1") {
    console.log("[AUTH]", new Date().toISOString(), ...args);
  }
}

function authLog(level, event, meta = {}) {
  if (typeof window === "undefined") return;
  const log = console[level] || console.info;
  log(`[AUTH] ${event}`, {
    at: new Date().toISOString(),
    appState: document.visibilityState || "unknown",
    native: isNativeCapacitor(),
    ...meta,
  });
}

let _memoryToken = null;
let _hydrated = false;
let _hydratePromise = null;
// Serialises writes to native storage so a logout cannot be overtaken by an
// in-flight token write. INVARIANT: this promise never rejects. It only ever
// holds the result of secureSetToken / secureRemoveToken, both of which report
// failure as `false`. A rejected _persistPromise would poison every later
// `await setAuthToken()` / `await clearAuthToken()` / flush for the lifetime of
// the page, which is exactly how a storage hiccup used to become a dead login.
let _persistPromise = Promise.resolve(true);

// Belt and braces around the invariant above: anything assigned to
// _persistPromise goes through here, so even a future caller that hands over a
// rejecting promise cannot strand the auth lifecycle.
function trackPersist(promise) {
  _persistPromise = Promise.resolve(promise).catch((error) => {
    authLog("warn", "secure_storage_persist_swallowed", {
      error: error?.message || String(error),
    });
    return false;
  });
  return _persistPromise;
}

function isBrowser() {
  return typeof window !== "undefined";
}

export function isNativeCapacitor() {
  if (!isBrowser()) return false;
  try {
    return Boolean(window.Capacitor?.isNativePlatform?.());
  } catch {
    return false;
  }
}

// Resolved storage adapter for this platform. `null` means "nothing persists the
// access token here" — by design on web and during SSR, and as a degraded state
// on a native build whose EdgeAuthStorage plugin is missing. Either way it is a
// supported state, not an error. See utils/authStorage.js for the mapping.
//
// Memoised per kind only for logging; the adapter lookup itself is cheap and is
// re-done every call so a plugin that registers late (native bridge still
// settling during a cold start) is picked up rather than cached away as absent.
let _loggedStorageKind = null;

function getSecureStorage() {
  if (!isNativeCapacitor()) return null;
  try {
    const storage = getAuthStorage();
    const kind = storage?.kind || AUTH_STORAGE_KIND.NONE;
    if (kind !== _loggedStorageKind) {
      _loggedStorageKind = kind;
      // NONE on a native platform means the build is missing its EdgeAuthStorage
      // plugin: the session will be memory-only until that is fixed.
      if (kind === AUTH_STORAGE_KIND.NONE) {
        authLog("warn", "secure_storage_unavailable", { kind });
      } else {
        authLog("info", "secure_storage_selected", { kind });
      }
    }
    return storage;
  } catch (error) {
    // Resolving storage must never be able to fail a sign-in.
    authLog("warn", "secure_storage_unavailable", {
      error: error?.message || String(error),
    });
    return null;
  }
}

function decodeJwtPayload(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    return JSON.parse(window.atob(padded));
  } catch {
    return null;
  }
}

// Refresh 90 seconds before JWT expiry. Subtracting this buffer would keep an
// already-expired token alive and make a 401 retry reuse the same JWT.
const CLOCK_SKEW_MS = 90_000;

function isTokenValid(token) {
  const payload = decodeJwtPayload(token);
  return Boolean(payload?.exp && payload.exp * 1000 > Date.now() + CLOCK_SKEW_MS);
}

function tokenExpiresInMs(token) {
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return 0;
  return payload.exp * 1000 - Date.now();
}

function readLegacyToken() {
  if (!isBrowser()) return null;
  try {
    return localStorage.getItem(LEGACY_TOKEN_KEY);
  } catch {
    return null;
  }
}

function clearLegacyToken() {
  if (!isBrowser()) return;
  try {
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    // Ignore storage failures.
  }
}

// Android Keystore can fail transiently during screen-lock, doze mode, post-boot
// before DE storage unlocks, and right after app resume while KeyguardManager
// settles. A single attempt loses the token; retry with backoff covers the
// transient window (typically <600ms).
const SECURE_STORAGE_MAX_ATTEMPTS = 3;
const SECURE_STORAGE_BACKOFF_MS = [0, 200, 500];

function reportSecureStorageFailure(operation, error) {
  authLog("error", "secure_storage_failed_terminal", {
    operation,
    error: error?.message || String(error),
  });
  // Surface to Sentry if available. This should never fire in steady state;
  // when it does it is the smoking gun for the 5–15 minute logout bug.
  try {
    if (typeof window !== "undefined" && window.Sentry?.captureException) {
      window.Sentry.captureException(error, {
        tags: { area: "auth_storage", operation },
      });
    }
  } catch {
    /* Sentry not loaded; ignore. */
  }
}

async function withSecureStorageRetry(operation, fn) {
  let lastError;
  for (let attempt = 0; attempt < SECURE_STORAGE_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, SECURE_STORAGE_BACKOFF_MS[attempt] || 500)
      );
      authLog("warn", "secure_storage_retry", { operation, attempt });
    }
    try {
      return await fn();
    } catch (error) {
      lastError = error;
    }
  }
  reportSecureStorageFailure(operation, lastError);
  throw lastError;
}

/** @returns {Promise<string|null>} the stored token, or null. Never throws. */
async function secureGetToken() {
  const storage = getSecureStorage();
  if (!storage?.get) return null;
  try {
    const result = await withSecureStorageRetry("get", () =>
      storage.get({ key: SECURE_TOKEN_KEY })
    );
    const hasValue = typeof result?.value === "string" && result.value.length > 0;
    authLog("info", "secure_get_complete", { hasValue });
    return hasValue ? result.value : null;
  } catch {
    // Already reported via withSecureStorageRetry. Return null so callers can
    // fall back to silentRefresh; do NOT throw upstream — losing a Keystore
    // read should never cascade into a logout when the cookie can still rescue.
    return null;
  }
}

/**
 * Persists the token for this platform.
 *
 * @returns {Promise<boolean>} true if it reached storage. NEVER throws and
 * never rejects — a `false` here means "this session will not survive a process
 * kill", not "this sign-in failed". The caller must keep going.
 */
async function secureSetToken(token) {
  const storage = getSecureStorage();
  // No storage on this platform/build: memory-only session. The httpOnly
  // refresh cookie still restores it on the next cold start.
  if (!storage?.set) return false;
  try {
    await withSecureStorageRetry("set", () =>
      storage.set({ key: SECURE_TOKEN_KEY, value: token })
    );
    authLog("info", "secure_set_complete", { tokenExpiresInMs: tokenExpiresInMs(token) });
    return true;
  } catch {
    // Persistence failed even after retries — the in-memory token is the only
    // copy. Next process kill will lose it; the user will need to re-auth via
    // the refresh cookie on next launch. Already reported to Sentry by
    // withSecureStorageRetry; swallowed here so login/refresh carry on.
    return false;
  }
}

/**
 * Deletes the persisted token.
 *
 * @returns {Promise<boolean>} true if storage confirmed the delete. NEVER
 * throws: a device that cannot clear its Keychain must still be able to end
 * the current session.
 */
async function secureRemoveToken() {
  const storage = getSecureStorage();
  if (!storage?.remove) return false;
  try {
    await withSecureStorageRetry("remove", () =>
      storage.remove({ key: SECURE_TOKEN_KEY })
    );
    authLog("info", "secure_remove_complete");
    return true;
  } catch {
    // Already reported. The in-memory token is gone either way, so the session
    // on this device is over; only "survives a relaunch" is at risk.
    return false;
  }
}

// Listeners for the in-memory token changing hands. This is the ONE place a
// token is written (setAuthToken, clearAuthToken and hydration all funnel
// through rememberToken), so it is where "the user just signed in / out" is
// observable. Play billing's launch reconcile subscribes here: a purchase
// completed while signed out must be verified as soon as someone signs in.
const _tokenListeners = new Set();

export function subscribeAuthToken(listener) {
  if (typeof listener !== "function") return () => {};
  _tokenListeners.add(listener);
  return () => {
    _tokenListeners.delete(listener);
  };
}

function rememberToken(token) {
  const previous = _memoryToken;
  _memoryToken = token || null;
  if (previous !== _memoryToken) {
    for (const listener of _tokenListeners) {
      try {
        listener({ token: _memoryToken, previous });
      } catch {
        // A listener must never be able to break auth itself.
      }
    }
  }
  return _memoryToken;
}

/**
 * Loads the access token into memory.
 *
 * Native startup order:
 *  1. Read encrypted native storage.
 *  2. If missing, migrate a valid legacy localStorage token into native storage.
 *  3. Always delete the legacy localStorage token.
 */
export async function hydrateAuthToken() {
  authLog("info", "AUTH_HYDRATE_START", {
    alreadyHydrated: _hydrated,
    hasMemoryToken: Boolean(_memoryToken),
  });
  if (_hydrated) {
    const token = getValidToken();
    authLog("info", token ? "AUTH_HYDRATE_SUCCESS" : "AUTH_HYDRATE_EMPTY", {
      source: "memory_or_hydrated",
      tokenExpiresInMs: token ? tokenExpiresInMs(token) : 0,
    });
    return token;
  }
  if (_hydratePromise) return _hydratePromise;

  _hydratePromise = (async () => {
    try {
      if (_memoryToken && isTokenValid(_memoryToken)) return _memoryToken;
      if (_memoryToken) rememberToken(null);

      if (isNativeCapacitor()) {
        const stored = await secureGetToken();
        if (stored && isTokenValid(stored)) {
          clearLegacyToken();
          __authLog("hydrateAuthToken: loaded valid stored token, expires in", tokenExpiresInMs(stored), "ms");
          authLog("info", "AUTH_HYDRATE_SUCCESS", {
            source: "secure_storage",
            tokenExpiresInMs: tokenExpiresInMs(stored),
          });
          return rememberToken(stored);
        }
        // Do NOT delete Keystore if stored token looks expired — it may still be valid
        // on the server (clock skew). Leave it in place; silentRefresh will overwrite it.
        if (stored) {
          __authLog("hydrateAuthToken: stored token appears expired (may be clock skew), keeping for refresh");
        }

        const legacy = readLegacyToken();
        clearLegacyToken();
        if (legacy && isTokenValid(legacy)) {
          // Take the token into memory whether or not the migration write
          // lands. A valid token we already hold is worth more than a tidy
          // Keychain; if the write failed, the refresh cookie covers the next
          // cold start.
          const persisted = await secureSetToken(legacy);
          authLog("info", "AUTH_HYDRATE_SUCCESS", {
            source: "legacy_migration",
            persisted,
            tokenExpiresInMs: tokenExpiresInMs(legacy),
          });
          return rememberToken(legacy);
        }

        authLog("info", "AUTH_HYDRATE_EMPTY", { source: "native" });
        return null;
      }

      const legacy = readLegacyToken();
      clearLegacyToken();
      if (legacy && isTokenValid(legacy)) {
        authLog("info", "AUTH_HYDRATE_SUCCESS", {
          source: "legacy_web",
          tokenExpiresInMs: tokenExpiresInMs(legacy),
        });
        return rememberToken(legacy);
      }
      authLog("info", "AUTH_HYDRATE_EMPTY", { source: "web" });
      return null;
    } catch (error) {
      authLog("error", "hydrate failed", { error: error?.message || String(error) });
      rememberToken(null);
      clearLegacyToken();
      return null;
    } finally {
      _hydrated = true;
      _hydratePromise = null;
    }
  })();

  return _hydratePromise;
}

/**
 * Ends the session on this device.
 *
 * Memory is cleared synchronously, so the user is signed out the instant this is
 * called. The returned promise resolves `true` when the persisted copy was
 * removed — or when there was never one to remove, as on web — and `false` when
 * storage refused or was unavailable. It never rejects, so a Keychain / Keystore
 * failure cannot leave the user stuck on a screen they just logged out of.
 *
 * @returns {Promise<boolean>} whether a persisted token was cleared.
 */
export function clearAuthToken() {
  // Whatever the previous account had cached must not survive into the next
  // sign-in on this device. Lazy import: persistedQueryCache is client-only.
  import("@/utils/persistedQueryCache")
    .then((m) => m.clearPersistedQueryCache())
    .catch(() => {});
  authLog("info", "AUTH_LOGOUT_TRIGGERED", {
    reason: "clearAuthToken",
    hadMemoryToken: Boolean(_memoryToken),
    hydrated: _hydrated,
  });
  __authLog("clearAuthToken: called — wiping memory + Keystore");
  // Memory first: the session is over the moment this returns, regardless of
  // what storage does next.
  rememberToken(null);
  _hydrated = true;
  clearLegacyToken();
  // Always reassign, including on web. Returning a *previous* _persistPromise
  // would hand callers a promise that has nothing to do with this logout.
  return trackPersist(isNativeCapacitor() ? secureRemoveToken() : Promise.resolve(true));
}

/**
 * Makes `token` the active access token.
 *
 * The in-memory token — the one every API request actually uses — is set
 * synchronously, before this function returns. Persistence happens afterwards
 * and is reported, never thrown: the returned promise resolves `true` if the
 * token reached secure storage and `false` if it did not, and never rejects.
 *
 * On web it always resolves `false`, because web deliberately keeps the token in
 * memory only — that is the designed behaviour, not a failure.
 *
 * Callers may therefore navigate as soon as this returns. Awaiting it only buys
 * the guarantee that the session will survive a process kill.
 *
 * @param {string|null} token
 * @returns {Promise<boolean>} whether the token was persisted.
 */
export function setAuthToken(token) {
  authLog("info", "setAuthToken", {
    hasToken: Boolean(token),
    tokenExpiresInMs: token ? tokenExpiresInMs(token) : 0,
  });
  __authLog("setAuthToken: storing new token, expires in", token ? tokenExpiresInMs(token) : "N/A", "ms");

  // ── Memory first ────────────────────────────────────────────────────────
  // Synchronous, before any await. By the time this line returns, getValidToken()
  // answers with the new token and the apiClient request interceptor will attach
  // it — so callers do not have to await persistence before making API calls.
  rememberToken(token);
  _hydrated = true;
  clearLegacyToken();

  // ── Persistence after ───────────────────────────────────────────────────
  // secureSetToken / secureRemoveToken handle their own retry + Sentry
  // reporting and resolve `false` (never throw) on terminal failure, so the
  // promise returned here never rejects. Awaiting it is therefore safe but
  // optional: it only decides whether the session outlives a process kill.
  if (isNativeCapacitor()) {
    return trackPersist(token ? secureSetToken(token) : secureRemoveToken());
  }

  // Web: nothing was written, so say so rather than claiming a persisted copy
  // exists. The httpOnly refresh cookie is what survives a reload here.
  return trackPersist(Promise.resolve(false));
}

/**
 * Waits for the most recent persistence attempt to settle.
 *
 * @returns {Promise<boolean>} the result of that attempt. Never rejects.
 */
export async function flushAuthTokenStorage() {
  return await _persistPromise;
}

export function getValidToken() {
  if (_memoryToken) {
    if (isTokenValid(_memoryToken)) return _memoryToken;
    // Only clear memory — do NOT delete Keystore here. The token may still be
    // valid server-side (clock skew) and silentRefresh needs it as a fallback.
    __authLog("getValidToken: memory token expired, clearing memory only");
    rememberToken(null);
  }

  if (!isBrowser() || isNativeCapacitor()) return null;

  const legacy = readLegacyToken();
  clearLegacyToken();
  if (legacy && isTokenValid(legacy)) return rememberToken(legacy);

  return null;
}

export function hasValidAuthToken() {
  return Boolean(getValidToken());
}

export function getTokenPayload() {
  const token = getValidToken();
  if (!token) return null;
  return decodeJwtPayload(token);
}

export function getAuthDiagnostics() {
  const token = getValidToken();
  return {
    hydrated: _hydrated,
    hydrationInFlight: Boolean(_hydratePromise),
    hasMemoryToken: Boolean(_memoryToken),
    hasValidToken: Boolean(token),
    tokenExpiresInMs: token ? tokenExpiresInMs(token) : 0,
    native: isNativeCapacitor(),
    // Which backend persistence resolved to on the last storage call, so an
    // iOS build that fell back off the Keychain is visible in every auth log.
    storageKind: _loggedStorageKind || AUTH_STORAGE_KIND.NONE,
    appState: typeof document !== "undefined" ? document.visibilityState : "unknown",
  };
}

export const __authStorageInternals = {
  SECURE_TOKEN_KEY,
  LEGACY_TOKEN_KEY,
  decodeJwtPayload,
  isTokenValid,
  tokenExpiresInMs,
};

// Kick off Keystore hydration the moment this module is parsed — before React
// renders the dashboard. The _hydratePromise singleton means this is a no-op
// if called again inside useEffect. Saves ~150–200ms on Capacitor Android.
if (typeof window !== "undefined") {
  void hydrateAuthToken();
}
