/**
 * auth.js — client-side access-token management
 *
 * Storage model:
 *  - Access token (15 min JWT)  → module-level memory variable (never written to localStorage).
 *    XSS scripts cannot read memory variables — they can only access DOM-visible storage.
 *  - Refresh token (30 day opaque) → httpOnly cookie set by the backend.
 *    This file has no knowledge of the refresh token; the backend owns it entirely.
 *
 * Migration: on first access after deploy, existing tokens are migrated OUT of localStorage
 * into memory and localStorage is immediately cleared. After 15 minutes the old token expires
 * and all subsequent auth flows use memory + httpOnly cookie exclusively.
 *
 * When the access token expires or is missing, apiClient.js silently calls POST /api/auth/refresh
 * (cookie is sent automatically) and replaces the access token here via setAuthToken().
 */

const TOKEN_KEY = 'token';

// Primary storage — lives only for the lifetime of this JS module (page session).
let _memoryToken = null;

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
 * Store the access token in memory only — never in localStorage.
 * Also evicts any old token from localStorage so the migration is complete.
 */
export function setAuthToken(token) {
  _memoryToken = token || null;
  // Evict legacy localStorage token on every write
  if (typeof window !== 'undefined') {
    localStorage.removeItem(TOKEN_KEY);
  }
}

/**
 * Returns the stored access token if present and not expired, otherwise null.
 *
 * Migration path: if memory is empty, checks localStorage for a token left over
 * from a previous session (pre-deploy). If found and valid, it is moved into memory
 * and removed from localStorage immediately so it never persists there again.
 */
export function getValidToken() {
  // 1. Check in-memory token (primary)
  if (_memoryToken) {
    if (isTokenValid(_memoryToken)) return _memoryToken;
    _memoryToken = null; // Expired — discard
  }

  // 2. Migration fallback: check localStorage for legacy token
  if (typeof window === 'undefined') return null;
  const legacy = localStorage.getItem(TOKEN_KEY);
  if (legacy && isTokenValid(legacy)) {
    _memoryToken = legacy;            // Promote to memory
    localStorage.removeItem(TOKEN_KEY); // Evict from localStorage immediately
    return legacy;
  }
  if (legacy) localStorage.removeItem(TOKEN_KEY); // Clean up expired legacy token
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
