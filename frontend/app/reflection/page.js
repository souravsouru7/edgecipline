"use client";

import { Suspense, useState } from "react";
import ErrorBoundary from "@/components/ErrorBoundary";
import PageHeader from "@/features/shared/components/PageHeader";
import ReflectionCard from "@/features/reflections/components/ReflectionCard";
import ReflectionHistoryList from "@/features/reflections/components/ReflectionHistoryList";
import ReflectionSheet from "@/features/reflections/components/ReflectionSheet";
import {
  useReflectionHistory,
  useReflectionSummary,
} from "@/features/reflections/hooks/useReflection";

function Page() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [windowDays, setWindowDays] = useState(14);
  const summary = useReflectionSummary();
  const history = useReflectionHistory(windowDays);

  return (
    <div style={{
      minHeight: "100vh",
      background: "#F4F2EE",
      display: "flex",
      flexDirection: "column",
      fontFamily: "'Plus Jakarta Sans',sans-serif",
      color: "#0F1923",
    }}>
      <PageHeader showClock={false} />
      <main style={{ flex: 1, maxWidth: 760, width: "100%", margin: "0 auto", padding: "24px 16px 80px", boxSizing: "border-box" }}>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#94A3B8", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            Habit loop
          </div>
          <h1 style={{ margin: "4px 0 0", fontSize: 24, fontWeight: 800, color: "#0F1923" }}>
            Reflections
          </h1>
          <p style={{ margin: "6px 0 0", color: "#64748B", fontSize: 13 }}>
            One quick check-in at the end of the day. Watch the streak, the score, and the coaching tighten with you.
          </p>
        </div>

        <ReflectionCard
          data={summary.data ? {
            today: summary.data.today
              ? {
                  day: summary.data.today.day,
                  completed: summary.data.today.completed,
                  skipped: summary.data.today.skipped,
                  hadTrades: summary.data.today.context?.hadTrades,
                  tradeCount: summary.data.today.context?.tradeCount || 0,
                  followedPlan: summary.data.today.reflection?.followedPlan || null,
                }
              : null,
            weekly: summary.data.weekly,
            latestInsight: summary.data.latestInsight,
          } : null}
          loading={summary.isLoading}
        />

        <section style={{ marginTop: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "#0F1923" }}>History</h2>
            <div style={{ display: "inline-flex", gap: 4, padding: 3, borderRadius: 999, background: "#F1F5F9" }}>
              {[7, 14, 30].map((days) => {
                const active = windowDays === days;
                return (
                  <button
                    key={days}
                    type="button"
                    onClick={() => setWindowDays(days)}
                    style={{
                      padding: "5px 12px",
                      borderRadius: 999,
                      border: "none",
                      background: active ? "#0F1923" : "transparent",
                      color: active ? "#FFFFFF" : "#475569",
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {days}d
                  </button>
                );
              })}
            </div>
          </div>

          <ReflectionHistoryList
            items={history.data?.items || []}
            loading={history.isLoading}
          />
        </section>
      </main>

      <ReflectionSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </div>
  );
}

export default function ReflectionPage() {
  return (
    <ErrorBoundary fallback={<div style={{ padding: "2rem", textAlign: "center" }}>Reflection page failed to load. Please refresh.</div>}>
      <Suspense><Page /></Suspense>
    </ErrorBoundary>
  );
}
