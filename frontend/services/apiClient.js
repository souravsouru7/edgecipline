import axios from 'axios';
import { API_URL } from '@/config/api';
import { clearAuthToken, getValidToken, setAuthToken } from '@/utils/auth';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

// ---------------------------------------------------------------------------
// Request interceptor — attach access token from localStorage
// ---------------------------------------------------------------------------
apiClient.interceptors.request.use(
  (config) => {
    if (typeof window !== 'undefined') {
      const token = getValidToken();
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
      // Network error / timeout — no server response
      return Promise.reject(new Error('Network error. Please check your connection.'));
    }

    const { status } = error.response;

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
        handleUnauthenticated();
        return Promise.reject(buildError(error));
      }

      // Only attempt one silent refresh per original request to prevent infinite loops.
      if (config._retried) {
        handleUnauthenticated();
        return Promise.reject(buildError(error));
      }

      config._retried = true;

      try {
        const refreshRes = await refreshClient.post('/auth/refresh');
        const newToken = refreshRes.data?.token;

        if (!newToken) throw new Error('No token in refresh response');

        setAuthToken(newToken);
        config.headers.Authorization = `Bearer ${newToken}`;

        // Retry the original request with the new access token
        return apiClient(config);
      } catch {
        // Refresh failed — clear local state and redirect to login
        clearAuthToken();
        handleUnauthenticated();
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

function handleUnauthenticated() {
  if (typeof window === 'undefined') return;
  const { pathname } = window.location;
  if (pathname !== '/login' && pathname !== '/register') {
    window.location.href = '/login';
  }
}

/**
 * Perform a silent refresh from outside the interceptor (e.g. on page load).
 * Returns the new access token string or null if no valid session exists.
 */
export async function silentRefresh() {
  try {
    const res = await refreshClient.post('/auth/refresh');
    const token = res.data?.token;
    if (token) {
      setAuthToken(token);
      return token;
    }
    return null;
  } catch {
    return null;
  }
}

export default apiClient;
