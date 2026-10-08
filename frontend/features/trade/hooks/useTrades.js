
"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getTradesPage, deleteTrade } from "@/services/tradeApi";
import { useToast } from "@/features/shared/components/ui/Toast";
import { useRequireAuth } from "@/features/auth/hooks/useRequireAuth";
import {
  invalidateTradeDependentQueries,
  TRADE_QUERY_FRESHNESS_OPTIONS,
} from "@/utils/queryInvalidation";
import { calculatePerformanceMetrics } from "@/utils/metricEngine";

/**
 * useTrades
 * Encapsulates all state and logic for the Trade Journal list page using TanStack Query.
 */
export function useTrades() {
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletingId, setDeletingId]     = useState(null);
  const [filter, setFilter]             = useState("ALL");
  const [period, setPeriod]             = useState("all");
  const [search, setSearch]             = useState("");
  // Client-side auth check; the query below waits for it to avoid a
  // hydration mismatch and a guaranteed 401 on first paint.
  const { ready: mounted, authenticated: hasToken } = useRequireAuth();
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // 1. Data fetching — paged. The API returns 50 trades per page; pages are
  //    appended as the user scrolls (see LoadMoreSentinel) so the DOM never
  //    holds a thousand rows and the first paint is one page.
  const {
    data: pages,
    isLoading: loading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    // Filters are part of the key: changing one starts a fresh cursor instead
    // of appending rows from a different query onto the old ones.
    queryKey: ["trades", period, filter, debouncedSearch],
    queryFn: ({ pageParam, signal }) => getTradesPage("Forex", {
      period,
      after: pageParam,
      direction: filter,
      search: debouncedSearch,
      signal,
    }),
    initialPageParam: null,
    getNextPageParam: (last) => (last?.pagination?.hasNextPage ? last.pagination.next : undefined),
    // Start only after client auth check to avoid hydration mismatch.
    enabled: mounted && hasToken,
    ...TRADE_QUERY_FRESHNESS_OPTIONS,
    gcTime: 30 * 60 * 1000,
  });
  const trades = useMemo(() => (pages?.pages || []).flatMap((p) => p?.items || []), [pages]);
  const totalTrades = pages?.pages?.[0]?.pagination?.total ?? trades.length;

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // The active query's exact key. Optimistic updates have to name it in full
  // now that the filters are part of it; a prefix would read back undefined
  // and wipe the list.
  const activeKey = useMemo(
    () => ["trades", period, filter, debouncedSearch],
    [period, filter, debouncedSearch]
  );

  // 2. Data Deletion via useMutation
  const deleteMutation = useMutation({
    mutationFn: (id) => deleteTrade(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: activeKey });
      const previous = queryClient.getQueryData(activeKey);
      queryClient.setQueryData(activeKey, (old) => {
        if (!old?.pages) return old;
        return {
          ...old,
          // Drop the server summary with the row: it counted this trade, and
          // the refetch in onSettled brings a fresh one. Meanwhile the header
          // falls back to summing the rows that are actually on screen.
          pages: old.pages.map((p) => ({
            ...p,
            summary: null,
            items: (p?.items || []).filter((t) => t._id !== id),
          })),
        };
      });
      return { previous };
    },
    onError: (err, id, context) => {
      queryClient.setQueryData(activeKey, context?.previous);
      setDeleteTarget(null);
      setDeletingId(null);
      addToast(err.message || "Couldn't delete this trade. Please try again.", "error");
    },
    onSettled: () => {
      invalidateTradeDependentQueries(queryClient);
      setDeleteTarget(null);
      setDeletingId(null);
    },
  });
  const deleteMutate = deleteMutation.mutate;

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim().toLowerCase());
    }, 180);
    return () => clearTimeout(timer);
  }, [search]);

  const confirmDelete = useCallback(() => {
    if (!deleteTarget) return;
    const id = deleteTarget._id;
    setDeletingId(id);
    setTimeout(() => deleteMutate(id), 280);
  }, [deleteMutate, deleteTarget]);

  const cancelDelete = useCallback(() => setDeleteTarget(null), []);

  // The database already applied the direction filter and the search, so the
  // rows that arrived are the rows to show. Re-filtering here would only hide
  // matches that the server deliberately included.
  const filtered = trades;

  // Header boxes must describe the WHOLE period, not the pages fetched so
  // far: with 53 trades and a 50-row page the client-side sum showed 50
  // trades and a P&L that disagreed with the dashboard until the user
  // scrolled. The server now sends totals for the full filtered list; the
  // local sum is only the fallback for an older API.
  const serverSummary = pages?.pages?.[0]?.summary || null;
  // `total` is only sent with that first page, so hold on to it rather than
  // reading it off whichever page happens to be last.
  const totalForFilters = serverSummary?.totalTrades ?? null;
  const performance = useMemo(
    () => serverSummary || calculatePerformanceMetrics(trades),
    [serverSummary, trades]
  );


  const summaryStats = useMemo(() => {
    const totalPnl = Number(performance.grossPnL) || 0;
    const winRate = (Number(performance.winRate) || 0).toFixed(1);
    const totalBull = totalPnl >= 0;
    return [
      { label: "TOTAL TRADES", val: performance.totalTrades, bull: true },
      { label: "WIN RATE", val: `${winRate}%`, bull: parseFloat(winRate) >= 50 },
      { label: "TOTAL P&L", val: `${totalBull ? "+" : "-"}$${Math.abs(totalPnl).toFixed(2)}`, bull: totalBull },
    ];
  }, [performance]);

  const handlers = useMemo(() => ({
    setFilter,
    setPeriod,
    setSearch,
    setDeleteTarget,
    confirmDelete,
    cancelDelete,
  }), [confirmDelete, cancelDelete]);

  return {
    trades,
    filtered,
    loading: loading || deleteMutation.isPending,
    deleteTarget,
    deletingId,
    filter,
    period,
    search,
    summaryStats,
    mounted,
    error,
    handlers,
    // Paging
    totalTrades: totalForFilters ?? totalTrades,
    hasMore: Boolean(hasNextPage),
    loadingMore: isFetchingNextPage,
    loadMore,
  };
}
