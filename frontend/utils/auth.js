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

function isTokenValid(token) {
  const payload = decodeJwtPayload(token);
  return Boolean(payload?.exp && payload.exp * 1000 > Date.now());
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

async function secureGetToken() {
  const storage = getSecureStoragePlugin();
  if (!storage?.get) return null;
  const result = await storage.get({ key: SECURE_TOKEN_KEY });
  return typeof result?.value === "string" ? result.value : null;
}

async function secureSetToken(token) {
  const storage = getSecureStoragePlugin();
  if (!storage?.set) return false;
  await storage.set({ key: SECURE_TOKEN_KEY, value: token });
  return true;
}

async function secureRemoveToken() {
  const storage = getSecureStoragePlugin();
  if (!storage?.remove) return;
  await storage.remove({ key: SECURE_TOKEN_KEY });
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
  if (_hydrated) return getValidToken();
  if (_hydratePromise) return _hydratePromise;

  _hydratePromise = (async () => {
    try {
      if (_memoryToken && isTokenValid(_memoryToken)) return _memoryToken;
      if (_memoryToken) rememberToken(null);

      if (isNativeCapacitor()) {
        const stored = await secureGetToken();
        if (stored && isTokenValid(stored)) {
          clearLegacyToken();
          return rememberToken(stored);
        }
        if (stored) await secureRemoveToken();

        const legacy = readLegacyToken();
        clearLegacyToken();
        if (legacy && isTokenValid(legacy)) {
          const persisted = await secureSetToken(legacy);
          if (persisted) return rememberToken(legacy);
        }

        return null;
      }

      const legacy = readLegacyToken();
      clearLegacyToken();
      if (legacy && isTokenValid(legacy)) return rememberToken(legacy);
      return null;
    } catch {
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
  rememberToken(null);
  _hydrated = true;
  clearLegacyToken();
  if (isNativeCapacitor()) {
    _persistPromise = secureRemoveToken().catch(() => {});
  }
  return _persistPromise;
}

export function setAuthToken(token) {
  rememberToken(token);
  _hydrated = true;
  clearLegacyToken();

  if (isNativeCapacitor()) {
    _persistPromise = token
      ? secureSetToken(token).catch(() => {})
      : secureRemoveToken().catch(() => {});
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
    rememberToken(null);
    void clearAuthToken();
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

export const __authStorageInternals = {
  SECURE_TOKEN_KEY,
  LEGACY_TOKEN_KEY,
  decodeJwtPayload,
  isTokenValid,
};
