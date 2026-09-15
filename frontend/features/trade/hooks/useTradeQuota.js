"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getTradeQuota } from "@/services/tradeApi";
import { MARKETS } from "@/context/MarketContext";

// Free-tier allowance for ONE market. Keyed by market so the Forex screen
// never renders the Indian count or vice versa.
//
// The key is deliberately not under ["trades"] — that prefix is invalidated
// on every trade write by invalidateTradeDependentQueries, and the create
// responses already carry the fresh quota, so we set it directly instead of
// paying a second round-trip.
export const tradeQuotaQueryKey = (marketType) => [
  "tradeQuota",
  marketType === MARKETS.INDIAN_MARKET ? MARKETS.INDIAN_MARKET : MARKETS.FOREX,
];

export function useTradeQuota(marketType, { enabled = true } = {}) {
  const query = useQuery({
    queryKey: tradeQuotaQueryKey(marketType),
    queryFn: async () => {
      const res = await getTradeQuota(marketType);
      return res?.quota || null;
    },
    enabled,
    staleTime: 60 * 1000,
    retry: false,
    refetchOnWindowFocus: true,
  });
  return { quota: query.data || null, loading: query.isLoading, refresh: query.refetch };
}

// Push the quota returned by a create-trade response into the cache so the
// pill flips to the new remaining count in the same render as the toast.
// Also invalidates so the next mount re-confirms with the server.
export function applyQuotaFromResponse(queryClient, marketType, response) {
  const quota = response?.quota;
  if (!queryClient || !quota || !quota.market) return null;
  const key = tradeQuotaQueryKey(quota.market);
  queryClient.setQueryData(key, quota);
  queryClient.invalidateQueries({ queryKey: key, exact: true, refetchType: "none" });
  // Defensive: a response for the other market (should not happen, but a
  // wrong key here would show Forex numbers on the Indian form).
  if (marketType && tradeQuotaQueryKey(marketType)[1] !== key[1]) return null;
  return quota;
}

export function useInvalidateTradeQuota() {
  const queryClient = useQueryClient();
  return (marketType) =>
    queryClient.invalidateQueries({ queryKey: tradeQuotaQueryKey(marketType), exact: true });
}
