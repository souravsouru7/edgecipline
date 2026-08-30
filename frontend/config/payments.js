// Single source of truth for whether the app exposes any purchase surface, and
// if so, which processor.
//
// Both flags are deliberately build-time constants, not runtime lookups. Next
// inlines NEXT_PUBLIC_* at compile time, so each `PAYMENTS_ENABLED` /
// `PLAY_BILLING_ENABLED` collapses to a literal and every guard on it becomes
// statically dead code — the paywall, the Razorpay SDK loader and the sandbox
// mock are all DROPPED from the bundle rather than merely hidden. That
// distinction is what the store policies actually care about:
//
//   Apple 3.1.1  — a third-party payment processor inside the app is an
//                  automatic rejection. It must not be reachable at all.
//   Play Payments / Deceptive Behavior — an Android app selling digital goods
//                  must use Play Billing, and a simulated checkout that grants
//                  a paid plan without a transaction is a suspension risk.
//
// The build matrix (see docs/google-play-billing.md):
//
//   web      NEXT_PUBLIC_PAYMENTS_ENABLED=true   PLAY_BILLING_ENABLED=false
//   Android  NEXT_PUBLIC_PAYMENTS_ENABLED=false  PLAY_BILLING_ENABLED=true
//   iOS      both false, until StoreKit is implemented
export const PAYMENTS_ENABLED =
  String(process.env.NEXT_PUBLIC_PAYMENTS_ENABLED || "").trim() === "true";

export const PLAY_BILLING_ENABLED =
  String(process.env.NEXT_PUBLIC_PLAY_BILLING_ENABLED || "").trim() === "true";

// Capacitor sets window.Capacitor on native platforms, before the web layer
// boots.
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

export function isNativeAndroid() {
  if (!isNativePlatform()) return false;
  const capacitor = window.Capacitor;
  if (typeof capacitor.getPlatform === "function") {
    return capacitor.getPlatform() === "android";
  }
  return /Android/i.test(window.navigator?.userAgent || "");
}

// Razorpay, web only. The native check is unconditional and independent of the
// flag: even with payments enabled for web, a native build must never open a
// third-party checkout. This is the belt-and-braces guard for the case where
// someone ships a mobile bundle with the web flags left on.
export function canShowRazorpayCheckout() {
  return PAYMENTS_ENABLED && !isNativePlatform();
}

// Google Play Billing, native Android only. Never on web — there is no Play
// Billing library in a browser — and never on iOS.
export function canShowPlayBilling() {
  return PLAY_BILLING_ENABLED && isNativeAndroid();
}

// The check UI should call when it only wants to know "is there somewhere to
// pay". Provider-agnostic on purpose: the upgrade CTAs in PageHeader, the
// settings page, the trade-limit dialog and the rescue banners all care
// whether a purchase is possible at all, not which processor handles it —
// PaywallGate picks that. Keeping this one union means adding a provider never
// requires revisiting those call sites.
//
// Callers that specifically mean "Razorpay" must use canShowRazorpayCheckout().
export function canShowPurchaseUI() {
  return canShowRazorpayCheckout() || canShowPlayBilling();
}
