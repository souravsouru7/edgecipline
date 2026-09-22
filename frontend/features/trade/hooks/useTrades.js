
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
    queryKey: ["trades", period],
    queryFn: ({ pageParam, signal }) => getTradesPage("Forex", { period, after: pageParam, signal }),
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

  // 2. Data Deletion via useMutation
  const deleteMutation = useMutation({
    mutationFn: (id) => deleteTrade(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ["trades", period] });
      const previous = queryClient.getQueryData(["trades", period]);
      queryClient.setQueryData(["trades", period], (old) => {
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
      queryClient.setQueryData(["trades", period], context?.previous);
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

  const filtered = useMemo(() => {
    return trades.filter((t) => {
      const direction = t.type?.toUpperCase() === "BUY" ? "LONG"
                      : t.type?.toUpperCase() === "SELL" ? "SHORT"
                      : t.type?.toUpperCase();
      if (filter !== "ALL" && direction !== filter) return false;
      if (!debouncedSearch) return true;

      const pairText = (t.pair || "").toLowerCase();
      if (pairText.includes(debouncedSearch)) return true;

      const dateText = new Date(t.tradeDate || t.createdAt).toLocaleDateString().toLowerCase();
      return dateText.includes(debouncedSearch);
    });
  }, [trades, filter, debouncedSearch]);

  // Header boxes must describe the WHOLE period, not the pages fetched so
  // far: with 53 trades and a 50-row page the client-side sum showed 50
  // trades and a P&L that disagreed with the dashboard until the user
  // scrolled. The server now sends totals for the full filtered list; the
  // local sum is only the fallback for an older API.
  const serverSummary = pages?.pages?.[0]?.summary || null;
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
    totalTrades,
    hasMore: Boolean(hasNextPage),
    loadingMore: isFetchingNextPage,
    loadMore,
  };
}
