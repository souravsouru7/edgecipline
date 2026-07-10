import apiClient from "@/services/apiClient";

const BASE = "/trading-dna";

const ALLOWED_PERIODS = new Set(["30d", "90d", "365d"]);

function normalizePeriod(period) {
  return ALLOWED_PERIODS.has(period) ? period : "90d";
}

function normalizeMarket(marketType) {
  return marketType === "Indian_Market" ? "Indian_Market" : "Forex";
}

/**
 * Fetch the most recent Trading DNA report for this user / market / period.
 * Returns null when no report has been generated yet.
 */
export async function getLatestTradingDna({ marketType, period } = {}, signal) {
  const res = await apiClient.get(BASE, {
    params: {
      marketType: normalizeMarket(marketType),
      period: normalizePeriod(period),
    },
    signal,
  });
  return res.data;
}

/**
 * List recent Trading DNA reports across periods for this user / market.
 */
export async function listTradingDnaReports({ marketType, limit = 12 } = {}, signal) {
  const res = await apiClient.get(`${BASE}/list`, {
    params: { marketType: normalizeMarket(marketType), limit },
    signal,
  });
  return res.data;
}

/**
 * Mint a signed public share token for an existing report. The server
 * returns the token, a ready-to-share URL, and the expiry timestamp.
 */
export async function createTradingDnaShareToken({ reportId, ttlDays } = {}) {
  if (!reportId) throw new Error("reportId is required");
  const res = await apiClient.post(
    `${BASE}/${encodeURIComponent(reportId)}/share-token`,
    ttlDays ? { ttlDays } : {}
  );
  return res.data;
}

/**
 * Public — fetch a sanitized shared report by token. No auth required.
 * The backend strips raw P&L and the trade-level bundle before returning.
 */
export async function getSharedTradingDna(token, signal) {
  if (!token) throw new Error("token is required");
  const res = await apiClient.get(`${BASE}/share/${encodeURIComponent(token)}`, {
    signal,
    // Public endpoint — do not send the user's Bearer token. apiClient's
    // interceptor will attach one if present; clear it for this call.
    headers: { Authorization: "" },
  });
  return res.data;
}

/**
 * Trigger generation of a Trading DNA report. Server enforces a 24h lockout
 * unless force=true. Returns the generated report.
 */
export async function generateTradingDna({ marketType, period, force = false } = {}) {
  const res = await apiClient.post(
    `${BASE}/generate`,
    {},
    {
      params: {
        marketType: normalizeMarket(marketType),
        period: normalizePeriod(period),
        force: force ? "true" : undefined,
      },
      // Gemini can take 30–90s; bump the per-request timeout above the
      // default 10s in apiClient so axios doesn't abort mid-generation.
      timeout: 120000,
    }
  );
  return res.data;
}
