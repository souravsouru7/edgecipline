"use client";

import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";
import { getNativePlatform } from "@/utils/platform";
import {
  choosePaywallProvider,
  PROVIDER_PLAY,
  PROVIDER_RAZORPAY,
} from "@/features/premium/utils/paywallRouting.mjs";

const PAYMENTS_ENABLED =
  String(process.env.NEXT_PUBLIC_PAYMENTS_ENABLED || "").trim() === "true";

const PLAY_BILLING_ENABLED =
  String(process.env.NEXT_PUBLIC_PLAY_BILLING_ENABLED || "").trim() === "true";

const RazorpayPaywall = PAYMENTS_ENABLED
  ? dynamic(() => import("@/components/SmartPaywall"), { ssr: false })
  : null;

const PlayPaywall = PLAY_BILLING_ENABLED
  ? dynamic(() => import("@/components/PlayBillingPaywall"), { ssr: false })
  : null;

// window.Capacitor does not exist during the static export, so the platform is
// an EXTERNAL value that differs between server and client render.
// useSyncExternalStore is the supported way to read one: it uses the server
// snapshot for hydration and swaps to the client snapshot immediately after,
// with no setState-in-effect and no hydration mismatch.
//
// The subscribe function is a no-op because the platform cannot change during
// a session — there is nothing to re-subscribe to.
const NEVER_CHANGES = () => () => {};

// `null` during server render: "not known yet", which routes to no provider.
// It used to be `false`-for-not-Android, which made "unknown" indistinguishable
// from "web" and therefore mean Razorpay. Both paywalls are ssr:false dynamic
// imports, so rendering nothing on the server costs web nothing.
const UNKNOWN_PLATFORM = () => null;

/**
 * Renders the purchase surface this platform is allowed to use — or nothing.
 *
 * The routing rule itself lives in features/premium/utils/paywallRouting.mjs,
 * where it is an allowlist and unit-tested. This component only maps its answer
 * onto a component, so there is no second place for a fallthrough to reappear:
 *
 *   web      → Razorpay, if the web payment flag compiled it in
 *   android  → Google Play Billing, if the Play flag compiled it in
 *   ios      → nothing. No StoreKit in this release, so there is no provider.
 *   unknown  → nothing. Never "whatever web uses".
 *
 * A null provider renders no modal at all rather than an empty one. Every
 * upgrade CTA is independently gated on canShowPurchaseUI() (config/payments),
 * so on iOS nothing should reach this component in the first place — this is the
 * second line of defence, for the case where a CTA is missed or a mobile bundle
 * ships with the web flags left on.
 */
export default function PaywallGate(props) {
  const platform = useSyncExternalStore(
    NEVER_CHANGES,
    getNativePlatform,
    UNKNOWN_PLATFORM
  );

  const provider = choosePaywallProvider(platform);

  if (provider === PROVIDER_PLAY) {
    return PlayPaywall ? <PlayPaywall {...props} /> : null;
  }

  if (provider === PROVIDER_RAZORPAY) {
    return RazorpayPaywall ? <RazorpayPaywall {...props} /> : null;
  }

  // iOS, and anything else we have not decided about, get no purchase surface.
  return null;
}
