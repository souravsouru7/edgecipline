// Android hardware-back policy. Pure so it can be unit-tested without the
// Capacitor runtime; components/NativeBackButton.jsx wires it to @capacitor/app.
//
// Order of precedence on a back press:
//   1. a registered dismissable (bottom sheet, modal) → close it
//   2. an open dialog we cannot address directly → hand it Escape, never navigate
//   3. a route with usable history → router.back()
//   4. a non-root route with no usable history → the market's dashboard
//   5. a root tab → minimise the app (never exit abruptly)
//
// Root tabs are the bottom-nav destinations; back from any of them should
// hand the user to the launcher, not pop into a stale login page.

const INDIAN_MARKET = "Indian_Market";

export const ROOT_TABS = new Set([
  "/",
  "/dashboard",
  "/indian-market",
  "/indian-market/dashboard",
  "/trades",
  "/indian-market/trades",
  "/analytics",
  "/indian-market/analytics",
  "/notifications",
  "/login",
]);

// Screens a signed-in user must never be sent "back" into.
const NEVER_BACK_INTO = ["/login", "/register", "/verify-otp", "/reset-password", "/forgot-password", "/onboarding"];

const dismissables = [];

// Modals/sheets call this while mounted; the newest registration wins.
export function registerDismissable(close) {
  const entry = { close };
  dismissables.push(entry);
  return () => {
    const i = dismissables.indexOf(entry);
    if (i >= 0) dismissables.splice(i, 1);
  };
}

export function hasDismissable() {
  return dismissables.length > 0;
}

export function normalizePath(pathname) {
  const p = String(pathname || "/").split("?")[0].replace(/\/+$/, "");
  return p || "/";
}

export function isRootTab(pathname) {
  return ROOT_TABS.has(normalizePath(pathname));
}

export function dashboardFor(market) {
  return market === INDIAN_MARKET ? "/indian-market/dashboard" : "/dashboard";
}

/**
 * Decide what a back press should do.
 *
 * @param {object}  ctx
 * @param {string}  ctx.pathname       current route
 * @param {boolean} ctx.canGoBack      Capacitor's view of WebView history
 * @param {boolean} ctx.dialogOpen     a [role=dialog] is in the DOM
 * @param {boolean} ctx.signedIn       a valid session exists
 * @param {string}  ctx.currentMarket  "Forex" | "Indian_Market" for the fallback
 * @param {string}  [ctx.referrer]     previous in-app path, if tracked
 * @returns {{ action: "dismiss"|"escape"|"back"|"replace"|"minimize", to?: string }}
 */
export function decideBackAction(ctx) {
  if (dismissables.length) return { action: "dismiss" };
  if (ctx.dialogOpen) return { action: "escape" };

  const path = normalizePath(ctx.pathname);
  if (isRootTab(path)) return { action: "minimize" };

  const referrer = ctx.referrer ? normalizePath(ctx.referrer) : "";
  const referrerIsAuthScreen = NEVER_BACK_INTO.some((p) => referrer === p || referrer.startsWith(`${p}/`));

  if (ctx.canGoBack && !(ctx.signedIn && referrerIsAuthScreen)) return { action: "back" };
  return { action: "replace", to: dashboardFor(ctx.currentMarket) };
}

export function dismissTop() {
  const top = dismissables[dismissables.length - 1];
  if (!top) return false;
  try { top.close(); } catch { /* the component unregisters on unmount */ }
  return true;
}

// Test hook: drop all registrations.
export function __resetDismissables() {
  dismissables.length = 0;
}
