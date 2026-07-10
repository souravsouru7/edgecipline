"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchSetups } from "@/services/setupApi";
import { TRADE_QUERY_FRESHNESS_OPTIONS } from "@/utils/queryInvalidation";

/**
 * useSetups
 * Fetches saved strategies/setups for the current market using TanStack Query.
 * Returns a mapped array with { id, name, rules[] } shape ready for dropdowns and checklists.
 *
 * @param {string}  marketType - The active market type string
 */
export function useSetups(marketType) {
  const { data: strategies = [], isLoading: setupsLoading, error } = useQuery({
    queryKey: ["setups", marketType],
    queryFn: async () => {
      const serverStrategies = await fetchSetups(marketType);
      
      if (Array.isArray(serverStrategies) && serverStrategies.length) {
        return serverStrategies.map((s, sIdx) => ({
          id: sIdx + 1,
          name: s.name || "",
          rules: Array.isArray(s.rules)
            ? s.rules.map((r, rIdx) => ({
                id: rIdx + 1,
                label: r.label || "",
                followed: false,
              }))
            : [],
        }));
      }
      return [];
    },
    ...TRADE_QUERY_FRESHNESS_OPTIONS,
    enabled: !!marketType,
  });

  return { strategies, setupsLoading, error };
}
