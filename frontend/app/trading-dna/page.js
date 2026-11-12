"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Clock, RefreshCw } from "lucide-react";
import ErrorBoundary from "@/components/ErrorBoundary";
import PageHeader from "@/features/shared/components/PageHeader";
import { Button, ErrorState } from "@/features/shared/components/ui";
import { marketRoutes } from "@/features/shared/navigation";
import { hasValidAuthToken } from "@/utils/auth";
import { useMarket } from "@/context/MarketContext";
import {
  BehaviorPatternsCard,
  BlindSpotsList,
  CoachSummaryCard,
  ControlsBar,
  EmptyState,
  EvolutionChart,
  IdentityHero,
  ImprovementPrioritiesList,
  QuarterlyCompareCard,
  ReportSkeleton,
  ShareModal,
  StrengthsWeaknessesGrid,
  useTradingDna,
} from "@/features/trading-dna";
import { DNA_PERIODS } from "@/features/trading-dna/components/ControlsBar";

function Notice({ tone = "warn", icon, children, action }) {
  return (
    <div className={`ec-dna__notice ec-dna__notice--${tone}`} role={tone === "bad" ? "alert" : "status"}>
      <span className="ec-dna__notice-icon" aria-hidden="true">{icon}</span>
      <p>{children}</p>
      {action}
    </div>
  );
}

function TradingDnaContent() {
  const router = useRouter();
  const { currentMarket } = useMarket();
  // Hydrate from the auth token on the very first client render so React Query
  // can fire immediately without a synchronous setState inside an effect.
  const [mounted] = useState(() =>
    typeof window === "undefined" ? false : hasValidAuthToken()
  );

  useEffect(() => {
    if (!mounted) router.replace("/login");
  }, [mounted, router]);

  const {
    marketType,
    period,
    setMarketType,
    setPeriod,
    report,
    ai,
    bundle,
    isStale,
    loadError,
    generateError,
    isLoading,
    isRegenerating,
    regenerate,
    refetch,
  } = useTradingDna({
    initialMarket: currentMarket || "Forex",
    initialPeriod: "90d",
    enabled: mounted,
  });

  const [shareOpen, setShareOpen] = useState(false);
  // Synchronous lock: two clicks in the same tick both pass the disabled
  // check before React re-renders, and each generate call costs a model run.
  const submittingRef = useRef(false);

  // The report follows the header's market switcher.
  useEffect(() => {
    if (currentMarket) setMarketType(currentMarket);
  }, [currentMarket, setMarketType]);

  const handleRegenerate = async ({ force = false } = {}) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      await regenerate({ force });
    } catch (e) {
      // Surfaced through generateError; logged for devtools.
      console.error("[TradingDNA] regenerate failed", e);
    } finally {
      submittingRef.current = false;
    }
  };

  const periodMeta = DNA_PERIODS.find((p) => p.value === period) || DNA_PERIODS[1];
  const conflict = generateError?.status === 409;
  const rateLimited = generateError?.status === 429;
  const showSkeleton = !mounted || (isLoading && !report);
  const hasReport = Boolean(report);
  const back = marketRoutes(marketType).analytics;
  const marketLabel = marketType === "Indian_Market" ? "Indian market" : "Forex";

  let body;
  if (showSkeleton) {
    body = <ReportSkeleton />;
  } else if (loadError && !hasReport) {
    body = (
      <ErrorState
        title="Couldn't load your Trading DNA"
        body={loadError?.message || "Check your connection and try again."}
        onRetry={() => refetch?.()}
      />
    );
  } else if (!hasReport || !ai) {
    body = (
      <EmptyState
        onGenerate={() => handleRegenerate({ force: false })}
        isGenerating={isRegenerating}
        market={marketType}
        periodLabel={periodMeta.long}
      />
    );
  } else {
    body = (
      <div className="ec-disc__stack">
        <IdentityHero
          identity={ai.identity}
          sample={bundle?.sample}
          generatedAt={report?.updatedAt || report?.createdAt}
        />
        {ai.coachSummary || ai.confidenceNote ? (
          <CoachSummaryCard summary={ai.coachSummary} confidenceNote={ai.confidenceNote} />
        ) : null}
        <ImprovementPrioritiesList items={ai.improvementPriorities} />
        <StrengthsWeaknessesGrid strengths={ai.strengths} weaknesses={ai.weaknesses} />
        <BlindSpotsList items={ai.blindSpots} />
        <BehaviorPatternsCard items={ai.behaviorPatterns} />
        <EvolutionChart data={bundle?.monthlyEvolution || []} />
        <QuarterlyCompareCard comparison={bundle?.quarterlyComparison} market={marketType} />
      </div>
    );
  }

  return (
    <div className="ec-app ec-home">
      <PageHeader themed showMarketSwitcher title="Trading DNA" />
      <main className="ec-page ec-disc ec-dna">
        <Link href={back} className="ec-psy__back">
          <ArrowLeft size={14} aria-hidden="true" /> Analytics
        </Link>
        <div className="ec-log__head">
          <div style={{ minWidth: 0 }}>
            <h1 className="ec-log__title">Trading DNA</h1>
            <p className="ec-log__sub">
              {marketLabel} · Your trading style, read by the AI coach from the trades you&apos;ve logged.
            </p>
          </div>
        </div>

        <ControlsBar
          period={period}
          onPeriodChange={setPeriod}
          onRegenerate={() => handleRegenerate({ force: false })}
          onShare={() => setShareOpen(true)}
          isRegenerating={isRegenerating}
          canShare={Boolean(ai?.identity?.archetype && report?._id)}
          canRegenerate={hasReport && Boolean(ai)}
        />

        {conflict ? (
          <Notice
            icon={<Clock size={16} />}
            action={
              <Button size="sm" variant="secondary" onClick={() => handleRegenerate({ force: true })} loading={isRegenerating}>
                Rebuild anyway
              </Button>
            }
          >
            This report was built in the last 24 hours. Rebuild it now only if you&apos;ve logged or edited trades since.
          </Notice>
        ) : null}

        {generateError && !conflict ? (
          <Notice
            tone="bad"
            icon={<AlertTriangle size={16} />}
            action={
              rateLimited ? null : (
                <Button size="sm" variant="secondary" onClick={() => handleRegenerate({ force: false })} loading={isRegenerating}>
                  Try again
                </Button>
              )
            }
          >
            {rateLimited
              ? "Too many rebuilds in a row. Wait a minute, then try again."
              : generateError?.message || "Couldn't build the report. Please try again."}
          </Notice>
        ) : null}

        {loadError && hasReport ? (
          <Notice
            tone="bad"
            icon={<AlertTriangle size={16} />}
            action={<Button size="sm" variant="secondary" onClick={() => refetch?.()}>Try again</Button>}
          >
            Couldn&apos;t refresh this report. You&apos;re seeing the last saved copy.
          </Notice>
        ) : null}

        {isStale && !isRegenerating && !conflict ? (
          <Notice
            tone="info"
            icon={<RefreshCw size={16} />}
            action={
              <Button size="sm" variant="secondary" onClick={() => handleRegenerate({ force: true })}>
                Rebuild
              </Button>
            }
          >
            You&apos;ve changed trades since this report was built, so parts of it may be out of date.
          </Notice>
        ) : null}

        {isRegenerating && hasReport ? (
          <Notice tone="info" icon={<RefreshCw size={16} className="ec-spin" />}>
            Rebuilding from your latest trades. This can take up to a minute.
          </Notice>
        ) : null}

        {body}
      </main>

      <ShareModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        report={report}
        ai={ai}
        bundle={bundle}
      />
    </div>
  );
}

export default function TradingDnaPage() {
  return (
    <ErrorBoundary
      fallback={
        <div style={{ padding: "2rem", textAlign: "center" }}>
          Trading DNA failed to load. Please refresh.
        </div>
      }
    >
      <Suspense>
        <TradingDnaContent />
      </Suspense>
    </ErrorBoundary>
  );
}
