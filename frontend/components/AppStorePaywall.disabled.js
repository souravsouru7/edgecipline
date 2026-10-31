"use client";

// Build-time stand-in for AppStorePaywall.
//
// next.config.ts aliases "@/components/AppStorePaywall" to this module whenever
// NEXT_PUBLIC_APP_STORE_BILLING_ENABLED is not "true" — the web and Android
// builds — so the StoreKit purchase sheet is absent from those bundles, not
// merely unreachable. Same pattern as PlayBillingPaywall.disabled.js.
export default function AppStorePaywallDisabled() {
  return null;
}
