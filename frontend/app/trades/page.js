"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PageHeader from "@/features/shared/components/PageHeader";
import LoadMoreSentinel from "@/features/shared/components/LoadMoreSentinel";
import OnboardingCompleteDialog from "@/features/onboarding/components/OnboardingCompleteDialog";
import { useTrades } from "@/features/trade/hooks/useTrades";
import { markOnboardingStep } from "@/services/api";
import { useMarket, MARKETS } from "@/context/MarketContext";
import { useTheme } from "@/utils/theme";
import { useSystemBars } from "@/features/shared/hooks/useSystemBars";
import JournalList from "@/features/journal/components/JournalList";
import {
  DeleteTradeDialog, JournalEmpty, JournalError, JournalHeader, JournalStats, JournalToolbar, OnboardingBanner,
} from "@/features/journal/components/JournalShell";
import { tradeSymbol } from "@/features/journal/utils/tradeDisplay";

const FILTER_OPTIONS = [
  { value: "ALL", label: "All" },
  { value: "LONG", label: "Long" },
  { value: "SHORT", label: "Short" },
];

function TradesContent() {
  const {
    filtered, loading, deleteTarget, deletingId, filter, search, period,
    performance, mounted, error, refetch,
    totalTrades, hasMore, loadingMore, loadMore, trades,
    handlers: { setFilter, setPeriod, setSearch, setDeleteTarget, confirmDelete, cancelDelete },
  } = useTrades();

  const router = useRouter();
  const searchParams = useSearchParams();
  const { theme } = useTheme();
  useSystemBars(theme);
  const { currentMarket, isLoading: marketLoading } = useMarket();
  const redirectQuery = searchParams?.toString();
  const onboardingMode = searchParams?.get("onboarding") === "1";
  // Trade-alert pushes deep-link here with ?filter=today.
  const focusToday = searchParams?.get("filter") === "today";
  const [completionDismissed, setCompletionDismissed] = useState(false);
  const showOnboardingComplete = onboardingMode && !completionDismissed;

  useEffect(() => {
    if (marketLoading || currentMarket !== MARKETS.INDIAN_MARKET) return;
    router.replace(`/indian-market/trades${redirectQuery ? `?${redirectQuery}` : ""}`);
  }, [currentMarket, marketLoading, redirectQuery, router]);

  // Mark "journal viewed" once the page has actually rendered.
  useEffect(() => {
    if (!mounted || currentMarket === MARKETS.INDIAN_MARKET) return;
    markOnboardingStep("journalSeen", true).catch(() => {});
  }, [currentMarket, mounted]);

  if (!marketLoading && currentMarket === MARKETS.INDIAN_MARKET) return null;

  const emptyReason = filter !== "ALL" || search.trim() ? "filters" : period !== "all" ? "period" : "none";
  const clearFilters = () => { setFilter("ALL"); setSearch(""); setPeriod("all"); };
  const showEmpty = !loading && !error && filtered.length === 0;

  return (
    <div className="ec-app ec-home">
      <PageHeader themed showMarketSwitcher title="Journal" />
      <main className="ec-page ec-journal">
        {onboardingMode && <OnboardingBanner />}
        <JournalHeader subtitle="Forex · every trade you've logged, day by day" />
        <JournalStats performance={performance} currency="USD" loading={loading && !trades.length} />
        <JournalToolbar
          period={period}
          onPeriod={setPeriod}
          filterOptions={FILTER_OPTIONS}
          filter={filter}
          onFilter={setFilter}
          search={search}
          onSearch={setSearch}
          placeholder="Search pair…"
        />

        {error && !trades.length ? (
          <JournalError onRetry={() => refetch()} />
        ) : showEmpty ? (
          <JournalEmpty reason={emptyReason} onClear={clearFilters} />
        ) : (
          <>
            <JournalList
              trades={filtered}
              loading={loading && !trades.length}
              onDelete={setDeleteTarget}
              deletingId={deletingId}
              scrollToToday={focusToday}
            />
            <LoadMoreSentinel themed hasMore={hasMore} loading={loadingMore} onLoadMore={loadMore} loaded={trades.length} total={totalTrades} />
            {!hasMore && filtered.length > 0 && (
              <p className="ec-journal__count">{filtered.length} of {totalTrades} trades</p>
            )}
          </>
        )}
      </main>

      <DeleteTradeDialog
        trade={deleteTarget}
        symbol={tradeSymbol(deleteTarget, false)}
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
        busy={Boolean(deletingId)}
      />
      {showOnboardingComplete && (
        <OnboardingCompleteDialog
          onClose={() => setCompletionDismissed(true)}
          onDashboard={() => router.replace("/dashboard?onboarded=1")}
        />
      )}
    </div>
  );
}

export default function TradesPage() {
  return <Suspense><TradesContent /></Suspense>;
}
