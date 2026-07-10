"use client";

// Backwards-compatible shim. The old generic PricingModal has been replaced
// by SmartPaywall, which personalizes the offer with the user's own metrics.
// Kept as a separate import path so existing call-sites (PageHeader,
// upload-quota gates, coach-quota gates) keep working unchanged.
import SmartPaywall from "./SmartPaywall";

export default function PricingModal(props) {
  return <SmartPaywall {...props} />;
}
