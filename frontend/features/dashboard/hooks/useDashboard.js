"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { getSummary } from "@/services/analyticsApi";
import { getProfile, getWelcomeGuideSeen, markWelcomeGuideSeen } from "@/services/api";
import { clearAuthToken, hasValidAuthToken } from "@/utils/auth";
import { silentRefresh } from "@/services/apiClient";

const TOUR_SEEN_KEY = "hasSeenWelcomeGuide";

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
        // No local token — attempt silent refresh via httpOnly cookie before giving up
        const newToken = await silentRefresh();
        if (!newToken) {
          if (!cancelled) router.replace("/login");
          return;
        }
      }

      try {
        await getProfile();
        if (cancelled) return;
        setMounted(true);
      } catch (err) {
        if (cancelled) return;
        const status = err?.status;
        if (err?.data?.errorCode === "TERMS_NOT_ACCEPTED") {
          router.replace("/accept-terms");
          return;
        }
        if (status === 401 || status === 403) {
          // Token is definitively rejected by the server — clear and redirect
          clearAuthToken();
          router.replace("/login");
          return;
        }
        // 429, 5xx, or network error: the token is still valid.
        // Mount in degraded state so the user can see the dashboard
        // and React Query will retry the data fetches automatically.
        setMounted(true);
      }

      // Only fetch welcome guide if still mounted — avoids a pointless request on unmount
      if (cancelled) return;
      getWelcomeGuideSeen()
        .then((res) => {
          if (cancelled || res?.isOnboardingCompleted) return;

          const hasSeenLocally = localStorage.getItem(TOUR_SEEN_KEY);
          if (hasSeenLocally) return;

          localStorage.setItem(TOUR_SEEN_KEY, "true");
          setShowWelcome(true);
          markWelcomeGuideSeen().catch(() => {});
        })
        .catch(() => {
          // If the endpoint doesn't exist yet, fall back to localStorage
          const hasSeen = localStorage.getItem(TOUR_SEEN_KEY);
          if (!cancelled && !hasSeen) {
            localStorage.setItem(TOUR_SEEN_KEY, "true");
            setShowWelcome(true);
          }
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
    localStorage.setItem(TOUR_SEEN_KEY, "true");
    markWelcomeGuideSeen().catch(() => {
      // Fallback: keep localStorage in sync too
      localStorage.setItem(TOUR_SEEN_KEY, "true");
    });
  };

  return { stats, loading, mounted, showWelcome, closeWelcome, error };
}
