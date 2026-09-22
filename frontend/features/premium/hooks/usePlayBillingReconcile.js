"use client";

import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isAndroidApp, getDevicePurchases } from "@/plugins/EdgeBillingPlugin";
import { restoreGooglePlayPurchases } from "@/services/api";
import { subscribeAuthToken } from "@/utils/auth";
import { isAuthFailure, canReconcile, isSignIn } from "@/features/premium/utils/playReconcilePolicy.mjs";

// ─── Silent purchase reconciliation ────────────────────────────────────────
//
// The gap this closes: Google takes the money the moment the user confirms in
// Play's sheet, but our entitlement only exists once the backend has verified
// the token. Everything between those two points can fail —
//
//   * the network drops before the verify call goes out
//   * the app is killed mid-purchase
//   * the backend is briefly down
//   * the user reinstalls, wipes app data, or moves to a new phone
//   * the user signs back in on a device that already holds the purchase
//   * the purchase completes while nobody is signed in
//
// — and in every one of those cases Play still reports the purchase, forever,
// via queryPurchases. So on launch, on every resume and on every sign-in we
// ask Play what it has and hand the tokens to the backend, which re-verifies
// each from scratch.
//
// This is the client half of Phase 10 and the recovery path for edge cases
// 10-12 and 21-25. It never grants anything on its own: the local purchase is
// only a hint that a server-side check is worth making.

export function usePlayBillingReconcile({ enabled = true } = {}) {
  const queryClient = useQueryClient();
  // Resume fires liberally on Android (notification shade, permission dialogs,
  // the Play sheet itself closing). Without a floor this would re-verify on
  // every one of them, spending a Play Developer API call each time.
  const lastRunRef = useRef(0);
  const inFlightRef = useRef(false);

  const reconcile = useCallback(
    async ({ force = false } = {}) => {
      if (!enabled || !isAndroidApp()) return null;
      if (!canReconcile({ now: Date.now(), lastRun: lastRunRef.current, inFlight: inFlightRef.current, force })) {
        return null;
      }

      inFlightRef.current = true;
      try {
        const { purchases } = await getDevicePurchases();
        const tokens = (purchases || [])
          .map((purchase) => purchase?.purchaseToken)
          .filter(Boolean);

        if (!tokens.length) {
          lastRunRef.current = Date.now();
          return { restored: 0, entitled: false };
        }

        const result = await restoreGooglePlayPurchases(tokens);
        // Only a run that actually reached the backend as a signed-in user
        // counts against the cooldown. A 401 (launched signed out) must not
        // block the reconcile that fires the moment they sign in.
        lastRunRef.current = Date.now();

        // The whole point of reconciling is that entitlement may have just
        // changed. useTrialStatus caches for five minutes and polls once a
        // minute, so without this the user can sit on a stale paywall having
        // already paid.
        queryClient.invalidateQueries({ queryKey: ["trial", "status"] });
        queryClient.invalidateQueries({ queryKey: ["userProfile"] });

        return result;
      } catch (error) {
        // Silent by design. This runs unprompted in the background; a failure
        // means we try again on the next resume, and surfacing a toast for it
        // would alarm users who have no purchase to restore in the first place.
        if (!isAuthFailure(error)) lastRunRef.current = Date.now();
        return null;
      } finally {
        inFlightRef.current = false;
      }
    },
    [enabled, queryClient]
  );

  useEffect(() => {
    if (!enabled || !isAndroidApp()) return undefined;

    // Cold start — covers reinstall, new device, and re-login.
    reconcile({ force: true });

    // Resume. The WebView's own visibilitychange fires when the Android
    // activity comes back to the foreground, so this needs no extra native
    // plugin: @capacitor/app would give the same signal at the cost of a new
    // dependency and a cap sync.
    const onVisibility = () => {
      if (document.visibilityState === "visible") reconcile();
    };
    document.addEventListener("visibilitychange", onVisibility);

    // Sign-in. The providers tree (and this hook) stay mounted across the
    // login screen, so a cold start while signed out ran the reconcile
    // against a 401. Re-run the moment a token appears — that is what picks
    // up a purchase completed while nobody was signed in, or a purchase made
    // by an account that signs in later on this device. Token ROTATION
    // (previous token → new token) is not a sign-in and is ignored.
    const unsubscribe = subscribeAuthToken((change) => {
      if (isSignIn(change)) reconcile({ force: true });
    });

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      unsubscribe();
    };
  }, [enabled, reconcile]);

  return { reconcile };
}
