"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import CandlestickBackground from "@/features/shared/components/CandlestickBackground";
import TickerTape            from "@/features/shared/components/TickerTape";
import PageHeader            from "@/features/shared/components/PageHeader";
import TradeTable            from "@/features/trade/components/TradeTable";
import EmptyState            from "@/features/trade/components/EmptyState";
import DeleteModal           from "@/features/trade/components/DeleteModal";
import OnboardingCompleteDialog from "@/features/onboarding/components/OnboardingCompleteDialog";
import { useTrades }         from "@/features/trade/hooks/useTrades";
import { Skeleton }          from "@/features/shared";
import { markOnboardingStep } from "@/services/api";
import { useMarket, MARKETS } from "@/context/MarketContext";

const FILTER_OPTIONS = ["ALL", "LONG", "SHORT"];
const PERIOD_OPTIONS = [
  { value: "1w", label: "1W" },
  { value: "1m", label: "1M" },
  { value: "3m", label: "3M" },
  { value: "all", label: "ALL" },
];

function TradesContent() {
  const {
    filtered, loading, deleteTarget, deletingId, filter, search,
    period,
    summaryStats, mounted,
    handlers: { setFilter, setPeriod, setSearch, setDeleteTarget, confirmDelete, cancelDelete },
  } = useTrades();

  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentMarket, isLoading: marketLoading } = useMarket();
  const redirectQuery = searchParams?.toString();
  const onboardingMode = searchParams?.get("onboarding") === "1";
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

  return (
    <div style={{ minHeight: "100vh", background: "#F0EEE9", display: "flex", flexDirection: "column", fontFamily: "'Plus Jakarta Sans',sans-serif", color: "#0F1923", position: "relative" }}>
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <CandlestickBackground canvasId="trades-bg-canvas" />

      <div style={{ position: "relative", zIndex: 10, display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        <PageHeader showMarketSwitcher />
        <TickerTape />

        <main style={{ flex: 1, maxWidth: 1200, width: "100%", margin: "0 auto", padding: "28px 24px" }}>
          {onboardingMode && (
            <div style={{
              padding: "14px 16px", borderRadius: 12,
              background: "linear-gradient(135deg, rgba(34,199,142,0.1), rgba(13,158,110,0.04))",
              border: "1px solid rgba(34,199,142,0.3)",
              marginBottom: 18, display: "flex", alignItems: "flex-start", gap: 12,
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                background: "rgba(34,199,142,0.2)", color: "#0D9E6E",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 18, fontWeight: 900,
              }}>OK</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", color: "#0D9E6E", fontFamily: "'JetBrains Mono', monospace", marginBottom: 3 }}>
                  ACTIVATION COMPLETE - YOUR TRADE LOG
                </div>
                <div style={{ fontSize: 13, color: "#0F1923", fontWeight: 700, marginBottom: 2 }}>
                  Nice - you logged your first trade!
                </div>
                <div style={{ fontSize: 12, color: "#64748B", lineHeight: 1.55 }}>
                  This is your trade log - every trade lives here. Filter by setup, date, or result. The more you log, the smarter your coach gets.
                </div>
              </div>
            </div>
          )}

          {/* Page title */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 10, opacity: mounted ? 1 : 0, transform: mounted ? "translateY(0)" : "translateY(-10px)", transition: "all 0.5s" }}>
            <div>
              <h1 style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: 20, fontWeight: 800, color: "#0F1923", letterSpacing: "-0.02em", marginBottom: 3 }}>Trade Log</h1>
              <div style={{ fontSize: 11, color: "#94A3B8", fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.08em" }}>YOUR PERFORMANCE LOG</div>
            </div>
            <Link href="/upload-trade" style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "linear-gradient(135deg,#0D9E6E,#22C78E)", color: "#FFFFFF", padding: "10px 18px", minHeight: 44, borderRadius: 10, textDecoration: "none", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", boxShadow: "0 4px 12px rgba(13,158,110,0.3)", fontFamily: "'JetBrains Mono',monospace", whiteSpace: "nowrap" }}>
              + LOG TRADE
            </Link>
          </div>

          {/* Summary stats */}
          <div className="trades-stats-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginBottom: 18, opacity: mounted ? 1 : 0, transition: "all 0.5s 0.1s" }}>
            {summaryStats.map((s, i) => (
              <div key={s.label} style={{ background: "#FFFFFF", borderRadius: 10, border: "1px solid #E2E8F0", padding: "16px 18px", boxShadow: "0 2px 8px rgba(15,25,35,0.05)", animation: `fadeUp 0.4s ease ${i * 0.06}s both` }}>
                <div style={{ fontSize: 9, color: "#94A3B8", letterSpacing: "0.12em", fontFamily: "'JetBrains Mono',monospace", marginBottom: 6 }}>{s.label}</div>
                {loading ? (
                  <Skeleton width="80px" height="22px" style={{ marginTop: 2 }} />
                ) : (
                  <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: s.bull ? "#0D9E6E" : "#D63B3B" }}>{s.val}</div>
                )}
              </div>
            ))}
          </div>

          {/* Filters */}
          <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap", alignItems: "center", opacity: mounted ? 1 : 0, transition: "all 0.5s 0.15s" }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {FILTER_OPTIONS.map(f => (
                <button key={f} onClick={() => setFilter(f)} style={{ fontSize: 10, letterSpacing: "0.1em", fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, padding: "9px 14px", minHeight: 38, borderRadius: 20, border: filter === f ? "1.5px solid rgba(13,158,110,0.5)" : "1px solid #E2E8F0", background: filter === f ? "rgba(13,158,110,0.1)" : "#FFFFFF", color: filter === f ? "#0D9E6E" : "#94A3B8", cursor: "pointer", transition: "all 0.2s" }}>
                  {f}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {PERIOD_OPTIONS.map(option => (
                <button key={option.value} onClick={() => setPeriod(option.value)} style={{ fontSize: 10, letterSpacing: "0.1em", fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, padding: "9px 14px", minHeight: 38, borderRadius: 20, border: period === option.value ? "1.5px solid rgba(15,25,35,0.35)" : "1px solid #E2E8F0", background: period === option.value ? "#0F1923" : "#FFFFFF", color: period === option.value ? "#FFFFFF" : "#94A3B8", cursor: "pointer", transition: "all 0.2s" }}>
                  {option.label}
                </button>
              ))}
            </div>
            <input
              type="text" placeholder="Search pair or date..." value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ flex: 1, minWidth: 140, padding: "9px 14px", fontSize: 12, fontFamily: "'JetBrains Mono',monospace", border: "1px solid #E2E8F0", borderRadius: 8, outline: "none", background: "#FFFFFF", color: "#0F1923" }}
            />
          </div>

          {/* Table or empty state */}
          {filtered.length === 0 && !loading ? (
            <EmptyState />
          ) : (
            <TradeTable trades={filtered} loading={loading} onDelete={setDeleteTarget} deletingId={deletingId} />
          )}

          {/* Footer count */}
          {filtered.length > 0 && (
            <div style={{ padding: "14px 16px", display: "flex", justifyContent: "space-between", fontSize: 9, color: "#94A3B8", letterSpacing: "0.08em", fontFamily: "'JetBrains Mono',monospace", background: "#F8F6F2", borderRadius: "0 0 14px 14px", marginTop: -1, border: "1px solid #E2E8F0", borderTop: "none" }}>
              <span>SHOWING {filtered.length} TRADES</span>
              <span>{period.toUpperCase()} WINDOW</span>
              <span>EDGECIPLINE AI COACH</span>
            </div>
          )}
        </main>
      </div>

      {/* Delete modal */}
      {deleteTarget && (
        <DeleteModal trade={deleteTarget} onConfirm={confirmDelete} onCancel={cancelDelete} />
      )}
      {showOnboardingComplete && (
        <OnboardingCompleteDialog
          onClose={() => setCompletionDismissed(true)}
          onDashboard={() => router.replace("/dashboard?onboarded=1")}
        />
      )}

      <style>{`
        @keyframes blink   { 0%,100%{opacity:1} 50%{opacity:0.2} }
        @keyframes spin    { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes ticker  { 0%{transform:translateX(0)} 100%{transform:translateX(-50%)} }
        @keyframes fadeUp  { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
        input::placeholder { color:#94A3B8; font-size:11px; }
        * { box-sizing:border-box; margin:0; padding:0; }
        .hidden-mobile { display:block; }
        .show-mobile   { display:none; }
        @media (max-width:640px) {
          .hidden-mobile { display:none !important; }
          .show-mobile   { display:block !important; }
          main { padding:16px 12px !important; }
          .trades-stats-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
        @media (max-width:360px) {
          .trades-stats-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

export default function TradesPage() {
  return <Suspense><TradesContent /></Suspense>;
}
