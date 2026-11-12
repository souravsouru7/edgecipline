"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRequireAuth } from "@/features/auth/hooks/useRequireAuth";
import { getTradesPage, deleteTrade } from "@/services/tradeApi";
import { MARKETS } from "@/context/MarketContext";
import { invalidateTradeDependentQueries } from "@/utils/queryInvalidation";
import { calculatePerformanceMetrics } from "@/utils/metricEngine";
import { useToast } from "@/features/shared/components/ui/Toast";
import { isEquityTrade, tradeSymbol } from "@/features/journal/utils/tradeDisplay";

/**
 * Indian-market journal state. Moved out of the page unchanged in behaviour:
 * period on the server; instrument type, result, CE/PE and search on the
 * loaded rows (the Indian list API has no filter params).
 */
export function useIndianTrades() {
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const { ready } = useRequireAuth();

  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pageInfo, setPageInfo] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [summary, setSummary] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [filter, setFilter] = useState("all");
  const [period, setPeriod] = useState("1m");
  const [search, setSearch] = useState("");
  const [instrumentType, setInstrumentTypeState] = useState("OPTION");
  // Only the latest request may write state: switching period quickly must
  // not let an older, slower response overwrite the newer one.
  const requestRef = useRef(0);

  const fetchTrades = useCallback(async () => {
    const id = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const { items, pagination, summary: totals } = await getTradesPage(MARKETS.INDIAN_MARKET, { period });
      if (id !== requestRef.current) return;
      setTrades(items);
      setPageInfo(pagination);
      setSummary(totals);
    } catch (err) {
      if (id !== requestRef.current) return;
      setError(err);
    } finally {
      if (id === requestRef.current) setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    if (ready) fetchTrades();
  }, [ready, fetchTrades]);

  const loadMore = useCallback(async () => {
    if (!pageInfo?.hasNextPage || loadingMore) return;
    const id = requestRef.current;
    setLoadingMore(true);
    try {
      const { items, pagination } = await getTradesPage(MARKETS.INDIAN_MARKET, { period, after: pageInfo.next });
      if (id !== requestRef.current) return;
      setTrades((prev) => {
        const seen = new Set(prev.map((t) => t._id));
        return [...prev, ...items.filter((t) => !seen.has(t._id))];
      });
      setPageInfo(pagination);
    } catch {
      addToast("Couldn't load more trades. Try again.", "error");
    } finally {
      setLoadingMore(false);
    }
  }, [pageInfo, loadingMore, period, addToast]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget || deleting) return;
    const id = deleteTarget._id;
    setDeleting(true);
    try {
      await deleteTrade(id, MARKETS.INDIAN_MARKET);
      setDeleteTarget(null);
      setDeletingId(id);
      // Let the row's exit animation play before it leaves the list.
      await new Promise((r) => setTimeout(r, 260));
      setTrades((t) => t.filter((x) => x._id !== id));
      // The server totals still count this trade; fall back to the rows on
      // screen until the next fetch.
      setSummary(null);
      invalidateTradeDependentQueries(queryClient);
    } catch (err) {
      addToast(err?.message || "Couldn't delete this trade. Please try again.", "error");
    } finally {
      setDeleting(false);
      setDeletingId(null);
    }
  }, [deleteTarget, deleting, queryClient, addToast]);

  const cancelDelete = useCallback(() => { if (!deleting) setDeleteTarget(null); }, [deleting]);

  const setInstrumentType = useCallback((v) => {
    setInstrumentTypeState(v);
    setFilter("all"); // CE/PE don't exist for stocks
  }, []);

  const instrumentTrades = useMemo(
    () => trades.filter((t) => (instrumentType === "EQUITY" ? isEquityTrade(t) : !isEquityTrade(t))),
    [trades, instrumentType]
  );

  const filtered = useMemo(() => {
    let list = instrumentTrades;
    if (filter === "win") list = list.filter((t) => (Number(t.profit) || 0) > 0);
    if (filter === "loss") list = list.filter((t) => (Number(t.profit) || 0) < 0);
    if (filter === "CE") list = list.filter((t) => (t.optionType || "CE") === "CE");
    if (filter === "PE") list = list.filter((t) => (t.optionType || "CE") === "PE");
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((t) =>
        [tradeSymbol(t, true), t.pair, t.stockSymbol, t.strategy, t.setup, t.underlying, t.sector]
          .some((v) => String(v || "").toLowerCase().includes(q)) ||
        new Date(t.tradeDate || t.createdAt).toLocaleDateString("en-IN").toLowerCase().includes(q)
      );
    }
    return list;
  }, [instrumentTrades, filter, search]);

  const performance = useMemo(
    () => summary?.[instrumentType] || calculatePerformanceMetrics(instrumentTrades),
    [summary, instrumentType, instrumentTrades]
  );

  const clearFilters = useCallback(() => { setFilter("all"); setSearch(""); }, []);

  return {
    ready,
    trades,
    filtered,
    loading,
    error,
    refetch: fetchTrades,
    performance,
    filter, setFilter,
    period, setPeriod,
    search, setSearch,
    instrumentType, setInstrumentType,
    clearFilters,
    deleteTarget, setDeleteTarget, deletingId, deleting, confirmDelete, cancelDelete,
    hasMore: Boolean(pageInfo?.hasNextPage),
    loadingMore,
    loadMore,
    total: pageInfo?.total ?? null,
  };
}
