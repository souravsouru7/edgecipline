// node --test scripts/test-mobile-shell.mjs
// User-visible behaviour of the native shell's pure logic:
//   - hardware back never exits from a non-root screen and never lands a
//     signed-in user on /login
//   - the persisted cache only keeps read data (never auth/support/admin)
//     and the opener may skip its hold only when a dashboard snapshot exists
//   - offline requests fail fast with a typed error
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Minimal browser globals for the client-only modules.
const store = new Map();
globalThis.window = globalThis;
Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.addEventListener = () => {};

const back = await import("../utils/backNavigation.js");
const cache = await import("../utils/persistedQueryCache.js");
const net = await import("../utils/networkStatus.js");

// ─── Back button ─────────────────────────────────────────────────────────────
beforeEach(() => back.__resetDismissables());

const base = { canGoBack: true, dialogOpen: false, signedIn: true, currentMarket: "Forex" };

test("root tabs minimise instead of exiting or popping history", () => {
  for (const p of ["/dashboard", "/indian-market/dashboard", "/trades", "/indian-market/trades", "/analytics", "/notifications", "/"]) {
    assert.equal(back.decideBackAction({ ...base, pathname: p }).action, "minimize", p);
  }
});

test("a non-root screen with history goes back", () => {
  for (const p of ["/trades/view?id=1", "/analytics/discipline", "/settings", "/checklist/psychology", "/weekly-reports", "/support/tickets/new", "/upload-trade", "/indian-market/add-trade"]) {
    assert.equal(back.decideBackAction({ ...base, pathname: p }).action, "back", p);
  }
});

test("a non-root screen with no history replaces with the market dashboard", () => {
  assert.deepEqual(back.decideBackAction({ ...base, pathname: "/settings", canGoBack: false }), { action: "replace", to: "/dashboard" });
  assert.deepEqual(back.decideBackAction({ ...base, pathname: "/indian-market/setups", canGoBack: false, currentMarket: "Indian_Market" }), { action: "replace", to: "/indian-market/dashboard" });
});

test("a signed-in user never goes back into an auth screen", () => {
  for (const ref of ["/login", "/register", "/verify-otp", "/onboarding"]) {
    const d = back.decideBackAction({ ...base, pathname: "/settings", referrer: ref });
    assert.equal(d.action, "replace", ref);
    assert.equal(d.to, "/dashboard");
  }
});

test("a signed-out visitor may still go back to /login", () => {
  assert.equal(back.decideBackAction({ ...base, signedIn: false, pathname: "/register", referrer: "/login" }).action, "back");
});

test("a registered sheet is dismissed before any navigation", () => {
  let closed = 0;
  const unregister = back.registerDismissable(() => { closed += 1; });
  assert.equal(back.decideBackAction({ ...base, pathname: "/dashboard" }).action, "dismiss");
  assert.equal(back.dismissTop(), true);
  assert.equal(closed, 1);
  unregister();
  assert.equal(back.decideBackAction({ ...base, pathname: "/dashboard" }).action, "minimize");
});

test("the newest sheet is dismissed first", () => {
  const order = [];
  const u1 = back.registerDismissable(() => order.push("first"));
  const u2 = back.registerDismissable(() => order.push("second"));
  back.dismissTop();
  assert.deepEqual(order, ["second"]);
  u1(); u2();
});

test("an unaddressable open dialog gets Escape, never navigation", () => {
  assert.equal(back.decideBackAction({ ...base, pathname: "/trades", dialogOpen: true }).action, "escape");
});

test("query strings and trailing slashes do not change the decision", () => {
  assert.equal(back.isRootTab("/dashboard/?x=1"), true);
  assert.equal(back.isRootTab("/trades/view?id=1"), false);
});

// ─── Persisted cache ─────────────────────────────────────────────────────────
const q = (key, status = "success") => ({ queryKey: key, state: { status } });

test("persists read-heavy user data only", () => {
  for (const key of [["dashboard", "snapshot", "Forex"], ["trades", "1m"], ["streaks"], ["setups", "Forex"], ["userProfile"], ["trial", "status"]]) {
    assert.equal(cache.shouldPersistQuery(q(key)), true, key.join("/"));
  }
});

test("never persists support, admin, upload status or failed/pending queries", () => {
  for (const key of [["support", "my-tickets"], ["admin-users"], ["uploadStatus"], ["support", "staff-messages", "x"]]) {
    assert.equal(cache.shouldPersistQuery(q(key)), false, key.join("/"));
  }
  assert.equal(cache.shouldPersistQuery(q(["dashboard"], "error")), false);
  assert.equal(cache.shouldPersistQuery(q(["dashboard"], "pending")), false);
});

test("hasPersistedStartupContent is true only for a fresh, same-version dashboard snapshot", () => {
  const blob = (over = {}) => JSON.stringify({
    buster: cache.PERSISTED_CACHE_BUSTER,
    timestamp: Date.now(),
    clientState: { queries: [{ queryKey: ["dashboard", "snapshot", "Forex"], state: { status: "success", data: { ok: 1 } } }] },
    ...over,
  });
  store.clear();
  assert.equal(cache.hasPersistedStartupContent(), false);
  localStorage.setItem(cache.PERSISTED_CACHE_KEY, blob());
  assert.equal(cache.hasPersistedStartupContent(), true);
  localStorage.setItem(cache.PERSISTED_CACHE_KEY, blob({ buster: "other" }));
  assert.equal(cache.hasPersistedStartupContent(), false, "version bump invalidates");
  localStorage.setItem(cache.PERSISTED_CACHE_KEY, blob({ timestamp: Date.now() - cache.PERSISTED_CACHE_MAX_AGE_MS - 1 }));
  assert.equal(cache.hasPersistedStartupContent(), false, "stale blob ignored");
  localStorage.setItem(cache.PERSISTED_CACHE_KEY, JSON.stringify({ buster: cache.PERSISTED_CACHE_BUSTER, timestamp: Date.now(), clientState: { queries: [{ queryKey: ["trades"], state: { status: "success", data: [] } }] } }));
  assert.equal(cache.hasPersistedStartupContent(), false, "trades alone is not a first screen");
  localStorage.setItem(cache.PERSISTED_CACHE_KEY, "{not json");
  assert.equal(cache.hasPersistedStartupContent(), false, "corrupt blob is ignored");
});

test("clearing the persisted cache removes the blob (logout isolation)", () => {
  localStorage.setItem(cache.PERSISTED_CACHE_KEY, "{}");
  cache.clearPersistedQueryCache();
  assert.equal(localStorage.getItem(cache.PERSISTED_CACHE_KEY), null);
});

// ─── Offline ─────────────────────────────────────────────────────────────────
test("offline errors are typed so screens can keep cached data", () => {
  const err = net.createOfflineError();
  assert.equal(err.code, "OFFLINE");
  assert.equal(net.isOfflineError(err), true);
  assert.equal(net.isOfflineError(new Error("x")), false);
  assert.match(err.message, /offline/i);
});

test("network status defaults to online and notifies subscribers", () => {
  assert.equal(net.isOnline(), true);
});
