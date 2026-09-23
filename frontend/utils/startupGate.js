// Startup gate: keeps the brand opener up until the first screen has real
// content, so a cold start is one continuous visual instead of a chain of
// splash → opener → redirect logo → skeleton → dashboard.
//
// Only the routes in STARTUP_GATED_ROUTES wait for a content signal; every
// other route reveals as soon as the session is restored, exactly as before.
// A gated route calls markStartupContentReady() once its primary query has
// settled (success or error — an error state is still content). The gate is
// one-shot per page load: later client-side navigations never re-arm it.

// /onboarding is gated too: it is the FIRST screen a new user ever sees, and
// its content depends on a request. Without the gate the opener handed over to
// a full-screen "Loading your onboarding…" — a second loading screen in a row,
// which reads as the app being stuck.
const STARTUP_GATED_ROUTES = new Set(["/", "/dashboard", "/indian-market", "/onboarding"]);

let ready = false;
const listeners = new Set();

export function isStartupGatedRoute(pathname) {
  return STARTUP_GATED_ROUTES.has(String(pathname || "").replace(/\/+$/, "") || "/");
}

export function isStartupContentReady() {
  return ready;
}

export function markStartupContentReady() {
  if (ready) return;
  ready = true;
  for (const listener of listeners) listener();
  listeners.clear();
}

export function subscribeStartupGate(listener) {
  if (ready) {
    listener();
    return () => {};
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}
