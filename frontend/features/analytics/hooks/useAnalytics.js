"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useRequireAuth } from "@/features/auth/hooks/useRequireAuth";
import { useQuery } from "@tanstack/react-query";
import {
  getAnalyticsSnapshot,
} from "@/services/analyticsApi";
import { TRADE_QUERY_FRESHNESS_OPTIONS } from "@/utils/queryInvalidation";

/**
 * useAnalytics
 * Loads the shared analytics snapshot once and fans it out to page sections.
 *
 * Returns:
 *   loading           — true while any request is in flight
 *   data              — { summary, riskReward, distribution, performance, timeAnalysis, quality, drawdown, aiInsights, psychology }
 *   calendarMonth     — current Date for the P&L calendar
 *   prevMonth / nextMonth — navigation handlers
 */
export function useAnalytics() {
  const { ready } = useRequireAuth();
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [psychologyCostDays, setPsychologyCostDays] = useState("");
  const didAutoSetCalendarMonth = useRef(false);
  const didUserNavigateCalendar = useRef(false);
  const lastMonthNavAtRef = useRef(0);

  const shiftMonthSafe = useCallback((date, amount) => {
    const y = date.getFullYear();
    const m = date.getMonth();
    return new Date(y, m + amount, 1);
  }, []);

  const snapshotQuery = useQuery({
    queryKey: ["analytics", "snapshot", "Forex", psychologyCostDays || "all"],
    queryFn: ({ signal }) => getAnalyticsSnapshot("Forex", "", {
      days: psychologyCostDays,
      period: "weekly",
    }, signal),
    enabled: ready,
    ...TRADE_QUERY_FRESHNESS_OPTIONS,
    gcTime: 5 * 60 * 1000,
  });

  const snapshot = snapshotQuery.data || {};
  const error = snapshotQuery.error || null;
  const loading = snapshotQuery.isLoading;

  const data = useMemo(() => ({
    summary: snapshot.summary,
    performance: snapshot.performance,
    distribution: snapshot.distribution,
    riskReward: snapshot.riskReward || null,
    timeAnalysis: snapshot.timeAnalysis || null,
    drawdown: snapshot.drawdown || null,
    aiInsights: snapshot.aiInsights || snapshot.coachFeed || null,
    psychology: snapshot.psychology,
    tradeQualityAnalysis: snapshot.tradeQualityAnalysis,
    quality: snapshot.quality,
    selfAwareness: snapshot.selfAwareness,
    psychologyCost: snapshot.psychologyCost,
    tradingDNA: snapshot.tradingDNA,
    patterns: snapshot.patterns,
    coachFeed: snapshot.coachFeed,
    timeline: snapshot.timeline,
    discipline: snapshot.discipline,
    disciplineSummary: snapshot.disciplineSummary,
    pnlBreakdown: snapshot.pnlBreakdown,
    snapshot,
  }), [snapshot]);


  // Auto-navigate calendar to the most recent month with trades
  const timeAnalysis = data.timeAnalysis;
  useEffect(() => {
    if (didUserNavigateCalendar.current) return;
    if (didAutoSetCalendarMonth.current) return;
    const dateKeys = Object.keys(timeAnalysis?.byDate || {});
    if (dateKeys.length === 0) return;
    const latestKey = [...dateKeys].sort().slice(-1)[0];
    const [year, month] = latestKey.split("-").map(Number);
    if (year && month) {
      didAutoSetCalendarMonth.current = true;
      queueMicrotask(() => setCalendarMonth(new Date(year, month - 1, 1)));
    }
  }, [timeAnalysis]);

  const shiftMonth = useCallback((amount) => {
    const now = Date.now();
    if (now - lastMonthNavAtRef.current < 500) return;
    lastMonthNavAtRef.current = now;
    didUserNavigateCalendar.current = true;
    setCalendarMonth((prev) => shiftMonthSafe(prev, amount));
  }, [shiftMonthSafe]);

  const prevMonth = useCallback(() => shiftMonth(-1), [shiftMonth]);
  const nextMonth = useCallback(() => shiftMonth(+1), [shiftMonth]);

  return {
    loading,
    data,
    calendarMonth,
    prevMonth,
    nextMonth,
    coreLoading: loading,
    deepLoading: false,
    error,
    hasCoreData: Boolean(snapshot.summary),
    retryAfterSeconds: error?.retryAfterSeconds || 0,
    psychologyCostDays,
    setPsychologyCostDays,
  };
}
