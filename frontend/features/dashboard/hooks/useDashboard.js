"use client";

import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMarket, MARKETS } from "@/context/MarketContext";
import { getDashboardSnapshot } from "@/features/dashboard/api/dashboardApi";
import { hasValidAuthToken, hydrateAuthToken, isNativeCapacitor } from "@/utils/auth";
import { isAuthRefreshTransientError, silentRefresh } from "@/services/apiClient";
import { TRADE_QUERY_FRESHNESS_OPTIONS } from "@/utils/queryInvalidation";
import { markStartupContentReady } from "@/utils/startupGate";
import { getOnboardingSetupsUrl } from "@/utils/marketNavigation";
import { isOnline } from "@/utils/networkStatus";

const DASHBOARD_SNAPSHOT_GC_MS = 30 * 60 * 1000;
// A market switch swaps the query key; with staleTime 0 every flip refetched
// the snapshot it had just shown, so bouncing Forex ↔ Indian fired a request
// per tap. Trade/setup mutations invalidate ["dashboard"] explicitly (see
// utils/queryInvalidation), so a short freshness window loses nothing there.
const DASHBOARD_SNAPSHOT_STALE_MS = 30 * 1000;

// Hide the native splash screen after the dashboard shell is painted.
// Called via the Capacitor global so @capacitor/splash-screen npm package
// is not required — the plugin ships with @capacitor/android runtime.
function hideSplash() {
  if (!isNativeCapacitor()) return;
  try {
    window.Capacitor?.Plugins?.SplashScreen?.hide({ fadeOutDuration: 200 });
  } catch {
    // Not available in this runtime version — ignore.
  }
}

export function useDashboard() {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { currentMarket, isLoading: marketLoading } = useMarket();
  const routeMarket = pathname?.startsWith("/indian-market")
    ? MARKETS.INDIAN_MARKET
    : pathname === "/dashboard"
      ? MARKETS.FOREX
      : null;
  const dashboardMarket = routeMarket || currentMarket;
  const [mounted, setMounted] = useState(false);
  const [firstLoginDismissed, setFirstLoginDismissed] = useState(false);

  const {
    data: snapshot = null,
    isLoading: loading,
    isFetching: fetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ["dashboard", "snapshot", dashboardMarket],
    queryFn: ({ signal }) => getDashboardSnapshot(signal, dashboardMarket),
    ...TRADE_QUERY_FRESHNESS_OPTIONS,
    staleTime: DASHBOARD_SNAPSHOT_STALE_MS,
    gcTime: DASHBOARD_SNAPSHOT_GC_MS,
    enabled: mounted && (!marketLoading || Boolean(routeMarket)) && hasValidAuthToken(),
  });

  // Warm the other market's snapshot once this one is on screen, so the
  // market switcher can paint it straight from cache instead of dropping the
  // KPI cards to skeletons. One request per session at most: once either
  // market has data, the switch itself keeps it fresh under the normal
  // trade-freshness policy. Skipped offline, and never before this market's
  // own snapshot has landed so it can't compete with the first paint.
  useEffect(() => {
    if (!mounted || loading || !snapshot || !hasValidAuthToken() || !isOnline()) return;
    const otherMarket =
      dashboardMarket === MARKETS.INDIAN_MARKET ? MARKETS.FOREX : MARKETS.INDIAN_MARKET;
    const otherKey = ["dashboard", "snapshot", otherMarket];
    if (queryClient.getQueryState(otherKey)?.data !== undefined) return;
    queryClient
      .prefetchQuery({
        queryKey: otherKey,
        queryFn: ({ signal }) => getDashboardSnapshot(signal, otherMarket),
        gcTime: DASHBOARD_SNAPSHOT_GC_MS,
      })
      .catch(() => {
        // Best effort — the switch falls back to a section-level skeleton.
      });
  }, [mounted, loading, snapshot, dashboardMarket, queryClient]);

  // First-screen content signal for the brand opener (see utils/startupGate).
  // Settled means success OR error: an error card is still a painted screen,
  // and holding the opener over it would hide the retry button.
  useEffect(() => {
    // `snapshot` is also present straight from the persisted cache (see
    // utils/persistedQueryCache) — that counts: the screen is painted and
    // the refetch continues behind it.
    if (mounted && (snapshot || (!loading && error))) markStartupContentReady();
  }, [mounted, loading, snapshot, error]);

  useEffect(() => {
    let cancelled = false;

    const verifyAuth = async () => {
      if (!hasValidAuthToken() && !(await hydrateAuthToken())) {
        let newToken = null;
        try {
          newToken = await silentRefresh();
        } catch (error) {
          if (isAuthRefreshTransientError(error)) {
            console.warn("[Auth] dashboard preserved session after transient refresh failure", {
              at: new Date().toISOString(),
              reason: error.message,
            });
            if (!cancelled) { setMounted(true); hideSplash(); }
            return;
          }
          throw error;
        }
        if (!newToken) {
          if (!cancelled) router.replace("/login");
          return;
        }
      }

      if (!cancelled) { setMounted(true); hideSplash(); }
    };

    verifyAuth();

    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (!error) return;

    if (error?.data?.errorCode === "TERMS_NOT_ACCEPTED") {
      router.replace("/accept-terms");
      return;
    }

    // 401/403 are handled by the apiClient interceptor (handleUnauthenticated).
    // Handling them here too creates a race: double clearAuthToken + double redirect.
  }, [error, router]);

  // Restore the user's saved market choice from the server (covers fresh
  // logins on a new device where localStorage doesn't yet have it).
  //
  // This is a one-time startup restore, NOT a continuous sync. Without the
  // `marketDecided` guard it fights every deliberate switch: the user picks
  // Forex, the next snapshot still carries the old server-side preference, and
  // this flips `currentMarket` straight back to Indian_Market while the user
  // sits on the Forex dashboard — which then renders the other market's data
  // (0 trades, blank KPIs) on the wrong page.
  useEffect(() => {
    const onboarding = snapshot?.onboarding;
    if (!mounted || loading || !onboarding) return;
    if (onboarding.checklistDismissed || onboarding.tourCompleted || onboarding.completedAt) return;
    if (!onboarding.welcomeSeen || !onboarding.marketSelected || onboarding.setupAdded) return;

    const market = routeMarket || snapshot?.preferredMarket || dashboardMarket;
    router.replace(getOnboardingSetupsUrl(market));
  }, [
    mounted,
    loading,
    snapshot?.onboarding,
    snapshot?.preferredMarket,
    routeMarket,
    dashboardMarket,
    router,
  ]);

  // First-login welcome (full-screen modal). Runs once per user unless the
  // current session dismisses it before the refreshed snapshot arrives.
  const showFirstLogin = Boolean(
    mounted &&
    snapshot?.onboarding &&
    !snapshot.onboarding.welcomeSeen &&
    !snapshot.welcomeGuide?.isOnboardingCompleted &&
    !firstLoginDismissed
  );

  const closeFirstLogin = () => {
    setFirstLoginDismissed(true);
    queryClient.invalidateQueries({ queryKey: ["dashboard", "snapshot"] });
  };

  const refreshOnboarding = (nextOnboarding = null) => {
    if (nextOnboarding) {
      queryClient.setQueriesData({ queryKey: ["dashboard", "snapshot"], exact: false }, (old) => {
        if (!old) return old;
        return {
          ...old,
          onboarding: {
            ...(old.onboarding || {}),
            ...nextOnboarding,
          },
        };
      });
    }
    queryClient.invalidateQueries({ queryKey: ["dashboard", "snapshot"], exact: false });
  };

  return {
    stats: snapshot?.summary || null,
    loading,
    fetching,
    // A snapshot that failed with nothing cached for this market — the market
    // switcher's "couldn't load" state. With cached data React Query keeps
    // showing it and `error` is just a stale background refresh.
    loadFailed: Boolean(error) && !snapshot && !loading,
    retry: () => refetch(),
    mounted,
    showFirstLogin,
    closeFirstLogin,
    refreshOnboarding,
    currentMarket: dashboardMarket,
    preferredMarket: snapshot?.preferredMarket || null,
    onboarding: snapshot?.onboarding || null,
    error,
    selfAwareness: snapshot?.selfAwareness || null,
    psychologyCost: snapshot?.psychologyCost || null,
    tradingDNA: snapshot?.tradingDNA || null,
    timeline: snapshot?.timeline || null,
    profile: snapshot?.profile || null,
    notificationsSummary: snapshot?.notificationsSummary || null,
    streaks: snapshot?.streaks || null,
    reflection: snapshot?.reflection || null,
  };
}
