"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getTrialStatus } from "@/services/api";

/**
 * useTrialStatus
 *
 * Single source of truth for the trial countdown banner + paywall decisions.
 *
 * Returns:
 *   { loading, isPremium, planSource, trial, subscription, config, refresh }
 *
 * - `trial` is `null` for legacy users who never had a trial (UI should hide
 *   the banner in that case).
 * - `planSource` is `"admin" | "subscription" | "trial" | "free"`.
 * - The hook polls every 60s while mounted so the countdown stays fresh
 *   without a manual refresh. Polling is paused when the tab is hidden.
 *
 * If `initial` is provided (e.g. from the dashboard response), the hook
 * skips the first network roundtrip and uses it as the seed.
 */
const POLL_MS = 60 * 1000;

export function useTrialStatus({ initial = null } = {}) {
  const query = useQuery({
    queryKey: ["trial", "status"],
    queryFn: getTrialStatus,
    initialData: initial || undefined,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: false,
    refetchOnReconnect: false,
    // A tab backgrounded at payment time otherwise wouldn't see the upgrade
    // until its next 60s poll tick after regaining focus -- refetch on focus
    // so returning to the tab is enough to pick up a state change made
    // elsewhere (another tab, or this tab's own paywall after checkout).
    refetchOnWindowFocus: true,
    refetchInterval: () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return false;
      }
      return POLL_MS;
    },
  });

  const state = useMemo(() => {
    const data = query.data || {};
    return {
      loading: query.isLoading,
      isPremium: Boolean(data?.isPremium),
      planSource: data?.planSource || "free",
      trial: data?.trial || null,
      subscription: data?.subscription || null,
      config: data?.config || null,
    };
  }, [query.data, query.isLoading]);

  return { ...state, refresh: query.refetch };
}
