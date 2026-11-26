"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PageHeader from "@/features/shared/components/PageHeader";
import LoadMoreSentinel from "@/features/shared/components/LoadMoreSentinel";
import OnboardingCompleteDialog from "@/features/onboarding/components/OnboardingCompleteDialog";
import { Button, EmptyState, SegmentedControl } from "@/features/shared/components/ui";
import { BookOpen } from "lucide-react";
import { markOnboardingStep } from "@/services/api";
import { useTheme } from "@/utils/theme";
import { useSystemBars } from "@/features/shared/hooks/useSystemBars";
import { useIndianTrades } from "@/features/trade/hooks/useIndianTrades";
import JournalList from "@/features/journal/components/JournalList";
import {
  DeleteTradeDialog, JournalEmpty, JournalError, JournalHeader, JournalStats, JournalToolbar, OnboardingBanner,
} from "@/features/journal/components/JournalShell";
import { tradeSymbol } from "@/features/journal/utils/tradeDisplay";

const INSTRUMENTS = [
  { value: "OPTION", label: "Options" },
  { value: "EQUITY", label: "Intraday stocks" },
];

function filterOptionsFor(instrumentType) {
  return [
    { value: "all", label: "All" },
    { value: "win", label: "Wins" },
    { value: "loss", label: "Losses" },
    ...(instrumentType === "EQUITY" ? [] : [
      { value: "CE", label: "Calls" },
      { value: "PE", label: "Puts" },
    ]),
  ];
}

function IndianTradesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { theme } = useTheme();
  useSystemBars(theme);
  const onboardingMode = searchParams?.get("onboarding") === "1";
  const focusToday = searchParams?.get("filter") === "today";
  const [completionDismissed, setCompletionDismissed] = useState(false);
  const showOnboardingComplete = onboardingMode && !completionDismissed;

  const j = useIndianTrades();

  useEffect(() => {
    if (!j.ready) return;
    markOnboardingStep("journalSeen", true).catch(() => {});
  }, [j.ready]);

  const emptyReason = j.filter !== "all" || j.search.trim()
    ? "filters"
    : j.period !== "all" ? "period" : "none";
  const clearFilters = () => { j.clearFilters(); j.setPeriod("all"); };
  const firstLoad = j.loading && !j.trades.length;
  const showEmpty = !j.loading && !j.error && j.filtered.length === 0;

  return (
    <div className="ec-app ec-home">
      <PageHeader themed showMarketSwitcher title="Journal" />
      <main className="ec-page ec-journal">
        {onboardingMode && <OnboardingBanner />}
        <JournalHeader subtitle="Indian market · NSE / BSE trades, day by day" />
        <JournalStats performance={j.performance} currency="INR" loading={firstLoad} />
        <JournalToolbar
          period={j.period}
          onPeriod={j.setPeriod}
          filterOptions={filterOptionsFor(j.instrumentType)}
          filter={j.filter}
          onFilter={j.setFilter}
          search={j.search}
          onSearch={j.setSearch}
          placeholder="Search symbol, setup or sector…"
        >
          <SegmentedControl label="Instrument" options={INSTRUMENTS} value={j.instrumentType} onChange={j.setInstrumentType} />
        </JournalToolbar>

        {j.error && !j.trades.length ? (
          <JournalError error={j.error} onRetry={j.refetch} />
        ) : showEmpty ? (
          j.trades.length && !j.filter.match(/^(win|loss|CE|PE)$/) && !j.search.trim() ? (
            // Trades exist this period, just none of this instrument type.
            <EmptyState
              icon={<BookOpen size={22} />}
              title={`No ${j.instrumentType === "EQUITY" ? "intraday stock" : "options"} trades in this period`}
              body="Switch instrument, or pick a longer period."
              action={
                <Button variant="secondary" onClick={() => j.setInstrumentType(j.instrumentType === "EQUITY" ? "OPTION" : "EQUITY")}>
                  Show {j.instrumentType === "EQUITY" ? "options" : "intraday stocks"}
                </Button>
              }
            />
          ) : (
            <JournalEmpty reason={emptyReason} onClear={clearFilters} />
          )
        ) : (
          <>
            <JournalList
              trades={j.filtered}
              indian
              loading={firstLoad}
              onDelete={j.setDeleteTarget}
              deletingId={j.deletingId}
              scrollToToday={focusToday}
            />
            <LoadMoreSentinel themed hasMore={j.hasMore} loading={j.loadingMore} onLoadMore={j.loadMore} loaded={j.trades.length} total={j.total} />
          </>
        )}
      </main>

      <DeleteTradeDialog
        trade={j.deleteTarget}
        symbol={tradeSymbol(j.deleteTarget, true)}
        onConfirm={j.confirmDelete}
        onCancel={j.cancelDelete}
        busy={j.deleting}
      />
      {showOnboardingComplete && (
        <OnboardingCompleteDialog
          onClose={() => setCompletionDismissed(true)}
          onDashboard={() => router.replace("/indian-market/dashboard?onboarded=1")}
        />
      )}
    </div>
  );
}

export default function IndianTradesPage() {
  return <Suspense><IndianTradesContent /></Suspense>;
}
