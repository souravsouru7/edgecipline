// Which purchase processor a platform may use. React-free so it runs under
// `node --test` — the rule matters more than the component that applies it.
//
// This is an ALLOWLIST, not a default-with-exceptions. The shape it replaces was
//
//   if (isAndroidNative()) return <PlayPaywall />;
//   return <RazorpayPaywall />;
//
// which reads as "Android gets Play, everyone else gets Razorpay" — and iOS is
// "everyone else". Combined with frontend/.env shipping
// NEXT_PUBLIC_PAYMENTS_ENABLED=true for the web deployment, an iOS build would
// have mounted a third-party checkout: an automatic rejection under App Store
// Guideline 3.1.1. Any platform we have not explicitly decided about — iOS
// today, a new Capacitor target tomorrow, or an unresolved platform during
// server render — must get nothing rather than inherit someone else's processor.

/** The Razorpay web checkout. Web only; never inside a native shell. */
export const PROVIDER_RAZORPAY = "razorpay";

/** Google Play Billing via the EdgeBilling plugin. Native Android only. */
export const PROVIDER_PLAY = "play";

/**
 * The purchase processor for `platform`, or null when there is none.
 *
 * @param {"android"|"ios"|"web"|null|undefined} platform - from
 *   utils/platform.js getNativePlatform(); null during server render.
 * @returns {"razorpay"|"play"|null} null means "render no purchase surface" —
 *   not "fall back to something", and not "render an empty modal".
 */
export function choosePaywallProvider(platform) {
  if (platform === "android") return PROVIDER_PLAY;
  if (platform === "web") return PROVIDER_RAZORPAY;

  // ios            — no provider until StoreKit is implemented
  // null           — server render; the platform is not knowable yet
  // anything else  — a target nobody has made a payments decision for
  return null;
}
