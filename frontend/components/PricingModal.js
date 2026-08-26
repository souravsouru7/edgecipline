"use client";

// Backwards-compatible shim. The old generic PricingModal has been replaced
// by SmartPaywall, which personalizes the offer with the user's own metrics.
// Kept as a separate import path so existing call-sites (PageHeader,
// upload-quota gates, coach-quota gates) keep working unchanged.
// Routes through PaywallGate so that when payments are disabled the whole
// SmartPaywall chunk is dropped at build time rather than merely hidden.
import PaywallGate from "./PaywallGate";

export default function PricingModal(props) {
  return <PaywallGate {...props} />;
}
