"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { markWelcomeGuideSeen } from "@/services/api";
import { getDashboardSnapshot } from "@/features/dashboard/api/dashboardApi";
import { clearAuthToken, hasValidAuthToken, hydrateAuthToken } from "@/utils/auth";
import { silentRefresh } from "@/services/apiClient";

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
    gcTime: 10 * 60 * 1000,
    refetchOnReconnect: true,
    refetchOnWindowFocus: false,
    enabled: mounted && hasValidAuthToken(),
  });

  useEffect(() => {
    let cancelled = false;

    const verifyAuth = async () => {
      if (!hasValidAuthToken() && !(await hydrateAuthToken())) {
        const newToken = await silentRefresh();
        if (!newToken) {
          if (!cancelled) router.replace("/login");
          return;
        }
      }

      if (!cancelled) setMounted(true);
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

    if (status === 401 || status === 403) {
      clearAuthToken().finally(() => router.replace("/login"));
    }
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
