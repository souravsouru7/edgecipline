"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getTrades, deleteTrade } from "@/services/tradeApi";

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
  const [period, setPeriod]             = useState("1m");
  const [search, setSearch]             = useState("");
  const [mounted, setMounted]           = useState(false);
  const [hasToken, setHasToken]         = useState(false);

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
      queryClient.invalidateQueries({ queryKey: ["trades"] });
      setDeleteTarget(null);
      setDeletingId(null);
    },
  });

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      router.push("/login");
      return;
    }
    setHasToken(true);
    setMounted(true);
  }, [router]);

  const confirmDelete = () => {
    if (!deleteTarget) return;
    const id = deleteTarget._id;
    setDeletingId(id);
    setTimeout(() => deleteMutation.mutate(id), 280);
  };

  const cancelDelete = () => setDeleteTarget(null);

  // Client-side filtering logic (preserved from original)
  const filtered = trades.filter((t) => {
    if (!t.pair || !String(t.pair).trim()) return false;
    const matchFilter = filter === "ALL" || t.type?.toUpperCase() === filter;
    const q = search.toLowerCase();
    const dateText = new Date(t.tradeDate || t.createdAt).toLocaleDateString().toLowerCase();
    const matchSearch = t.pair?.toLowerCase().includes(q) || dateText.includes(q);
    return matchFilter && matchSearch;
  });

  // Summary stats (computed from trades)
  const totalPnl   = trades.reduce((s, t) => s + (parseFloat(t.profit) || 0), 0);
  const winners    = trades.filter((t) => parseFloat(t.profit) >= 0).length;
  const winRate    = trades.length ? ((winners / trades.length) * 100).toFixed(1) : "0.0";
  const totalBull  = totalPnl >= 0;

  const summaryStats = [
    { label: "TOTAL TRADES", val: trades.length,                                               bull: true       },
    { label: "WIN RATE",      val: `${winRate}%`,                                              bull: parseFloat(winRate) >= 50 },
    { label: "TOTAL P&L",     val: `${totalBull ? "+" : ""}$${Math.abs(totalPnl).toFixed(2)}`, bull: totalBull  },
  ];

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
    handlers: { setFilter, setPeriod, setSearch, setDeleteTarget, confirmDelete, cancelDelete },
  };
}
