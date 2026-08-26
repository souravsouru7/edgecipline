"use client";

import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMarket, MARKETS } from "@/context/MarketContext";
import { getDashboardSnapshot } from "@/features/dashboard/api/dashboardApi";
import { hasValidAuthToken, hydrateAuthToken, isNativeCapacitor } from "@/utils/auth";
import { isAuthRefreshTransientError, silentRefresh } from "@/services/apiClient";
import { TRADE_QUERY_FRESHNESS_OPTIONS } from "@/utils/queryInvalidation";

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

function setupRouteForMarket(market) {
  return market === MARKETS.INDIAN_MARKET
    ? "/indian-market/setups?onboarding=1"
    : "/setups?onboarding=1";
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
    error,
  } = useQuery({
    queryKey: ["dashboard", "snapshot", dashboardMarket],
    queryFn: ({ signal }) => getDashboardSnapshot(signal, dashboardMarket),
    ...TRADE_QUERY_FRESHNESS_OPTIONS,
    gcTime: 30 * 60 * 1000,
    enabled: mounted && (!marketLoading || Boolean(routeMarket)) && hasValidAuthToken(),
  });

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
    router.replace(setupRouteForMarket(market));
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
