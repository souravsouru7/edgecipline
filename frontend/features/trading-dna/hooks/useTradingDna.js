"use client";

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  generateTradingDna,
  getLatestTradingDna,
} from "../api/tradingDnaApi";

const VALID_PERIODS = ["30d", "90d", "365d"];
const VALID_MARKETS = ["Forex", "Indian_Market"];

function normalizePeriod(p) {
  return VALID_PERIODS.includes(p) ? p : "90d";
}

function normalizeMarket(m) {
  return VALID_MARKETS.includes(m) ? m : "Forex";
}

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

  const setMarketType = useCallback((next) => {
    setMarketTypeState(normalizeMarket(next));
  }, []);

  const setPeriod = useCallback((next) => {
    setPeriodState(normalizePeriod(next));
  }, []);

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
    mutationFn: ({ force = false } = {}) =>
      generateTradingDna({ marketType, period, force }),
    onSuccess: (fresh) => {
      queryClient.setQueryData(getQueryKey(marketType, period), fresh);
    },
  });

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
    isLoading: query.isLoading,
    isRegenerating: regenerate.isPending,
    regenerate: regenerate.mutateAsync,
    refetch: query.refetch,
  };
}
