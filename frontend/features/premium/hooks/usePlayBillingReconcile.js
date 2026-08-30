"use client";

import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isAndroidApp, getDevicePurchases } from "@/plugins/EdgeBillingPlugin";
import { restoreGooglePlayPurchases } from "@/services/api";

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
//
// — and in every one of those cases Play still reports the purchase, forever,
// via queryPurchases. So on launch and on every resume we ask Play what it has
// and hand the tokens to the backend, which re-verifies each from scratch.
//
// This is the client half of Phase 10 and the recovery path for edge cases
// 10-12 and 21-25. It never grants anything on its own: the local purchase is
// only a hint that a server-side check is worth making.

const RECONCILE_COOLDOWN_MS = 60 * 1000;

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
      if (inFlightRef.current) return null;
      if (!force && Date.now() - lastRunRef.current < RECONCILE_COOLDOWN_MS) return null;

      inFlightRef.current = true;
      try {
        const { purchases } = await getDevicePurchases();
        const tokens = (purchases || [])
          .map((purchase) => purchase?.purchaseToken)
          .filter(Boolean);

        lastRunRef.current = Date.now();
        if (!tokens.length) return { restored: 0, entitled: false };

        const result = await restoreGooglePlayPurchases(tokens);

        // The whole point of reconciling is that entitlement may have just
        // changed. useTrialStatus caches for five minutes and polls once a
        // minute, so without this the user can sit on a stale paywall having
        // already paid.
        queryClient.invalidateQueries({ queryKey: ["trial", "status"] });
        queryClient.invalidateQueries({ queryKey: ["userProfile"] });

        return result;
      } catch {
        // Silent by design. This runs unprompted in the background; a failure
        // means we try again on the next resume, and surfacing a toast for it
        // would alarm users who have no purchase to restore in the first place.
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

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, reconcile]);

  return { reconcile };
}
