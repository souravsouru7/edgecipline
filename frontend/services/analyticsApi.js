import { API_URL as BASE_URL } from "@/config/api";
import { getValidToken, hydrateAuthToken } from "@/utils/auth";
import { isAuthRefreshTransientError, silentRefresh } from "@/services/apiClient";

const DEFAULT_MARKET = "Forex";
const VALID_MARKETS = new Set(["Forex", "Crypto", "Commodities", "Indices", "Stocks", "Indian_Market"]);

const normalizeMarketType = (marketType) => {
  if (typeof marketType !== "string") return DEFAULT_MARKET;
  const trimmed = marketType.trim();
  return VALID_MARKETS.has(trimmed) ? trimmed : DEFAULT_MARKET;
};

const normalizeTextParam = (value, fallback = "") => {
  if (typeof value !== "string") return fallback;
  return value.trim() || fallback;
};

// Helper to get base URL based on market
const getBaseUrl = (marketType) => {
  if (marketType === 'Indian_Market') {
    return `${BASE_URL}/indian`;
  }
  return BASE_URL;
};

const createAuthError = (message, status = 401, errorCode = "AUTH_REQUIRED") => {
  const err = new Error(message);
  err.status = status;
  err.data = { errorCode, message };
  return err;
};

const resolveAccessToken = async ({ forceRefresh = false } = {}) => {
  const token = forceRefresh
    ? await silentRefresh({ force: true })
    : (getValidToken() || await hydrateAuthToken() || await silentRefresh());

  if (token) return token;
  throw createAuthError("Authentication required. Please sign in again.");
};

const getAuthHeaders = async (signal, options = {}) => {
  const token = await resolveAccessToken(options);
  return {
    headers: { Authorization: `Bearer ${token}` },
    ...(signal ? { signal } : {}),
  };
};

const authFetchWithRateLimitRetry = async (url, signal) => {
  return fetchWithRateLimitRetry(url, await getAuthHeaders(signal));
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getRetryDelayMs = (res, attempt) => {
  const retryAfter = res.headers.get("Retry-After");
  if (retryAfter) {
    const asSeconds = Number(retryAfter);
    if (!Number.isNaN(asSeconds)) {
      return Math.max(0, asSeconds * 1000);
    }

    const asDate = Date.parse(retryAfter);
    if (!Number.isNaN(asDate)) {
      return Math.max(0, asDate - Date.now());
    }
  }

  // Fallback exponential backoff with a tiny jitter.
  const base = 700;
  const jitter = Math.floor(Math.random() * 250);
  return base * Math.pow(2, attempt) + jitter;
};

// Helper to handle fetch responses and prevent JSON syntax errors on 404/500
const handleResponse = async (res) => {
  if (!res.ok) {
    const errorText = await res.text();
    let errorMessage = `Request failed with status ${res.status}`;
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.error?.message || errorJson.message || errorMessage;
    } catch {
      console.error("Non-JSON error response received:", errorText.substring(0, 100));
    }

    const err = new Error(errorMessage);
    err.status = res.status;
    try {
      err.data = JSON.parse(errorText);
      err.data.message = errorMessage;
    } catch {
      err.data = { message: errorMessage };
    }
    throw err;
  }
  const payload = await res.json();
  return payload?.success === true && Object.prototype.hasOwnProperty.call(payload, "data")
    ? payload.data
    : payload;
};

const fetchWithRateLimitRetry = async (url, options, maxRetries = 4) => {
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    // Small random stagger so concurrent requests don't all retry in sync
    if (attempt > 0) {
      const delayMs = getRetryDelayMs({ headers: { get: () => null } }, attempt - 1);
      await sleep(delayMs);
    }

    let res;
    try {
      res = await fetch(url, options);
    } catch (networkErr) {
      if (attempt >= maxRetries) throw networkErr;
      continue;
    }

    if (res.status === 401 && !options._authRetried) {
      try {
        const token = await resolveAccessToken({ forceRefresh: true });
        options = {
          ...options,
          _authRetried: true,
          headers: {
            ...(options.headers || {}),
            Authorization: `Bearer ${token}`,
          },
        };
        continue;
      } catch (refreshError) {
        if (isAuthRefreshTransientError(refreshError)) {
          throw createAuthError("Authentication refresh is temporarily unavailable. Please try again.", 0, "AUTH_REFRESH_TRANSIENT");
        }
        throw refreshError;
      }
    }

    if (res.status !== 429) {
      return handleResponse(res);
    }

    if (attempt >= maxRetries) {
      // Return null instead of throwing so one failed endpoint doesn't crash the whole page
      console.warn(`Rate limit persisted after ${maxRetries} retries for: ${url}`);
      return null;
    }

    const delayMs = getRetryDelayMs(res, attempt);
    await sleep(delayMs);
  }

  return null;
};

const buildAnalyticsUrl = (marketType, path, params = {}) => {
  const safeMarketType = normalizeMarketType(marketType);
  const searchParams = new URLSearchParams({ marketType: safeMarketType });

  Object.entries(params).forEach(([key, value]) => {
    const safeValue = normalizeTextParam(value);
    if (safeValue) searchParams.set(key, safeValue);
  });

  return `${getBaseUrl(safeMarketType)}${path}?${searchParams.toString()}`;
};

// Basic Analytics
export const getAnalyticsSnapshot = async (marketType = 'Forex', instrumentType = '', options = {}, signal) => {
  const params = {
    instrumentType,
    ...(options?.days ? { days: String(options.days) } : {}),
    ...(options?.period ? { period: String(options.period) } : {}),
  };
  return authFetchWithRateLimitRetry(buildAnalyticsUrl(marketType, "/analytics/snapshot", params), signal);
};

export const getSummary = async (marketType = 'Forex', instrumentType = '', signal) => {
  return authFetchWithRateLimitRetry(buildAnalyticsUrl(marketType, "/analytics/summary", { instrumentType }), signal);
};

export const getWeeklyStats = async (marketType = 'Forex', instrumentType = '', signal) => {
  return authFetchWithRateLimitRetry(buildAnalyticsUrl(marketType, "/analytics/weekly", { instrumentType }), signal);
};

// Advanced Analytics
export const getRiskRewardAnalysis = async (marketType = 'Forex', instrumentType = '', signal) => {
  return authFetchWithRateLimitRetry(buildAnalyticsUrl(marketType, "/analytics/risk-reward", { instrumentType }), signal);
};

export const getTradeDistribution = async (marketType = 'Forex', instrumentType = '', signal) => {
  return authFetchWithRateLimitRetry(buildAnalyticsUrl(marketType, "/analytics/distribution", { instrumentType }), signal);
};

export const getPerformanceMetrics = async (marketType = 'Forex', instrumentType = '', signal) => {
  return authFetchWithRateLimitRetry(buildAnalyticsUrl(marketType, "/analytics/performance", { instrumentType }), signal);
};

export const getTimeAnalysis = async (marketType = 'Forex', range = 'all', instrumentType = '', signal) => {
  return authFetchWithRateLimitRetry(buildAnalyticsUrl(marketType, "/analytics/time-analysis", { range: normalizeTextParam(range, "all"), instrumentType }), signal);
};

export const getTradeQuality = async (marketType = 'Forex', instrumentType = '', signal) => {
  return authFetchWithRateLimitRetry(buildAnalyticsUrl(marketType, "/analytics/quality", { instrumentType }), signal);
};

export const getDrawdownAnalysis = async (marketType = 'Forex', instrumentType = '', signal) => {
  return authFetchWithRateLimitRetry(buildAnalyticsUrl(marketType, "/analytics/drawdown", { instrumentType }), signal);
};

export const getAIInsights = async (marketType = 'Forex', instrumentType = '', signal) => {
  return authFetchWithRateLimitRetry(buildAnalyticsUrl(marketType, "/analytics/ai-insights", { instrumentType }), signal);
};

// All-in-one advanced analytics
export const getAdvancedAnalytics = async (marketType = 'Forex', signal) => {
  return authFetchWithRateLimitRetry(buildAnalyticsUrl(marketType, "/analytics/advanced"), signal);
};

export const getPnLBreakdown = async (marketType = 'Forex', instrumentType = '', signal) => {
  return authFetchWithRateLimitRetry(buildAnalyticsUrl(marketType, "/analytics/pnl-breakdown", { instrumentType }), signal);
};

export const getPsychologyAnalytics = async (marketType = 'Forex', instrumentType = '', signal) => {
  return authFetchWithRateLimitRetry(buildAnalyticsUrl(marketType, "/analytics/psychology", { instrumentType }), signal);
};

export const getTradeQualityAnalysis = async (marketType = 'Forex', instrumentType = '', signal) => {
  return authFetchWithRateLimitRetry(buildAnalyticsUrl(marketType, "/analytics/trade-quality-analysis", { instrumentType }), signal);
};

export const getSelfAwarenessScore = async (marketType = 'Forex', instrumentType = '', signal) => {
  return authFetchWithRateLimitRetry(buildAnalyticsUrl(marketType, "/analytics/self-awareness", { instrumentType }), signal);
};

export const getPsychologyCost = async (marketType = 'Forex', instrumentType = '', days = '', signal) => {
  return authFetchWithRateLimitRetry(buildAnalyticsUrl(marketType, "/analytics/psychology-cost", { instrumentType, ...(days ? { days: String(days) } : {}) }), signal);
};

export const getTradingDNA = async (marketType = 'Forex', instrumentType = '', signal) => {
  return authFetchWithRateLimitRetry(buildAnalyticsUrl(marketType, "/analytics/trading-dna", { instrumentType }), signal);
};

export const getPatterns = async (marketType = 'Forex', days = '', signal) => {
  return authFetchWithRateLimitRetry(
    buildAnalyticsUrl(marketType, "/analytics/patterns", { ...(days ? { days: String(days) } : {}) }),
    signal
  );
};

export const getCoachFeed = async (marketType = 'Forex', days = '', signal) => {
  return authFetchWithRateLimitRetry(
    buildAnalyticsUrl(marketType, "/analytics/ai-coach-feed", { ...(days ? { days: String(days) } : {}) }),
    signal
  );
};

export const getPsychologyTimeline = async (marketType = 'Forex', period = 'weekly', days = '', signal) => {
  return authFetchWithRateLimitRetry(
    buildAnalyticsUrl(marketType, "/analytics/psychology-timeline", {
      period: normalizeTextParam(period, "weekly"),
      ...(days ? { days: String(days) } : {}),
    }),
    signal
  );
};

export const getDisciplineAnalytics = async (marketType = 'Forex', period = 'monthly', days = '', setup = '', signal) => {
  return authFetchWithRateLimitRetry(
    buildAnalyticsUrl(marketType, "/analytics/discipline", {
      period: normalizeTextParam(period, "monthly"),
      ...(days ? { days: String(days) } : {}),
      ...(setup ? { setup: normalizeTextParam(setup) } : {}),
    }),
    signal
  );
};
