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
 * Refresh tokens remain backend-owned httpOnly cookies.
 */

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
let _persistPromise = Promise.resolve();

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

function getSecureStoragePlugin() {
  if (!isNativeCapacitor()) return null;
  return window.Capacitor?.Plugins?.EdgeAuthStorage || null;
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

// 90-second skew buffer: Android device clocks commonly run ahead by minutes.
// Without this, a 15-min token can appear expired after only 5 real minutes.
const CLOCK_SKEW_MS = 90_000;

function isTokenValid(token) {
  const payload = decodeJwtPayload(token);
  return Boolean(payload?.exp && payload.exp * 1000 > Date.now() - CLOCK_SKEW_MS);
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

async function secureGetToken() {
  const storage = getSecureStoragePlugin();
  if (!storage?.get) {
    authLog("warn", "secure_storage_unavailable");
    return null;
  }
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

async function secureSetToken(token) {
  const storage = getSecureStoragePlugin();
  if (!storage?.set) {
    authLog("warn", "secure_storage_unavailable");
    return false;
  }
  try {
    await withSecureStorageRetry("set", () =>
      storage.set({ key: SECURE_TOKEN_KEY, value: token })
    );
    authLog("info", "secure_set_complete", { tokenExpiresInMs: tokenExpiresInMs(token) });
    return true;
  } catch {
    // Persistence failed even after retries — the in-memory token is the only
    // copy. Next process kill will lose it; the user will need to re-auth via
    // the refresh cookie on next launch.
    return false;
  }
}

async function secureRemoveToken() {
  const storage = getSecureStoragePlugin();
  if (!storage?.remove) return;
  try {
    await withSecureStorageRetry("remove", () =>
      storage.remove({ key: SECURE_TOKEN_KEY })
    );
    authLog("info", "secure_remove_complete");
  } catch {
    /* Already reported. */
  }
}

function rememberToken(token) {
  _memoryToken = token || null;
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
  authLog("info", "hydrate start", {
    alreadyHydrated: _hydrated,
    hasMemoryToken: Boolean(_memoryToken),
  });
  if (_hydrated) {
    const token = getValidToken();
    authLog("info", token ? "hydrate success" : "hydrate empty", {
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
          authLog("info", "hydrate success", {
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
          const persisted = await secureSetToken(legacy);
          if (persisted) {
            authLog("info", "hydrate success", {
              source: "legacy_migration",
              tokenExpiresInMs: tokenExpiresInMs(legacy),
            });
            return rememberToken(legacy);
          }
        }

        authLog("info", "hydrate empty", { source: "native" });
        return null;
      }

      const legacy = readLegacyToken();
      clearLegacyToken();
      if (legacy && isTokenValid(legacy)) {
        authLog("info", "hydrate success", {
          source: "legacy_web",
          tokenExpiresInMs: tokenExpiresInMs(legacy),
        });
        return rememberToken(legacy);
      }
      authLog("info", "hydrate empty", { source: "web" });
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

export function clearAuthToken() {
  authLog("error", "logout triggered", {
    reason: "clearAuthToken",
    hadMemoryToken: Boolean(_memoryToken),
    hydrated: _hydrated,
  });
  __authLog("clearAuthToken: called — wiping memory + Keystore");
  rememberToken(null);
  _hydrated = true;
  clearLegacyToken();
  if (isNativeCapacitor()) {
    _persistPromise = secureRemoveToken().catch(() => {});
  }
  return _persistPromise;
}

export function setAuthToken(token) {
  authLog("info", "setAuthToken", {
    hasToken: Boolean(token),
    tokenExpiresInMs: token ? tokenExpiresInMs(token) : 0,
  });
  __authLog("setAuthToken: storing new token, expires in", token ? tokenExpiresInMs(token) : "N/A", "ms");
  rememberToken(token);
  _hydrated = true;
  clearLegacyToken();

  if (isNativeCapacitor()) {
    // secureSetToken / secureRemoveToken handle their own retry + Sentry
    // reporting. They resolve `false` (not throw) on terminal failure so the
    // returned promise never rejects — preserving setAuthToken's contract.
    _persistPromise = token ? secureSetToken(token) : secureRemoveToken();
    return _persistPromise;
  }

  _persistPromise = Promise.resolve();
  return _persistPromise;
}

export async function flushAuthTokenStorage() {
  await _persistPromise;
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
