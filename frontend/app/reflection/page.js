"use client";

import { Suspense, useState } from "react";
import ErrorBoundary from "@/components/ErrorBoundary";
import PageHeader from "@/features/shared/components/PageHeader";
import { SegmentedControl, ErrorState } from "@/features/shared/components/ui";
import ReflectionCard from "@/features/reflections/components/ReflectionCard";
import ReflectionHistoryList from "@/features/reflections/components/ReflectionHistoryList";
import { useReflectionHistory, useReflectionSummary } from "@/features/reflections/hooks/useReflection";

const WINDOWS = [
  { value: "7", label: "7 days" },
  { value: "14", label: "14 days" },
  { value: "30", label: "30 days" },
];

function Page() {
  const [windowKey, setWindowKey] = useState("14");
  const summary = useReflectionSummary();
  const history = useReflectionHistory(Number(windowKey));

  return (
    <div className="ec-app ec-home">
      <PageHeader themed showMarketSwitcher title="Reflection" />
      <main className="ec-page ec-disc ec-disc--narrow">
        <div className="ec-log__head">
          <div style={{ minWidth: 0 }}>
            <h1 className="ec-log__title">Reflection</h1>
            <p className="ec-log__sub">A 30-second check-in at the end of the day. The weekly score and coaching build from it.</p>
          </div>
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

        <section aria-labelledby="reflection-history">
          <div className="ec-reflect__head">
            <h2 id="reflection-history" className="ec-card__title">History</h2>
            <SegmentedControl label="History window" value={windowKey} onChange={setWindowKey} options={WINDOWS} />
          </div>
          {history.isError ? (
            <ErrorState title="Couldn't load history" onRetry={() => history.refetch()} />
          ) : (
            <ReflectionHistoryList items={history.data?.items || []} loading={history.isLoading} />
          )}
        </section>
      </main>
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
