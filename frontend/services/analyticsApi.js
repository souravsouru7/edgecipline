import { API_URL as BASE_URL } from "@/config/api";
import { getValidToken } from "@/utils/auth";

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

const getAuthHeaders = (signal) => {
  const token = getValidToken();
  return {
    headers: { Authorization: token ? `Bearer ${token}` : "" },
    ...(signal ? { signal } : {}),
  };
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
      errorMessage = errorJson.message || errorMessage;
    } catch (e) {
      console.error("Non-JSON error response received:", errorText.substring(0, 100));
    }

    const err = new Error(errorMessage);
    err.status = res.status;
    throw err;
  }
  return res.json();
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
export const getSummary = async (marketType = 'Forex', instrumentType = '', signal) => {
  return fetchWithRateLimitRetry(buildAnalyticsUrl(marketType, "/analytics/summary", { instrumentType }), getAuthHeaders(signal));
};

export const getWeeklyStats = async (marketType = 'Forex', instrumentType = '', signal) => {
  return fetchWithRateLimitRetry(buildAnalyticsUrl(marketType, "/analytics/weekly", { instrumentType }), getAuthHeaders(signal));
};

// Advanced Analytics
export const getRiskRewardAnalysis = async (marketType = 'Forex', instrumentType = '', signal) => {
  return fetchWithRateLimitRetry(buildAnalyticsUrl(marketType, "/analytics/risk-reward", { instrumentType }), getAuthHeaders(signal));
};

export const getTradeDistribution = async (marketType = 'Forex', instrumentType = '', signal) => {
  return fetchWithRateLimitRetry(buildAnalyticsUrl(marketType, "/analytics/distribution", { instrumentType }), getAuthHeaders(signal));
};

export const getPerformanceMetrics = async (marketType = 'Forex', instrumentType = '', signal) => {
  return fetchWithRateLimitRetry(buildAnalyticsUrl(marketType, "/analytics/performance", { instrumentType }), getAuthHeaders(signal));
};

export const getTimeAnalysis = async (marketType = 'Forex', range = 'all', instrumentType = '', signal) => {
  return fetchWithRateLimitRetry(buildAnalyticsUrl(marketType, "/analytics/time-analysis", { range: normalizeTextParam(range, "all"), instrumentType }), getAuthHeaders(signal));
};

export const getTradeQuality = async (marketType = 'Forex', instrumentType = '', signal) => {
  return fetchWithRateLimitRetry(buildAnalyticsUrl(marketType, "/analytics/quality", { instrumentType }), getAuthHeaders(signal));
};

export const getDrawdownAnalysis = async (marketType = 'Forex', instrumentType = '', signal) => {
  return fetchWithRateLimitRetry(buildAnalyticsUrl(marketType, "/analytics/drawdown", { instrumentType }), getAuthHeaders(signal));
};

export const getAIInsights = async (marketType = 'Forex', instrumentType = '', signal) => {
  return fetchWithRateLimitRetry(buildAnalyticsUrl(marketType, "/analytics/ai-insights", { instrumentType }), getAuthHeaders(signal));
};

// All-in-one advanced analytics
export const getAdvancedAnalytics = async (marketType = 'Forex', signal) => {
  return fetchWithRateLimitRetry(buildAnalyticsUrl(marketType, "/analytics/advanced"), getAuthHeaders(signal));
};

export const getPnLBreakdown = async (marketType = 'Forex', instrumentType = '', signal) => {
  return fetchWithRateLimitRetry(buildAnalyticsUrl(marketType, "/analytics/pnl-breakdown", { instrumentType }), getAuthHeaders(signal));
};

export const getPsychologyAnalytics = async (marketType = 'Forex', instrumentType = '', signal) => {
  return fetchWithRateLimitRetry(buildAnalyticsUrl(marketType, "/analytics/psychology", { instrumentType }), getAuthHeaders(signal));
};
