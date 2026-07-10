"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ErrorBoundary from "@/components/ErrorBoundary";
import CandlestickBackground from "@/features/shared/components/CandlestickBackground";
import TickerTape from "@/features/shared/components/TickerTape";
import PageHeader from "@/features/shared/components/PageHeader";
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

const C = {
  bgPage: "#F4F2EE",
  primary: "#0F1923",
  muted: "#94A3B8",
  bear: "#D63B3B",
};

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
    status,
    report,
    ai,
    bundle,
    isStale,
    error,
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
  // Synchronous lock to swallow rapid duplicate clicks on Regenerate before
  // React commits the `isRegenerating` state. The button disables visually,
  // but two clicks fired within the same microtask both pass the JSX check —
  // a useRef flip happens in the call itself, so the second click is a no-op.
  const submittingRef = useRef(false);

  // Keep the local market in sync if the user flips the global MarketSwitcher.
  useEffect(() => {
    if (!currentMarket) return;
    setMarketType(currentMarket);
  }, [currentMarket, setMarketType]);

  const handleRegenerate = async ({ force = false } = {}) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      await regenerate({ force });
    } catch (e) {
      // useMutation surfaces the error via the `error` field; nothing else
      // to do here. Console log so devtools captures it.
      console.error("[TradingDNA] regenerate failed", e);
    } finally {
      submittingRef.current = false;
    }
  };

  const showSkeleton = !mounted || (isLoading && !report);
  const isEmpty = mounted && !isLoading && !report;
  const conflict = error?.status === 409;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: C.bgPage,
        fontFamily: "'Plus Jakarta Sans',sans-serif",
        color: C.primary,
        position: "relative",
      }}
    >
      <link
        href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
        rel="stylesheet"
      />
      <CandlestickBackground canvasId="trading-dna-bg" />

      <div
        style={{
          position: "relative",
          zIndex: 10,
          display: "flex",
          flexDirection: "column",
          minHeight: "100vh",
        }}
      >
        <PageHeader />
        <TickerTape />

        <main
          style={{
            flex: 1,
            maxWidth: 960,
            width: "100%",
            margin: "0 auto",
            padding: "28px 20px",
            boxSizing: "border-box",
          }}
        >
          <div style={{ marginBottom: 22 }}>
            <Link
              href="/analytics"
              style={{
                fontSize: 11,
                color: C.muted,
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                marginBottom: 10,
              }}
            >
              ← Back to Analytics
            </Link>
            <h1
              style={{
                fontSize: 24,
                fontWeight: 900,
                color: C.primary,
                letterSpacing: "-0.03em",
                margin: 0,
                marginBottom: 4,
              }}
            >
              Trading DNA
            </h1>
            <p
              style={{
                fontSize: 12,
                color: C.muted,
                fontFamily: "'JetBrains Mono',monospace",
                margin: 0,
                letterSpacing: "0.04em",
              }}
            >
              YOUR BEHAVIORAL FINGERPRINT — DERIVED FROM YOUR JOURNAL
            </p>
          </div>

          <div style={{ marginBottom: 20 }}>
            <ControlsBar
              marketType={marketType}
              period={period}
              onMarketChange={setMarketType}
              onPeriodChange={setPeriod}
              onRegenerate={() => handleRegenerate({ force: false })}
              onShare={() => setShareOpen(true)}
              isRegenerating={isRegenerating}
              canShare={Boolean(ai?.identity?.archetype && report?._id)}
            />
          </div>

          {conflict ? (
            <div
              style={{
                marginBottom: 20,
                padding: "12px 16px",
                borderRadius: 12,
                background: "#FFFBEB",
                border: "1px solid #FDE68A",
                color: "#92400E",
                fontSize: 12,
                lineHeight: 1.6,
                display: "flex",
                gap: 12,
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
              }}
            >
              <div>
                You already generated a DNA report recently. You can force a
                regeneration if your journal has changed.
              </div>
              <button
                type="button"
                onClick={() => handleRegenerate({ force: true })}
                disabled={isRegenerating}
                style={{
                  padding: "8px 14px",
                  background: "#92400E",
                  color: "#FFF",
                  borderRadius: 8,
                  border: "none",
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: "0.04em",
                  cursor: isRegenerating ? "not-allowed" : "pointer",
                }}
              >
                {isRegenerating ? "Regenerating…" : "Force regenerate"}
              </button>
            </div>
          ) : null}

          {error && !conflict ? (
            <div
              style={{
                marginBottom: 20,
                padding: "12px 16px",
                borderRadius: 12,
                background: "#FEF2F2",
                border: "1px solid #FECACA",
                color: C.bear,
                fontSize: 12,
                display: "flex",
                gap: 12,
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
              }}
            >
              <span>
                {error?.message || "Something went wrong loading your DNA."}
              </span>
              <button
                type="button"
                onClick={() => refetch?.()}
                disabled={isLoading}
                style={{
                  padding: "6px 14px",
                  background: C.bear,
                  color: "#FFF",
                  borderRadius: 8,
                  border: "none",
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: "0.04em",
                  cursor: isLoading ? "not-allowed" : "pointer",
                }}
              >
                {isLoading ? "Retrying…" : "Retry"}
              </button>
            </div>
          ) : null}

          {isStale ? (
            <div
              style={{
                marginBottom: 20,
                padding: "12px 16px",
                borderRadius: 12,
                background: "#FFFBEB",
                border: "1px solid #FDE68A",
                color: "#92400E",
                fontSize: 12,
                lineHeight: 1.6,
                display: "flex",
                gap: 12,
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
              }}
            >
              <div>
                Your trades have changed since this report was generated.
                Regenerate to refresh the insights.
              </div>
              <button
                type="button"
                onClick={() => handleRegenerate({ force: true })}
                disabled={isRegenerating}
                style={{
                  padding: "8px 14px",
                  background: "#92400E",
                  color: "#FFF",
                  borderRadius: 8,
                  border: "none",
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: "0.04em",
                  cursor: isRegenerating ? "not-allowed" : "pointer",
                }}
              >
                {isRegenerating ? "Regenerating…" : "Refresh now"}
              </button>
            </div>
          ) : null}

          {showSkeleton ? (
            <ReportSkeleton />
          ) : isEmpty ? (
            <EmptyState
              onGenerate={() => handleRegenerate({ force: false })}
              isGenerating={isRegenerating}
            />
          ) : ai ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <IdentityHero
                identity={ai.identity}
                sample={bundle?.sample}
                generatedAt={report?.updatedAt || report?.createdAt}
              />

              {ai.coachSummary || ai.confidenceNote ? (
                <CoachSummaryCard
                  summary={ai.coachSummary}
                  confidenceNote={ai.confidenceNote}
                />
              ) : null}

              <StrengthsWeaknessesGrid
                strengths={ai.strengths}
                weaknesses={ai.weaknesses}
              />

              <BlindSpotsList items={ai.blindSpots} />
              <BehaviorPatternsCard items={ai.behaviorPatterns} />
              <ImprovementPrioritiesList items={ai.improvementPriorities} />

              <EvolutionChart data={bundle?.monthlyEvolution || []} />

              <QuarterlyCompareCard
                comparison={bundle?.quarterlyComparison}
                market={marketType}
              />
            </div>
          ) : null}

          {status === "regenerating" ? (
            <div
              style={{
                marginTop: 18,
                fontSize: 11,
                color: C.muted,
                textAlign: "center",
                letterSpacing: "0.06em",
              }}
            >
              Calling the model — this can take up to a minute.
            </div>
          ) : null}
        </main>
      </div>

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
