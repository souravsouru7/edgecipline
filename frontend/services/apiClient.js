import axios from 'axios';
import { API_URL } from '@/config/api';
import {
  clearAuthToken,
  getAuthDiagnostics,
  getValidToken,
  hydrateAuthToken,
  isNativeCapacitor,
  setAuthToken,
} from '@/utils/auth';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// L14: Client-side sliding-window rate limiter
// Prevents the UI from hammering the server and triggering server-side 429s.
// ---------------------------------------------------------------------------
const CLIENT_RATE_LIMITS = [
  // Auth credential endpoints — tight limit matching backend authRateLimiter (5/60s → 10 client-side)
  { pattern: /\/(auth\/login|auth\/register|auth\/google|auth\/forgot-password|auth\/verify-otp|auth\/reset-password)/, max: 10, windowMs: 60_000 },
  // All other endpoints — generous ceiling; server's global limiter fires well below this
  { pattern: /.*/, max: 120, windowMs: 60_000 },
];

class SlidingWindowLimiter {
  constructor() {
    this._buckets = new Map(); // key → number[]  (timestamps)
  }

  check(url) {
    const rule = CLIENT_RATE_LIMITS.find((r) => r.pattern.test(url));
    if (!rule) return;

    const key   = `${rule.max}:${rule.windowMs}:${url.split('?')[0]}`;
    const now   = Date.now();
    const times = (this._buckets.get(key) || []).filter((t) => now - t < rule.windowMs);

    if (times.length >= rule.max) {
      const err   = new Error(`Too many requests — please slow down and try again shortly.`);
      err.status  = 429;
      err.isClientRateLimit = true;
      throw err;
    }

    times.push(now);
    this._buckets.set(key, times);
  }
}

const clientRateLimiter = new SlidingWindowLimiter();

// Credential-submitting routes that must NOT be silently retried on 401
// (they are the auth entry points — a 401 there means bad creds, not expired session).
const AUTH_ENTRY_PATHS = ['/auth/login', '/auth/register', '/auth/google', '/auth/refresh'];

const isAuthEntryPath = (url = '') =>
  AUTH_ENTRY_PATHS.some((p) => url.includes(p));

// ---------------------------------------------------------------------------
// Primary API client
// ---------------------------------------------------------------------------
const apiClient = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 10000,
  // Required so that the httpOnly refresh-token cookie is sent with /api/auth/* requests.
  // CORS credentials: true is already configured on the backend.
  withCredentials: true,
});

// ---------------------------------------------------------------------------
// Separate bare client used only for the silent-refresh call.
// Must NOT go through the main interceptors to prevent infinite retry loops:
// if /auth/refresh itself returns 401, we want a hard failure, not another refresh attempt.
// ---------------------------------------------------------------------------
const refreshClient = axios.create({
  baseURL: API_URL,
  timeout: 5000,
  withCredentials: true, // sends the refresh-token cookie
});

function applyNativeClientHeaders(config = {}) {
  if (isNativeCapacitor()) {
    config.headers = {
      ...(config.headers || {}),
      'X-Client-Platform': 'capacitor',
    };
  }
  return config;
}

apiClient.interceptors.request.use((config) => applyNativeClientHeaders(config));
refreshClient.interceptors.request.use((config) => applyNativeClientHeaders(config));

const REFRESH_LOCK_KEY = 'edgecipline:auth-refresh-lock';
const REFRESH_RESULT_KEY = 'edgecipline:auth-refresh-result';
const REFRESH_LOCK_TTL_MS = 10_000;
const REFRESH_WAIT_TIMEOUT_MS = 12_000;
const AUTH_CHANNEL_NAME = 'edgecipline-auth';
const AUTH_REFRESH_TRANSIENT = 'AUTH_REFRESH_TRANSIENT';

const getTabId = () => {
  if (typeof window === 'undefined') return 'server';
  if (!window.__EDGEDISCIPLINE_AUTH_TAB_ID__) {
    window.__EDGEDISCIPLINE_AUTH_TAB_ID__ =
      `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  }
  return window.__EDGEDISCIPLINE_AUTH_TAB_ID__;
};

let _authSyncReady = false;
let _authChannel = null;
let _peerRefreshWaiters = [];

function resolvePeerRefreshWaiters(token) {
  const waiters = _peerRefreshWaiters;
  _peerRefreshWaiters = [];
  waiters.forEach((resolve) => resolve(token || null));
}

function handleAuthSyncMessage(message) {
  if (!message || message.owner === getTabId()) return;
  if (message.type === 'refresh:success' && message.token) {
    void setAuthToken(message.token);
    resolvePeerRefreshWaiters(message.token);
  }
  if (message.type === 'auth:logout') {
    void clearAuthToken();
    resolvePeerRefreshWaiters(null);
  }
}

function ensureAuthSync() {
  if (_authSyncReady || typeof window === 'undefined') return;
  _authSyncReady = true;

  if ('BroadcastChannel' in window) {
    _authChannel = new BroadcastChannel(AUTH_CHANNEL_NAME);
    _authChannel.onmessage = (event) => handleAuthSyncMessage(event.data);
  }

  window.addEventListener('storage', (event) => {
    if (event.key !== REFRESH_RESULT_KEY || !event.newValue) return;
    try {
      handleAuthSyncMessage(JSON.parse(event.newValue));
    } catch {
      // Ignore malformed cross-tab messages.
    }
  });
}

function publishRefreshSuccess(token) {
  if (typeof window === 'undefined' || !token) return;
  ensureAuthSync();
  const message = {
    type: 'refresh:success',
    token,
    owner: getTabId(),
    createdAt: Date.now(),
  };

  _authChannel?.postMessage(message);

  if (isNativeCapacitor()) return;

  try {
    localStorage.setItem(REFRESH_RESULT_KEY, JSON.stringify(message));
    setTimeout(() => {
      if (localStorage.getItem(REFRESH_RESULT_KEY)?.includes(message.owner)) {
        localStorage.removeItem(REFRESH_RESULT_KEY);
      }
    }, 1000);
  } catch {
    // Storage can be unavailable in private mode; BroadcastChannel still covers modern browsers.
  }
}

async function waitForPeerRefresh(timeoutMs = REFRESH_WAIT_TIMEOUT_MS) {
  const existing = getValidToken() || await hydrateAuthToken();
  if (existing) return Promise.resolve(existing);

  ensureAuthSync();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      _peerRefreshWaiters = _peerRefreshWaiters.filter((waiter) => waiter !== done);
      resolve(null);
    }, timeoutMs);

    function done(token) {
      clearTimeout(timer);
      resolve(token || getValidToken() || null);
    }

    _peerRefreshWaiters.push(done);
  });
}

function tryAcquireRefreshLock() {
  if (typeof window === 'undefined') return true;
  ensureAuthSync();
  const owner = getTabId();
  const now = Date.now();

  try {
    const current = JSON.parse(localStorage.getItem(REFRESH_LOCK_KEY) || 'null');
    if (current?.expiresAt > now && current.owner !== owner) return false;

    localStorage.setItem(REFRESH_LOCK_KEY, JSON.stringify({
      owner,
      expiresAt: now + REFRESH_LOCK_TTL_MS,
    }));

    const confirmed = JSON.parse(localStorage.getItem(REFRESH_LOCK_KEY) || 'null');
    return confirmed?.owner === owner;
  } catch {
    return true;
  }
}

function releaseRefreshLock() {
  if (typeof window === 'undefined') return;
  try {
    const current = JSON.parse(localStorage.getItem(REFRESH_LOCK_KEY) || 'null');
    if (current?.owner === getTabId()) {
      localStorage.removeItem(REFRESH_LOCK_KEY);
    }
  } catch {
    // Ignore storage failures.
  }
}

function createTransientRefreshError(error, reason = 'Refresh temporarily unavailable') {
  const transient = new Error(reason);
  transient.code = AUTH_REFRESH_TRANSIENT;
  transient.isTransientAuthRefresh = true;
  transient.status = error?.response?.status || error?.status || 0;
  transient.cause = error;
  return transient;
}

export function isAuthRefreshTransientError(error) {
  return Boolean(error?.isTransientAuthRefresh || error?.code === AUTH_REFRESH_TRANSIENT);
}

function isTerminalRefreshFailure(error) {
  const status = error?.response?.status || error?.status;
  const errorCode = error?.response?.data?.errorCode || error?.data?.errorCode;
  return (
    status === 401 ||
    status === 403 ||
    errorCode === 'AUTH_REQUIRED' ||
    errorCode === 'REFRESH_TOKEN_EXPIRED' ||
    errorCode === 'TOKEN_REPLAY_DETECTED'
  );
}

function getRefreshFailureReason(error) {
  const status = error?.response?.status || error?.status;
  if (!error?.response) {
    const isTimeout = error?.code === 'ECONNABORTED' || error?.message?.includes('timeout');
    return isTimeout ? 'Refresh request timed out' : 'Refresh network unavailable';
  }
  if (status === 429) return 'Refresh rate limited';
  if (status >= 500) return 'Refresh service unavailable';
  return 'Refresh temporarily unavailable';
}

// ---------------------------------------------------------------------------
// Request interceptor — client-side rate limit check + attach access token
// ---------------------------------------------------------------------------
apiClient.interceptors.request.use(
  async (config) => {
    if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
      if (typeof config.headers?.delete === 'function') {
        config.headers.delete('Content-Type');
      } else if (config.headers) {
        delete config.headers['Content-Type'];
        delete config.headers['content-type'];
      }
    }

    // Skip rate-limit check for retried requests (already counted on first attempt)
    if (!config._retried && !config._retryCount && config.skipRateLimitRetry !== true) {
      clientRateLimiter.check(config.url || '');
    }

    if (typeof window !== 'undefined') {
      const token = getValidToken() || await hydrateAuthToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ---------------------------------------------------------------------------
// Response interceptor
// ---------------------------------------------------------------------------
apiClient.interceptors.response.use(
  // Unwrap response.data so callers receive the payload directly
  (response) => response.data,

  async (error) => {
    const config = error.config;

    if (!error.response) {
      const isTimeout = error.code === 'ECONNABORTED' || error.message?.includes('timeout');
      return Promise.reject(
        new Error(isTimeout ? 'Request timed out. Please try again.' : 'Network error. Please check your connection.')
      );
    }

    const { status } = error.response;

    if (status === 403 && error.response.data?.errorCode === 'TERMS_NOT_ACCEPTED') {
      handleTermsRequired();
      return Promise.reject(buildError(error));
    }

    // ------------------------------------------------------------------
    // 429 Too Many Requests — respect Retry-After, exponential backoff
    // ------------------------------------------------------------------
    if (status === 429) {
      // Never auto-retry credential endpoints — retrying burns more rate-limit budget
      // and provides no benefit (a 429 on login means the user is locked out, not that
      // the request should be transparently retried).
      if (isAuthEntryPath(config.url)) {
        return Promise.reject(buildError(error));
      }

      config._retryCount = (config._retryCount || 0) + 1;
      if (config._retryCount > 3) return Promise.reject(buildError(error));

      const retryAfterSec = parseRetryAfter(error.response.headers);
      if (retryAfterSec > 30) {
        // Server says wait more than 30s — skip auto-retry to avoid long blocking
        return Promise.reject(buildError(error));
      }

      const delayMs =
        retryAfterSec > 0
          ? retryAfterSec * 1000
          : 1000 * Math.pow(1.5, config._retryCount - 1) + Math.random() * 500;

      await sleep(delayMs);
      return apiClient(config);
    }

    // ------------------------------------------------------------------
    // 401 Unauthorized — attempt silent token refresh before giving up
    // ------------------------------------------------------------------
    if (status === 401) {
      // Auth entry paths getting a 401 means bad credentials / bad session — don't refresh.
      if (isAuthEntryPath(config.url)) {
        handleUnauthenticated('auth_entry_unauthorized');
        return Promise.reject(buildError(error));
      }

      // Only attempt one silent refresh per original request to prevent infinite loops.
      if (config._retried) {
        handleUnauthenticated('retried_request_unauthorized');
        return Promise.reject(buildError(error));
      }

      config._retried = true;

      try {
        // Use the singleton silentRefresh() so that multiple simultaneous 401s
        // (e.g. parallel page data fetches when the access token just expired)
        // all share one refresh request instead of each firing independently.
        // Without this, concurrent refreshes trigger replay-attack detection on
        // the backend and the entire token family gets revoked, logging the user out.
        const newToken = await silentRefresh();

        if (!newToken) throw new Error('No token in refresh response');

        config.headers.Authorization = `Bearer ${newToken}`;

        // Retry the original request with the new access token
        return apiClient(config);
      } catch (refreshError) {
        // Refresh failed. Only definitive auth failures should destroy the
        // session; network/timeouts/429/5xx must not auto-logout mobile users.
        if (!isAuthRefreshTransientError(refreshError)) {
          await clearAuthToken();
          handleUnauthenticated('refresh_terminal_failure');
        } else {
          console.warn('[Auth] preserving session after transient refresh failure', {
            at: new Date().toISOString(),
            status: refreshError.status || 0,
            reason: refreshError.message,
          });
        }
        return Promise.reject(buildError(error));
      }
    }

    return Promise.reject(buildError(error));
  }
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseRetryAfter(headers) {
  const val = headers?.['retry-after'] || headers?.['Retry-After'];
  return Number(val || 0);
}

function buildError(axiosError) {
  const res = axiosError.response;
  const msg = res?.data?.message || `Request failed with status ${res?.status ?? 'unknown'}`;
  const err = new Error(msg);
  err.status = res?.status;
  err.data = res?.data;
  err.retryAfterSeconds = parseRetryAfter(res?.headers);
  return err;
}

// Module-level flag prevents multiple concurrent 401s from each triggering
// their own redirect, which would cause a redirect loop in some browsers.
let _redirectingToLogin = false;

function handleUnauthenticated(reason = 'auth_required') {
  if (typeof window === 'undefined') return;
  if (_redirectingToLogin) return;
  const { pathname } = window.location;
  if (pathname === '/login' || pathname === '/register') return;
  console.warn('[Auth] logout:triggered', {
    at: new Date().toISOString(),
    reason,
    path: pathname,
    tokenState: getAuthDiagnostics(),
  });
  _redirectingToLogin = true;
  // Reset after 5s in case the framework router intercepts the navigation and
  // the module is not reloaded — prevents subsequent 401s being silently swallowed.
  setTimeout(() => { _redirectingToLogin = false; }, 5000);
  window.location.href = '/login';
}

function handleTermsRequired() {
  if (typeof window === 'undefined') return;
  const { pathname } = window.location;
  if (pathname === '/accept-terms' || pathname === '/login' || pathname === '/register') return;
  window.location.href = '/accept-terms';
}

// Singleton in-flight promise — prevents React StrictMode's double-mount from
// sending two concurrent /auth/refresh requests with the same cookie, which
// the backend correctly detects as a replay attack and revokes the token family.
let _refreshInFlight = null;

async function executeRefreshRequest() {
  console.info('[Auth] refresh:start', {
    at: new Date().toISOString(),
    tokenState: getAuthDiagnostics(),
  });
  const res = await refreshClient.post('/auth/refresh');
  const token = res.data?.token;
  if (token) {
    await setAuthToken(token);
    publishRefreshSuccess(token);
    console.info('[Auth] refresh:success', {
      at: new Date().toISOString(),
      tokenState: getAuthDiagnostics(),
    });
    return token;
  }
  console.warn('[Auth] refresh:missing-token', {
    at: new Date().toISOString(),
    tokenState: getAuthDiagnostics(),
  });
  return null;
}

function isRefreshRace(error) {
  return (
    error?.response?.status === 409 &&
    error?.response?.data?.errorCode === 'REFRESH_TOKEN_RACE'
  );
}

/**
 * Perform a silent refresh from outside the interceptor (e.g. on page load).
 * Returns the new access token string or null if no valid session exists.
 * Concurrent callers share the same in-flight request rather than racing.
 */
export function silentRefresh() {
  console.info('[Auth] silentRefresh:start', {
    at: new Date().toISOString(),
    tokenState: getAuthDiagnostics(),
  });
  const existing = getValidToken();
  if (existing) {
    console.info('[Auth] silentRefresh:existing-token', {
      at: new Date().toISOString(),
      tokenState: getAuthDiagnostics(),
    });
    return Promise.resolve(existing);
  }
  if (_refreshInFlight) return _refreshInFlight;

  _refreshInFlight = (async () => {
    let lockOwner = false;

    try {
      const hydrated = await hydrateAuthToken();
      if (hydrated) {
        console.info('[Auth] silentRefresh:hydrated-token', {
          at: new Date().toISOString(),
          tokenState: getAuthDiagnostics(),
        });
        return hydrated;
      }

      lockOwner = tryAcquireRefreshLock();

      if (!lockOwner) {
        const peerToken = await waitForPeerRefresh();
        if (peerToken) return peerToken;

        lockOwner = tryAcquireRefreshLock();
      }

      try {
        return await executeRefreshRequest();
      } catch (error) {
        if (isRefreshRace(error)) {
          console.warn('[Auth] refresh:race', { at: new Date().toISOString() });
          const peerToken = await waitForPeerRefresh();
          if (peerToken) return peerToken;

          await sleep(250);
          return await executeRefreshRequest();
        }
        if (!isTerminalRefreshFailure(error)) {
          const reason = getRefreshFailureReason(error);
          console.warn('[Auth] refresh:transient-failure', {
            at: new Date().toISOString(),
            status: error?.response?.status || error?.status || 0,
            reason,
            tokenState: getAuthDiagnostics(),
          });
          throw createTransientRefreshError(error, reason);
        }
        console.warn('[Auth] refresh:terminal-failure', {
          at: new Date().toISOString(),
          status: error?.response?.status || error?.status || 0,
          errorCode: error?.response?.data?.errorCode || error?.data?.errorCode,
          tokenState: getAuthDiagnostics(),
        });
        return null;
      }
    } finally {
      if (lockOwner) releaseRefreshLock();
      _refreshInFlight = null;
    }
  })();

  return _refreshInFlight;
}

export default apiClient;
