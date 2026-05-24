"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { getSummary } from "@/services/analyticsApi";
import { getWelcomeGuideSeen, markWelcomeGuideSeen } from "@/services/api";

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
    enabled: typeof window !== "undefined" && !!localStorage.getItem("token"),
  });

  // 2. Auth guard + fetch welcome guide flag from backend
  useEffect(() => {
    const token = typeof window !== "undefined" && localStorage.getItem("token");
    if (!token) { router.push("/login"); return; }

    setMounted(true);

    getWelcomeGuideSeen()
      .then((res) => {
        if (!res?.hasSeenWelcomeGuide) setShowWelcome(true);
      })
      .catch(() => {
        // If the endpoint doesn't exist yet, fall back to localStorage
        const hasSeen = localStorage.getItem("hasSeenWelcomeGuide");
        if (!hasSeen) setShowWelcome(true);
      });
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
