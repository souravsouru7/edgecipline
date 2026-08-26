/**
 * Realistic user journeys, modelled on what the StratEdge frontend actually
 * calls (see frontend/services/*.js and the app/ route tree).
 *
 * Each journey is a sequence with think time between steps — not a hot loop
 * against one endpoint. Journeys are weighted to approximate real usage:
 *
 *   50%  Morning check-in   — the dominant session: open app, read dashboard.
 *   25%  Analytics review   — heaviest read path.
 *   15%  Journal a trade    — the main write path.
 *   10%  Trade history      — paginated browsing.
 *
 * CACHE REALISM
 * Dashboard and analytics responses are Redis-cached per user for 45–120 s and
 * keyed on a trade-version token. The journal journey writes a trade, which
 * bumps that token and invalidates the user's cached analytics — so the mix
 * naturally produces both cache hits and cold rebuilds instead of measuring
 * only the cache. Randomised query parameters on some analytics calls widen
 * the key space further.
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { BASE_URL, authHeaders, ENDPOINT_CLASS, THINK_MIN, THINK_MAX } from "./config.js";
import { record, journeyDuration, journeysCompleted, journeysFailed } from "./metrics.js";

// Manual Forex trades have their P&L derived server-side by
// utils/tradeProfit.js. It refuses crypto (BTCUSD…) and symbols containing
// digits (NAS100), and only handles pairs where one side is USD — anything else
// is a 400, which would show up as a fake write-error rate. Restrict the write
// path to instruments the app can actually price.
const PAIRS = ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD", "AUDUSD", "USDCAD"];
const PERIODS = ["all", "1w", "1m", "3m", "1y"];
const DAYS_WINDOWS = [7, 14, 30, 60, 90];

// Set DEBUG_ERRORS=true to print the body of any unexpected non-2xx response.
// Without this a malformed test payload looks identical to an application
// failure in the summary, which is the classic way to misread a load test.
const DEBUG_ERRORS = String(__ENV.DEBUG_ERRORS || "").toLowerCase() === "true";

function rnd(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function debugFailure(name, res) {
  if (!DEBUG_ERRORS) return;
  if (res.status >= 200 && res.status < 400) return;
  if (res.status === 429) return; // expected under production rate limits
  console.error(`${name} -> ${res.status}: ${String(res.body).slice(0, 300)}`);
}

export function think() {
  sleep(THINK_MIN + Math.random() * (THINK_MAX - THINK_MIN));
}

/** GET with per-class metric recording and a status check. */
function get(path, token, cls, name) {
  const res = http.get(`${BASE_URL}${path}`, {
    ...authHeaders(token),
    tags: { name: name || path, endpoint_class: cls },
    timeout: "30s",
  });
  const ok = record(res, cls);
  debugFailure(name || path, res);
  check(res, {
    [`${name || path} not 5xx`]: (r) => r.status < 500,
    [`${name || path} authorised`]: (r) => r.status !== 401 && r.status !== 403,
  });
  return { res, ok };
}

function post(path, token, body, cls, name) {
  const res = http.post(`${BASE_URL}${path}`, JSON.stringify(body), {
    ...authHeaders(token),
    tags: { name: name || path, endpoint_class: cls },
    timeout: "30s",
  });
  const ok = record(res, cls);
  debugFailure(name || path, res);
  check(res, {
    [`${name || path} not 5xx`]: (r) => r.status < 500,
  });
  return { res, ok };
}

// ---------------------------------------------------------------------------
// Journey 1 — Morning check-in (weight 50)
// Open app → session check → dashboard → streaks → notifications
// ---------------------------------------------------------------------------
export function journeyMorningCheckIn(token) {
  const start = Date.now();
  let ok = true;

  ok = get("/api/auth/me", token, ENDPOINT_CLASS.AUTH_LIGHT, "GET /auth/me").ok && ok;
  ok = get(
    "/api/dashboard/snapshot?market=Forex",
    token,
    ENDPOINT_CLASS.DASHBOARD,
    "GET /dashboard/snapshot"
  ).ok && ok;

  think();

  ok = get("/api/streaks", token, ENDPOINT_CLASS.SIMPLE_READ, "GET /streaks").ok && ok;
  ok = get(
    "/api/notifications?page=1&limit=20",
    token,
    ENDPOINT_CLASS.SIMPLE_READ,
    "GET /notifications"
  ).ok && ok;

  finish(start, ok);
  return ok;
}

// ---------------------------------------------------------------------------
// Journey 2 — Analytics review (weight 25)
// The heaviest read path in the product.
// ---------------------------------------------------------------------------
export function journeyAnalyticsReview(token) {
  const start = Date.now();
  let ok = true;

  ok = get("/api/auth/me", token, ENDPOINT_CLASS.AUTH_LIGHT, "GET /auth/me").ok && ok;
  ok = get("/api/analytics/snapshot", token, ENDPOINT_CLASS.ANALYTICS, "GET /analytics/snapshot").ok && ok;

  think();

  ok = get("/api/analytics/advanced", token, ENDPOINT_CLASS.ANALYTICS, "GET /analytics/advanced").ok && ok;
  ok = get("/api/analytics/psychology", token, ENDPOINT_CLASS.ANALYTICS, "GET /analytics/psychology").ok && ok;

  think();

  // Deliberately uncached in the app (real-time drawdown) — this is the purest
  // measure of raw aggregation cost under load.
  ok = get("/api/analytics/drawdown", token, ENDPOINT_CLASS.ANALYTICS, "GET /analytics/drawdown").ok && ok;

  // Randomised window widens the cache key space so we are not only measuring hits.
  ok = get(
    `/api/analytics/psychology-cost?days=${rnd(DAYS_WINDOWS)}`,
    token,
    ENDPOINT_CLASS.ANALYTICS,
    "GET /analytics/psychology-cost"
  ).ok && ok;

  finish(start, ok);
  return ok;
}

// ---------------------------------------------------------------------------
// Journey 3 — Journal a trade (weight 15) — the write path
// ---------------------------------------------------------------------------
export function journeyJournalTrade(token) {
  const start = Date.now();
  let ok = true;

  ok = get("/api/auth/me", token, ENDPOINT_CLASS.AUTH_LIGHT, "GET /auth/me").ok && ok;
  ok = get("/api/setups", token, ENDPOINT_CLASS.SIMPLE_READ, "GET /setups").ok && ok;

  think();

  const entry = Math.round((1 + Math.random() * 200) * 10000) / 10000;
  const isWin = Math.random() > 0.45;
  const trade = {
    pair: rnd(PAIRS),
    type: Math.random() > 0.5 ? "BUY" : "SELL",
    tradeDate: new Date().toISOString(),
    entryPrice: entry,
    exitPrice: Math.round((entry + (isWin ? 1 : -1) * Math.random() * 4) * 10000) / 10000,
    // Must be strictly positive — deriveForexProfit rejects lotSize <= 0.
    lotSize: Math.round((0.01 + Math.random() * 3) * 100) / 100,
    // profit is deliberately omitted: for manual Forex entries the server
    // derives it from entry/exit/lot size, so sending one is not realistic.
    marketType: "Forex",
    session: "London",
    notes: `k6 journey trade vu=${__VU} iter=${__ITER}`,
    riskRewardRatio: "1:2",
    entryBasis: "Plan",
    confidence: "Medium",
  };

  const created = post("/api/trades", token, trade, ENDPOINT_CLASS.WRITE, "POST /trades");
  ok = created.ok && ok;

  think();

  // Read back the list — this is now a cold read, because the write above
  // bumped the user's trade cache version.
  ok = get(
    "/api/trades?page=1&limit=20&period=all",
    token,
    ENDPOINT_CLASS.LIST_READ,
    "GET /trades"
  ).ok && ok;

  finish(start, ok);
  return ok;
}

// ---------------------------------------------------------------------------
// Journey 4 — Browse trade history (weight 10)
// ---------------------------------------------------------------------------
export function journeyTradeHistory(token) {
  const start = Date.now();
  let ok = true;

  const page = 1 + Math.floor(Math.random() * 4);
  const listed = get(
    `/api/trades?page=${page}&limit=20&period=${rnd(PERIODS)}`,
    token,
    ENDPOINT_CLASS.LIST_READ,
    "GET /trades"
  );
  ok = listed.ok && ok;

  think();

  // Drill into one trade from the page we just read.
  let tradeId = null;
  try {
    const body = listed.res.json();
    const items = body?.data?.trades || body?.data?.items || body?.data || [];
    if (Array.isArray(items) && items.length > 0) {
      tradeId = items[Math.floor(Math.random() * items.length)]?._id || null;
    }
  } catch (_) {
    /* non-JSON (e.g. 429 body) — nothing to drill into */
  }

  if (tradeId) {
    ok = get(`/api/trades/${tradeId}`, token, ENDPOINT_CLASS.LIST_READ, "GET /trades/:id").ok && ok;
  }

  finish(start, ok);
  return ok;
}

function finish(start, ok) {
  journeyDuration.add(Date.now() - start);
  if (ok) journeysCompleted.add(1);
  else journeysFailed.add(1);
}

/**
 * Picks a journey using the production-like weighting described above.
 */
export function runWeightedJourney(token) {
  const r = Math.random() * 100;
  if (r < 50) return journeyMorningCheckIn(token);
  if (r < 75) return journeyAnalyticsReview(token);
  if (r < 90) return journeyJournalTrade(token);
  return journeyTradeHistory(token);
}
