// Single source of truth for whether the app exposes any purchase surface.
//
// This is deliberately a build-time constant, not a runtime lookup. Next.js
// inlines NEXT_PUBLIC_* at compile time, so `PAYMENTS_ENABLED` collapses to a
// literal `false` in the default build and every `if (!PAYMENTS_ENABLED)`
// guard becomes statically dead code — the paywall, the Razorpay SDK loader
// and the sandbox mock are all dropped from the bundle rather than merely
// hidden. That distinction is what the store policies actually care about:
//
//   Apple 3.1.1  — a third-party payment processor inside the app is an
//                  automatic rejection. It must not be reachable at all.
//   Play Payments / Deceptive Behavior — a simulated checkout that grants a
//                  paid plan without a transaction is a suspension risk.
//
// Mobile (Capacitor) builds must stay `false` until Play Billing / StoreKit
// are implemented. The web build can be flipped to `true` once a live
// Razorpay account exists.
export const PAYMENTS_ENABLED =
  String(process.env.NEXT_PUBLIC_PAYMENTS_ENABLED || "").trim() === "true";

// Capacitor sets window.Capacitor on native platforms. Even with payments
// enabled for web, a native build must never open a third-party checkout —
// this is the belt-and-braces check for the case where someone ships a mobile
// bundle with the flag left on.
export function isNativePlatform() {
  if (typeof window === "undefined") return false;
  const capacitor = window.Capacitor;
  if (!capacitor) return false;
  if (typeof capacitor.isNativePlatform === "function") {
    return Boolean(capacitor.isNativePlatform());
  }
  return typeof capacitor.getPlatform === "function"
    ? capacitor.getPlatform() !== "web"
    : false;
}

// The only check UI should call. False on every native build, and false
// everywhere unless the flag was explicitly set at build time.
export function canShowPurchaseUI() {
  return PAYMENTS_ENABLED && !isNativePlatform();
}
