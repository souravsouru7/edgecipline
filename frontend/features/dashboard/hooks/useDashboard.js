"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
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

export function useDashboard() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { currentMarket, toggleMarket } = useMarket();
  const [mounted, setMounted] = useState(false);
  const [showFirstLogin, setShowFirstLogin] = useState(false);

  const {
    data: snapshot = null,
    isLoading: loading,
    error,
  } = useQuery({
    queryKey: ["dashboard", "snapshot"],
    queryFn: ({ signal }) => getDashboardSnapshot(signal),
    ...TRADE_QUERY_FRESHNESS_OPTIONS,
    gcTime: 30 * 60 * 1000,
    enabled: mounted && hasValidAuthToken(),
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
    const status = error?.status;

    if (error?.data?.errorCode === "TERMS_NOT_ACCEPTED") {
      router.replace("/accept-terms");
      return;
    }

    // 401/403 are handled by the apiClient interceptor (handleUnauthenticated).
    // Handling them here too creates a race: double clearAuthToken + double redirect.
  }, [error, router]);

  // Restore the user's saved market choice from the server (covers fresh
  // logins on a new device where localStorage doesn't yet have it).
  useEffect(() => {
    const preferred = snapshot?.preferredMarket;
    if (!preferred) return;
    if (preferred === currentMarket) return;
    if (!Object.values(MARKETS).includes(preferred)) return;
    toggleMarket(preferred);
  }, [snapshot?.preferredMarket, currentMarket, toggleMarket]);

  // First-login welcome (full-screen modal). Runs ONCE per user. Once the user
  // closes it, we route them into the forced setup -> trade -> journal loop.
  useEffect(() => {
    if (!mounted || !snapshot?.onboarding) return;
    if (snapshot.onboarding.welcomeSeen) return;
    if (snapshot.welcomeGuide?.isOnboardingCompleted) return;
    setShowFirstLogin(true);
  }, [mounted, snapshot?.onboarding, snapshot?.welcomeGuide]);

  const closeFirstLogin = () => {
    setShowFirstLogin(false);
    queryClient.invalidateQueries({ queryKey: ["dashboard", "snapshot"] });
  };

  const refreshOnboarding = () => {
    queryClient.invalidateQueries({ queryKey: ["dashboard", "snapshot"] });
  };

  return {
    stats: snapshot?.summary || null,
    loading,
    mounted,
    showFirstLogin,
    closeFirstLogin,
    refreshOnboarding,
    onboarding: snapshot?.onboarding || null,
    error,
    selfAwareness: snapshot?.selfAwareness || null,
    psychologyCost: snapshot?.psychologyCost || null,
    tradingDNA: snapshot?.tradingDNA || null,
    profile: snapshot?.profile || null,
    notificationsSummary: snapshot?.notificationsSummary || null,
    streaks: snapshot?.streaks || null,
    reflection: snapshot?.reflection || null,
  };
}
