"use client";

import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";


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

function detectNativeAndroid() {
  const capacitor = typeof window === "undefined" ? null : window.Capacitor;
  if (!capacitor) return false;
  const native =
    typeof capacitor.isNativePlatform === "function"
      ? Boolean(capacitor.isNativePlatform())
      : capacitor.getPlatform?.() !== "web";
  if (!native) return false;
  return typeof capacitor.getPlatform === "function"
    ? capacitor.getPlatform() === "android"
    : /Android/i.test(window.navigator?.userAgent || "");
}

export default function PaywallGate(props) {
  // Server snapshot is `false` (web). That is safe in both builds: the Android
  // bundle has RazorpayPaywall compiled out to null, so the pre-swap render
  // shows nothing rather than the wrong processor.
  const isNativeAndroid = useSyncExternalStore(
    NEVER_CHANGES,
    detectNativeAndroid,
    () => false
  );

  if (isNativeAndroid) {
    // Native Android NEVER gets the Razorpay paywall, whatever the flags say.
    // This is the belt-and-braces half of the guard: the build flags are what
    // keep the code out of the bundle, and this is what keeps it off screen if
    // someone ships a mobile bundle with the web flags left on.
    return PlayPaywall ? <PlayPaywall {...props} /> : null;
  }

  return RazorpayPaywall ? <RazorpayPaywall {...props} /> : null;
}
