/**
 * auth.js — client-side access-token management
 *
 * Storage model:
 *  - Web: access token lives in memory only. XSS cannot read module-level variables.
 *  - Android (Capacitor): access token is also written to localStorage so it survives
 *    app restarts (process kills clear JS memory). The risk is lower in a native WebView
 *    because there is no address bar and no way to navigate to attacker-controlled URLs.
 *  - Refresh token (30 day opaque) → httpOnly cookie set by the backend.
 *    This file has no knowledge of the refresh token; the backend owns it entirely.
 *
 * When the access token expires or is missing, apiClient.js silently calls POST /api/auth/refresh
 * (cookie is sent automatically) and replaces the access token here via setAuthToken().
 */

const TOKEN_KEY = 'token';

// Primary storage — lives only for the lifetime of this JS module (page session).
let _memoryToken = null;

function isNativeAndroid() {
  if (typeof window === 'undefined') return false;
  try {
    return Boolean(window.Capacitor?.isNativePlatform?.());
  } catch {
    return false;
  }
}

function decodeJwtPayload(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    return JSON.parse(window.atob(padded));
  } catch {
    return null;
  }
}

function isTokenValid(token) {
  const payload = decodeJwtPayload(token);
  return Boolean(payload?.exp && payload.exp * 1000 > Date.now());
}

export function clearAuthToken() {
  _memoryToken = null;
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * Store the access token in memory. On Android/Capacitor also persist to
 * localStorage so the token survives app restarts (JS module state is lost
 * when the OS kills the process, but localStorage persists on disk).
 */
export function setAuthToken(token) {
  _memoryToken = token || null;
  if (typeof window === 'undefined') return;
  if (token && isNativeAndroid()) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

/**
 * Returns the stored access token if present and not expired, otherwise null.
 *
 * On Android/Capacitor: localStorage is the intentional persistence layer across
 * app restarts, so a valid token found there is promoted to memory and kept in
 * localStorage (not evicted) so subsequent restarts also restore instantly.
 *
 * On Web: localStorage is only checked for the old migration path; a valid token
 * is promoted to memory and evicted so it never persists past this session.
 */
export function getValidToken() {
  // 1. Check in-memory token (primary)
  if (_memoryToken) {
    if (isTokenValid(_memoryToken)) return _memoryToken;
    _memoryToken = null; // Expired — discard
  }

  // 2. Check localStorage (Android persistence path / web migration fallback)
  if (typeof window === 'undefined') return null;
  const stored = localStorage.getItem(TOKEN_KEY);
  if (stored && isTokenValid(stored)) {
    _memoryToken = stored;
    if (!isNativeAndroid()) {
      // Web: evict immediately — localStorage is not meant for persistent storage here
      localStorage.removeItem(TOKEN_KEY);
    }
    return stored;
  }
  if (stored) localStorage.removeItem(TOKEN_KEY); // Clean up expired token
  return null;
}

export function hasValidAuthToken() {
  return Boolean(getValidToken());
}

/** Returns the decoded payload of the current access token, or null. */
export function getTokenPayload() {
  const token = getValidToken();
  if (!token) return null;
  return decodeJwtPayload(token);
}
