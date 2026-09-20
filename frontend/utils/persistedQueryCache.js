"use client";

// Persisted React Query cache.
//
// Why: a returning user used to stare at the brand opener until the network
// answered /dashboard/snapshot (and /trades, /streaks...). With the last good
// response persisted, those screens paint from disk in the first frame and
// refetch in the background — the same pattern Kite/Groww use.
//
// What is persisted: only the read-heavy, user-visible data listed in
// PERSISTED_KEY_PREFIXES. Auth tokens never live in React Query, and the
// support/admin trees are excluded because they carry other people's
// messages and are cheap to refetch.
//
// Where: localStorage. On Capacitor Android this is backed by the WebView's
// profile storage, which survives app kills and is cleared when the user
// clears app data — exactly the lifetime we want. (@capacitor/preferences is
// async, and the persister must restore synchronously before first paint so
// the opener can leave on cached content.)
//
// Isolation: the cache is wiped whenever the auth token is cleared (logout,
// hard 401, account deletion), so a second account on the same phone never
// sees the previous one's dashboard.

import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";

export const PERSISTED_CACHE_KEY = "edge-query-cache-v1";
export const PERSISTED_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Bumped by the build from package.json; a new app version invalidates the
// whole persisted cache so a changed response shape can never crash a screen.
export const PERSISTED_CACHE_BUSTER = process.env.NEXT_PUBLIC_APP_VERSION || "dev";

const PERSISTED_KEY_PREFIXES = new Set([
  "dashboard",
  "trades",
  "setups",
  "streaks",
  "streak",
  "reflection",
  "missions",
  "trial",
  "userProfile",
  "discipline",
  "analytics",
  "weeklyReports",
  "reports",
  "tradingDNA",
  "psychologyTimeline",
  "patterns",
  "coachFeed",
]);

function safeStorage() {
  try {
    if (typeof window === "undefined") return undefined;
    const probe = "__edge_cache_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function shouldPersistQuery(query) {
  if (query.state.status !== "success") return false;
  const head = query.queryKey?.[0];
  return typeof head === "string" && PERSISTED_KEY_PREFIXES.has(head);
}

let persister = null;
export function getQueryPersister() {
  if (persister) return persister;
  const storage = safeStorage();
  if (!storage) return null;
  persister = createSyncStoragePersister({
    storage,
    key: PERSISTED_CACHE_KEY,
    // Coalesce rapid cache updates (e.g. a burst of refetches after resume)
    // into one write so the main thread is not serialising JSON per keystroke.
    throttleTime: 1000,
  });
  return persister;
}

// Does the persisted blob contain a usable dashboard/trades snapshot? Used by
// the startup opener to decide whether to wait for the network at all.
export function hasPersistedStartupContent() {
  const storage = safeStorage();
  if (!storage) return false;
  try {
    const raw = storage.getItem(PERSISTED_CACHE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (parsed?.buster !== PERSISTED_CACHE_BUSTER) return false;
    if (Date.now() - Number(parsed?.timestamp || 0) > PERSISTED_CACHE_MAX_AGE_MS) return false;
    return (parsed?.clientState?.queries || []).some(
      (q) => q?.queryKey?.[0] === "dashboard" && q?.state?.status === "success" && q?.state?.data
    );
  } catch {
    return false;
  }
}

export function clearPersistedQueryCache() {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.removeItem(PERSISTED_CACHE_KEY);
  } catch {
    // Storage may be unavailable mid-teardown; the in-memory cache is cleared
    // by the caller regardless.
  }
}
