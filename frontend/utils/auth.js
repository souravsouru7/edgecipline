/**
 * auth.js — client-side access-token management
 *
 * Storage model:
 *  - Access token (15 min JWT)  → localStorage.
 *  - Refresh token (30 day opaque) → httpOnly cookie set by the backend.
 *    This file has no knowledge of the refresh token; the backend owns it entirely.
 *
 * When the access token expires, apiClient.js silently calls POST /api/auth/refresh
 * (cookie is sent automatically) and replaces the access token here.
 */

const TOKEN_KEY = 'token';

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

export function clearAuthToken() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TOKEN_KEY);
}

export function setAuthToken(token) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TOKEN_KEY, token);
}

/**
 * Returns the stored access token if it is present and not expired.
 * Clears localStorage if the token is expired so stale data doesn't accumulate.
 * Returns null when there is no valid token — the caller should attempt a
 * silent refresh via POST /api/auth/refresh before showing the login page.
 */
export function getValidToken() {
  if (typeof window === 'undefined') return null;

  const token = localStorage.getItem(TOKEN_KEY);
  const payload = decodeJwtPayload(token);

  if (!payload?.exp || payload.exp * 1000 <= Date.now()) {
    if (token) clearAuthToken(); // evict expired token
    return null;
  }

  return token;
}

export function hasValidAuthToken() {
  return Boolean(getValidToken());
}

/** Returns the decoded payload of the current access token, or null. */
export function getTokenPayload() {
  if (typeof window === 'undefined') return null;
  return decodeJwtPayload(localStorage.getItem(TOKEN_KEY));
}
