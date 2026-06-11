
"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getTrades, deleteTrade } from "@/services/tradeApi";
import { getValidToken } from "@/utils/auth";
import { isAuthRefreshTransientError, silentRefresh } from "@/services/apiClient";
import { invalidateTradeDependentQueries } from "@/utils/queryInvalidation";
import { calculatePerformanceMetrics } from "@/utils/metricEngine";

/**
 * useTrades
 * Encapsulates all state and logic for the Trade Journal list page using TanStack Query.
 */
export function useTrades() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletingId, setDeletingId]     = useState(null);
  const [filter, setFilter]             = useState("ALL");
  const [period, setPeriod]             = useState("all");
  const [search, setSearch]             = useState("");
  const [mounted, setMounted]           = useState(false);
  const [hasToken, setHasToken]         = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // 1. Data Fetching via useQuery
  const { data: trades = [], isLoading: loading, error } = useQuery({
    queryKey: ["trades", period],
    queryFn: async () => {
      const data = await getTrades("Forex", { period });
      return Array.isArray(data) ? data : [];
    },
    // Start only after client auth check to avoid hydration mismatch.
    enabled: mounted && hasToken,
  });

  // 2. Data Deletion via useMutation
  const deleteMutation = useMutation({
    mutationFn: (id) => deleteTrade(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ["trades", period] });
      const previous = queryClient.getQueryData(["trades", period]);
      queryClient.setQueryData(["trades", period], (old) =>
        Array.isArray(old) ? old.filter(t => t._id !== id) : []
      );
      return { previous };
    },
    onError: (err, id, context) => {
      queryClient.setQueryData(["trades", period], context?.previous);
      setDeleteTarget(null);
      setDeletingId(null);
    },
    onSettled: () => {
      invalidateTradeDependentQueries(queryClient);
      setDeleteTarget(null);
      setDeletingId(null);
    },
  });
  const deleteMutate = deleteMutation.mutate;

  useEffect(() => {
    let cancelled = false;
    const checkAuth = async () => {
      if (!getValidToken()) {
        let token = null;
        try {
          token = await silentRefresh();
        } catch (err) {
          if (isAuthRefreshTransientError(err)) {
            console.warn("[Auth] trades preserved session after transient refresh failure", {
              at: new Date().toISOString(),
              status: err.status || 0,
            });
            if (!cancelled) setMounted(true);
            return;
          }
          throw err;
        }
        if (cancelled) return;
        if (!token) { router.replace("/login"); return; }
      }
      if (!cancelled) {
        setHasToken(true);
        setMounted(true);
      }
    };
    checkAuth();
    return () => { cancelled = true; };
  }, [router]);

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

  const performance = useMemo(() => calculatePerformanceMetrics(trades), [trades]);

  const summaryStats = useMemo(() => {
    const totalPnl = performance.grossPnL;
    const winRate = performance.winRate.toFixed(1);
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
  };
}
