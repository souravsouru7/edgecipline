"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  generateTradingDna,
  getLatestTradingDna,
  normalizeMarket,
  normalizePeriod,
} from "../api/tradingDnaApi";

function getQueryKey(marketType, period) {
  return ["tradingDna", "latest", marketType, period];
}

/**
 * useTradingDna
 *
 * Drives the Trading DNA report page. Pulls the latest stored report for the
 * (market, period) combination and exposes a regenerate action that hits the
 * AI endpoint and writes the fresh report into the same cache key.
 *
 * Params:
 *   initialMarket  — "Forex" | "Indian_Market"   (default "Forex")
 *   initialPeriod  — "30d" | "90d" | "365d"      (default "90d")
 *   enabled        — gate the query on auth-ready                 (default true)
 */
export function useTradingDna({
  initialMarket = "Forex",
  initialPeriod = "90d",
  enabled = true,
} = {}) {
  const queryClient = useQueryClient();
  const [marketType, setMarketTypeState] = useState(
    normalizeMarket(initialMarket)
  );
  const [period, setPeriodState] = useState(normalizePeriod(initialPeriod));


  const query = useQuery({
    queryKey: getQueryKey(marketType, period),
    queryFn: ({ signal }) =>
      getLatestTradingDna({ marketType, period }, signal),
    enabled,
    // The report is server-side cached and updated only on regenerate;
    // keep it fresh for a few minutes so tab switches do not refetch.
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const regenerate = useMutation({
    // The market/period travel with the call: if the user switches period
    // while the model is still running (it can take a minute), the fresh
    // report must land in the cache of the period it was generated for, not
    // whichever one is on screen when it finishes.
    mutationFn: ({ force = false, market, window: win }) =>
      generateTradingDna({ marketType: market, period: win, force }),
    onSuccess: (fresh, vars) => {
      queryClient.setQueryData(getQueryKey(vars.market, vars.window), fresh);
    },
  });
  const resetRegenerate = regenerate.reset;
  const mutateRegenerate = regenerate.mutateAsync;

  // A conflict or failure from one market/period must not follow the user to
  // another one, so clear a settled mutation whenever the view changes. An
  // in-flight one is left alone; it still saves to its own period's cache.
  const regeneratePending = regenerate.isPending;
  const pendingRef = useRef(regeneratePending);
  useEffect(() => {
    pendingRef.current = regeneratePending;
  }, [regeneratePending]);
  useEffect(() => {
    if (!pendingRef.current) resetRegenerate();
  }, [marketType, period, resetRegenerate]);

  const setMarketType = useCallback((next) => {
    setMarketTypeState(normalizeMarket(next));
  }, []);

  const setPeriod = useCallback((next) => {
    setPeriodState(normalizePeriod(next));
  }, []);

  const runRegenerate = useCallback(
    ({ force = false } = {}) => mutateRegenerate({ force, market: marketType, window: period }),
    [mutateRegenerate, marketType, period]
  );

  // The backend currently returns the full Mongo doc — the AI report and the
  // signals bundle each live on dedicated fields. Memoise the surface the UI
  // actually consumes so re-renders stay stable.
  const report = query.data || null;
  const ai = report?.ai || null;
  const bundle = report?.bundle || null;
  // `meta` is attached by the backend on every authenticated read/generate.
  // `meta.stale` is true when the user has changed trades since the report
  // was generated.
  const isStale = Boolean(report?.meta?.stale);

  const status = useMemo(() => {
    if (query.isLoading) return "loading";
    if (query.error) return "error";
    if (!report) return "empty";
    if (regenerate.isPending) return "regenerating";
    return "ready";
  }, [query.isLoading, query.error, report, regenerate.isPending]);

  return {
    marketType,
    period,
    setMarketType,
    setPeriod,
    status,
    report,
    ai,
    bundle,
    isStale,
    error: query.error || regenerate.error || null,
    loadError: query.error || null,
    generateError: regenerate.error || null,
    isLoading: query.isLoading,
    isRegenerating: regenerate.isPending,
    regenerate: runRegenerate,
    refetch: query.refetch,
  };
}
