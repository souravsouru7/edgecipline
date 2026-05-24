"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { getSummary } from "@/services/analyticsApi";
import { getProfile, getWelcomeGuideSeen, markWelcomeGuideSeen } from "@/services/api";
import { clearAuthToken, hasValidAuthToken } from "@/utils/auth";

/**
 * useDashboard
 * Fetches summary stats and manages the first-visit welcome guide.
 * hasSeenWelcomeGuide is stored as a boolean in the backend DB
 * via PATCH /auth/me/preferences.
 */
export function useDashboard() {
  const router = useRouter();
  const [mounted, setMounted]         = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);

  // 1. Dashboard stats
  const { data: stats = null, isLoading: loading, error } = useQuery({
    queryKey: ["dashboard", "summary"],
    queryFn: () => getSummary(),
    staleTime: 60 * 1000,
    enabled: mounted && hasValidAuthToken(),
  });

  // 2. Auth guard + fetch welcome guide flag from backend
  useEffect(() => {
    let cancelled = false;

    const verifyAuth = async () => {
      if (!hasValidAuthToken()) {
        router.replace("/login");
        return;
      }

      try {
        await getProfile();
        if (cancelled) return;
        setMounted(true);
      } catch {
        clearAuthToken();
        if (!cancelled) router.replace("/login");
        return;
      }

      getWelcomeGuideSeen()
      .then((res) => {
        if (!cancelled && !res?.hasSeenWelcomeGuide) setShowWelcome(true);
      })
      .catch(() => {
        // If the endpoint doesn't exist yet, fall back to localStorage
        const hasSeen = localStorage.getItem("hasSeenWelcomeGuide");
        if (!cancelled && !hasSeen) setShowWelcome(true);
      });
    };

    verifyAuth();

    return () => {
      cancelled = true;
    };
  }, [router]);

  // 3. Dismiss — saves to backend DB
  const closeWelcome = () => {
    setShowWelcome(false);
    markWelcomeGuideSeen().catch(() => {
      // Fallback: keep localStorage in sync too
      localStorage.setItem("hasSeenWelcomeGuide", "true");
    });
  };

  return { stats, loading, mounted, showWelcome, closeWelcome, error };
}
