"use client";

import { useQuery } from "@tanstack/react-query";
import { MARKETS } from "@/context/MarketContext";
import { getCoachFeed } from "@/services/analyticsApi";
import { getIndianIntelligenceSummary } from "@/features/indian-intelligence/api/indianIntelligenceApi";
import { toIndianCoachFeed } from "@/features/indian-intelligence/coachFeed";
import { hasValidAuthToken } from "@/utils/auth";

// The AI Coach Feed used to live only behind Intelligence → AI Coach Feed.
// Home now shows it directly, fed by exactly the sources those pages used:
//   Forex  → /analytics/ai-coach-feed
//   Indian → the Indian intelligence engine (same ranking as every Indian module)
// It loads after the dashboard snapshot, so it never slows Home's first paint.
export function useCoachFeed(market, { enabled = true } = {}) {
  const isIndian = market === MARKETS.INDIAN_MARKET;
  return useQuery({
    queryKey: isIndian ? ["indian-intelligence", "summary", "ALL", "coachFeed"] : ["coachFeed", "Forex"],
    queryFn: async ({ signal }) => {
      if (isIndian) {
        const summary = await getIndianIntelligenceSummary("ALL", signal);
        return summary ? toIndianCoachFeed(summary) : null;
      }
      const res = await getCoachFeed("Forex", "", signal);
      return res?.data?.insights ? res.data : res;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
    enabled: enabled && hasValidAuthToken(),
  });
}
