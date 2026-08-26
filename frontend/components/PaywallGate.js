"use client";

import dynamic from "next/dynamic";

// The ONLY module the app should import when it wants to show a paywall.
//
// The env read is deliberately inline rather than imported from
// @/config/payments: Next replaces `process.env.NEXT_PUBLIC_*` with a string
// literal at build time, so with payments off this collapses to
//
//     const Paywall = ("false" === "true") ? dynamic(...) : null;   ->  null
//
// which puts the `import("./SmartPaywall")` in a dead branch. The minifier
// drops it and the bundler never emits the chunk — so no Razorpay checkout
// URL, no order-creation code and no payment strings exist anywhere in the
// shipped artifact. A runtime `if` cannot achieve that; the component body
// would still be bundled.
//
// That is the difference between "the user can't reach the paywall" and "the
// paywall is not in the app", and only the second one satisfies Apple 3.1.1
// and Google Play's payments policy while a third-party processor is wired up.
const PAYMENTS_ENABLED =
  String(process.env.NEXT_PUBLIC_PAYMENTS_ENABLED || "").trim() === "true";

const Paywall = PAYMENTS_ENABLED
  ? dynamic(() => import("@/components/SmartPaywall"), { ssr: false })
  : null;

export default function PaywallGate(props) {
  if (!Paywall) return null;
  return <Paywall {...props} />;
}
