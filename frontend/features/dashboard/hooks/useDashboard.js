"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { markWelcomeGuideSeen } from "@/services/api";
import { getDashboardSnapshot } from "@/features/dashboard/api/dashboardApi";
import { hasValidAuthToken, hydrateAuthToken, isNativeCapacitor } from "@/utils/auth";
import { isAuthRefreshTransientError, silentRefresh } from "@/services/apiClient";

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

const TOUR_SEEN_KEY = "hasSeenWelcomeGuide";

export function useDashboard() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);

  const {
    data: snapshot = null,
    isLoading: loading,
    error,
  } = useQuery({
    queryKey: ["dashboard", "snapshot"],
    queryFn: ({ signal }) => getDashboardSnapshot(signal),
    staleTime: 2 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
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

  useEffect(() => {
    if (!mounted || !snapshot?.welcomeGuide) return;
    if (snapshot.welcomeGuide.isOnboardingCompleted) return;
    const hasSeenLocally = localStorage.getItem(TOUR_SEEN_KEY);
    if (hasSeenLocally) return;

    localStorage.setItem(TOUR_SEEN_KEY, "true");
    setShowWelcome(true);
    markWelcomeGuideSeen().catch(() => {});
  }, [mounted, snapshot?.welcomeGuide]);

  const closeWelcome = () => {
    setShowWelcome(false);
    localStorage.setItem(TOUR_SEEN_KEY, "true");
    markWelcomeGuideSeen().catch(() => {
      localStorage.setItem(TOUR_SEEN_KEY, "true");
    });
  };

  return {
    stats: snapshot?.summary || null,
    loading,
    mounted,
    showWelcome,
    closeWelcome,
    error,
    selfAwareness: snapshot?.selfAwareness || null,
    psychologyCost: snapshot?.psychologyCost || null,
    tradingDNA: snapshot?.tradingDNA || null,
    profile: snapshot?.profile || null,
    notificationsSummary: snapshot?.notificationsSummary || null,
  };
}
