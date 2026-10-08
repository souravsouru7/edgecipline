"use client";

// Build-time stand-in for PlayBillingPaywall.
//
// next.config.ts aliases "@/components/PlayBillingPaywall" to this module
// whenever NEXT_PUBLIC_PLAY_BILLING_ENABLED is not "true", mirroring what
// SmartPaywall.disabled.js does for Razorpay.
//
// Without this the Play paywall was emitted into every build, including iOS and
// web: `PLAY_BILLING_ENABLED ? dynamic(() => import(...)) : null` leaves the
// import in the module graph, so the chunk — the purchase sheet, the offer
// rendering, the purchase/restore calls — still shipped. Unreachable, because
// PaywallGate routes only Android to it and EdgeBillingPlugin is Android-gated,
// but present. Apple 3.1.1 is about a purchase mechanism not being there at
// all, so "present but unreachable" is a worse answer than "absent".
export default function PlayBillingPaywallDisabled() {
  return null;
}
