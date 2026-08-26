"use client";

// Build-time stand-in for SmartPaywall.
//
// next.config.ts aliases "@/components/SmartPaywall" to this module whenever
// NEXT_PUBLIC_PAYMENTS_ENABLED is not "true", so the real paywall — and with
// it the Razorpay checkout URL, the order-creation calls and every payment
// string — never enters the module graph and never reaches the shipped
// bundle. Dead-branch elimination alone was not enough: the bundler still
// emitted the dynamic chunk.
//
// Removing it outright is what Apple 3.1.1 and Google Play's payments policy
// require while a third-party processor is the only checkout available.
export default function SmartPaywallDisabled() {
  return null;
}
