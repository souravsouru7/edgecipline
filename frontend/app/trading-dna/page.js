"use client";

import { Suspense } from "react";
import Link from "next/link";
import ErrorBoundary from "@/components/ErrorBoundary";
import CandlestickBackground from "@/features/shared/components/CandlestickBackground";
import TickerTape            from "@/features/shared/components/TickerTape";
import PageHeader            from "@/features/shared/components/PageHeader";
import { useQuery }          from "@tanstack/react-query";
import { getTradingDNA }     from "@/services/analyticsApi";
import { hasValidAuthToken } from "@/utils/auth";
import { useRouter }         from "next/navigation";
import { useEffect, useState } from "react";

const C = { bull: "#0D9E6E", bear: "#D63B3B", gold: "#B8860B", purple: "#8B5CF6", blue: "#3B82F6", primary: "#0F1923", muted: "#94A3B8" };

// ── helpers ────────────────────────────────────────────────────────────────────

const fmtP = (n) => {
  const v = parseFloat(n || 0);
  return `${v >= 0 ? "+" : "-"}$${Math.abs(v).toFixed(2)}`;
};

function ConfBadge({ c }) {
  if (!c) return null;
  const map = {
    High:   { bg: "#0D9E6E18", fc: "#0D9E6E" },
    Medium: { bg: "#F59E0B18", fc: "#B8860B" },
    Low:    { bg: "#E2E8F0",   fc: "#64748B" },
  };
  const { bg, fc } = map[c] || map.Low;
  return (
    <span style={{ fontSize: 8, fontWeight: 800, color: fc, background: bg, borderRadius: 4, padding: "1px 6px", letterSpacing: "0.06em", marginLeft: 5 }}>
      {c.toUpperCase()}
    </span>
  );
}

function SectionTitle({ children }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 800, color: "#64748B", letterSpacing: "0.1em", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 1, background: "#E2E8F0" }} />
      {children}
      <div style={{ flex: 1, height: 1, background: "#E2E8F0" }} />
    </div>
  );
}

function DNACard({ label, value, sub, color, conf, wide = false }) {
  return (
    <div style={{
      padding: "12px 14px",
      borderRadius: 12,
      background: `${color}06`,
      border: `1px solid ${color}22`,
      gridColumn: wide ? "span 2" : "span 1",
    }}>
      <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, marginBottom: 4, display: "flex", alignItems: "center" }}>
        {label}<ConfBadge c={conf} />
      </div>
      <div style={{ fontSize: 14, fontWeight: 800, color: C.primary, marginBottom: 3 }}>{value}</div>
      <div style={{ fontSize: 11, fontWeight: 700, color, fontFamily: "'JetBrains Mono',monospace" }}>{sub}</div>
    </div>
  );
}

function PatternCard({ title, data, color, titleColor, bg, border }) {
  if (!data) return null;
  return (
    <div style={{ padding: "14px 16px", borderRadius: 12, background: bg, border: `1px solid ${border}` }}>
      <div style={{ fontSize: 9, fontWeight: 800, color: titleColor, marginBottom: 8, letterSpacing: "0.06em" }}>{title}</div>
      <div style={{ fontSize: 13, fontWeight: 800, color: C.primary, marginBottom: 6 }}>{data.conditionLabel}</div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 10, color: "#374151" }}>{data.trades} trades</div>
        <div style={{ fontSize: 10, fontWeight: 700, color: data.winRate >= 50 ? C.bull : C.bear }}>{data.winRate}% WR</div>
        <div style={{ fontSize: 11, fontWeight: 800, color, fontFamily: "'JetBrains Mono',monospace" }}>{fmtP(data.netPnL)}</div>
      </div>
    </div>
  );
}

function RuleBar({ rule }) {
  const followed = rule.followRate;
  const color = followed >= 70 ? C.bull : followed >= 50 ? C.gold : C.bear;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: C.primary }}>{rule.name}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color, fontFamily: "'JetBrains Mono',monospace" }}>
          {rule.followedCount}/{rule.total} ({followed}%)
        </span>
      </div>
      <div style={{ height: 5, background: "#F1F5F9", borderRadius: 99 }}>
        <div style={{ height: "100%", width: `${followed}%`, background: color, borderRadius: 99, transition: "width 0.5s" }} />
      </div>
    </div>
  );
}

function EmotionRow({ tag, winRate, trades, netPnL, conf }) {
  const wr = parseFloat(winRate || 0);
  const pnl = parseFloat(netPnL || 0);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #F4F2EE" }}>
      <div style={{ flex: 1, fontSize: 12, fontWeight: 700, color: C.primary }}>
        {tag}<ConfBadge c={conf} />
      </div>
      <div style={{ fontSize: 10, color: C.muted }}>{trades}t</div>
      <div style={{ fontSize: 11, fontWeight: 700, color: wr >= 50 ? C.bull : C.bear, width: 45, textAlign: "right" }}>{wr}%</div>
      <div style={{ fontSize: 11, fontWeight: 800, color: pnl >= 0 ? C.bull : C.bear, fontFamily: "'JetBrains Mono',monospace", width: 80, textAlign: "right" }}>{fmtP(pnl)}</div>
    </div>
  );
}

// ── Skeleton ───────────────────────────────────────────────────────────────────

function LoadingSkeleton() {
  const skRow = (w = "100%", h = 16) => (
    <div style={{ width: w, height: h, borderRadius: 6, background: "linear-gradient(90deg,#F1F5F9 25%,#E2E8F0 50%,#F1F5F9 75%)", backgroundSize: "200% 100%", animation: "shimmer 1.5s infinite", marginBottom: 10 }} />
  );
  return (
    <div style={{ padding: "28px 24px" }}>
      {skRow("60%", 24)}{skRow("40%")}{skRow()}{skRow()}{skRow("80%")}
      <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function TradingDNAContent() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (!hasValidAuthToken()) { router.replace("/login"); return; }
    setMounted(true);
  }, [router]);

  const { data: dna, isLoading } = useQuery({
    queryKey: ["tradingDNA", "full"],
    queryFn: () => getTradingDNA("Forex", ""),
    staleTime: 10 * 60 * 1000,
    enabled: mounted,
  });

  return (
    <div style={{
      minHeight: "100vh",
      background: "#F4F2EE",
      fontFamily: "'Plus Jakarta Sans',sans-serif",
      color: C.primary,
      position: "relative",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <CandlestickBackground canvasId="dna-bg-canvas" />

      <div style={{ position: "relative", zIndex: 10, display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        <PageHeader />
        <TickerTape />

        <main style={{ flex: 1, maxWidth: 900, width: "100%", margin: "0 auto", padding: "28px 20px", boxSizing: "border-box" }}>

          {/* ── Header ─────────────────────────────────────────────── */}
          <div style={{ marginBottom: 28 }}>
            <Link href="/analytics" style={{ fontSize: 11, color: C.muted, textDecoration: "none", display: "flex", alignItems: "center", gap: 4, marginBottom: 10 }}>
              ← Back to Analytics
            </Link>
            <h1 style={{ fontSize: 22, fontWeight: 900, color: C.primary, letterSpacing: "-0.03em", margin: 0, marginBottom: 4 }}>
              Trading DNA
            </h1>
            <p style={{ fontSize: 12, color: C.muted, fontFamily: "'JetBrains Mono',monospace", margin: 0, letterSpacing: "0.04em" }}>
              YOUR BEHAVIORAL FINGERPRINT — BACKED BY REAL TRADE DATA
            </p>
          </div>

          {!mounted || isLoading ? <LoadingSkeleton /> : !dna || dna.insufficient ? (
            <div style={{ textAlign: "center", padding: "60px 24px", background: "#FFF", borderRadius: 16, border: "1px solid #E2E8F0" }}>
              <div style={{ fontSize: 32, marginBottom: 16 }}>🧬</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: C.primary, marginBottom: 8 }}>Not Enough Data Yet</div>
              <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.7, maxWidth: 320, margin: "0 auto", marginBottom: 20 }}>
                You need at least 5 trades to generate your Trading DNA. Log more trades and your behavioral fingerprint will appear here.
              </div>
              <div style={{ fontSize: 11, color: C.muted }}>
                Current trades: <strong>{dna?.totalTrades ?? 0}</strong> · Minimum required: <strong>5</strong>
              </div>
              <Link href="/upload-trade" style={{ display: "inline-block", marginTop: 20, padding: "10px 24px", background: C.purple, color: "#FFF", borderRadius: 10, fontWeight: 700, fontSize: 12, textDecoration: "none" }}>
                Log a Trade
              </Link>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

              {/* ── Module 7: Identity Card ─────────────────────── */}
              <div style={{ background: "#0F1923", borderRadius: 16, padding: "24px 26px", color: "#F8FAFC" }}>
                <div style={{ fontSize: 9, fontWeight: 800, color: "#8B5CF6", letterSpacing: "0.12em", marginBottom: 8 }}>YOUR TRADING IDENTITY</div>
                <div style={{ fontSize: 14, lineHeight: 1.8, color: "#E2E8F0", marginBottom: 16 }}>
                  {dna.dnaSummary?.tradingIdentity || "Continue logging trades to generate your trading identity narrative."}
                </div>
                <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                  {dna.dnaSummary?.keyStrengths?.length > 0 && (
                    <div>
                      <div style={{ fontSize: 9, color: C.bull, fontWeight: 800, marginBottom: 6, letterSpacing: "0.08em" }}>KEY STRENGTHS</div>
                      {dna.dnaSummary.keyStrengths.map((s, i) => (
                        <div key={i} style={{ fontSize: 11, color: "#BBF7D0", display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
                          <span style={{ color: C.bull }}>✓</span> {s}
                        </div>
                      ))}
                    </div>
                  )}
                  {dna.dnaSummary?.keyWeaknesses?.length > 0 && (
                    <div>
                      <div style={{ fontSize: 9, color: C.bear, fontWeight: 800, marginBottom: 6, letterSpacing: "0.08em" }}>KEY WEAKNESSES</div>
                      {dna.dnaSummary.keyWeaknesses.map((w, i) => (
                        <div key={i} style={{ fontSize: 11, color: "#FED7D7", display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
                          <span style={{ color: C.bear }}>✗</span> {w}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ marginTop: 14, fontSize: 10, color: "#64748B" }}>
                  Based on {dna.totalTrades} trades · Confidence:&nbsp;
                  <ConfBadge c={dna.dnaSummary?.dataConfidence} />
                </div>
              </div>

              {/* ── Module 1/2: Market DNA ─────────────────────── */}
              <div style={{ background: "#FFF", borderRadius: 14, border: "1px solid #E2E8F0", padding: "20px 22px" }}>
                <SectionTitle>{dna.marketType === "Indian_Market" ? "INSTRUMENT & STYLE DNA" : "SESSION & PAIR DNA"}</SectionTitle>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10 }}>
                  {dna.sessionDNA?.best && <DNACard label="Best Session" value={dna.sessionDNA.best.name} sub={`${dna.sessionDNA.best.winRate}% WR · ${fmtP(dna.sessionDNA.best.netPnL)}`} color={C.bull} conf={dna.sessionDNA.best.confidence} />}
                  {dna.sessionDNA?.worst && <DNACard label="Worst Session" value={dna.sessionDNA.worst.name} sub={`${dna.sessionDNA.worst.winRate}% WR · ${fmtP(dna.sessionDNA.worst.netPnL)}`} color={C.bear} conf={dna.sessionDNA.worst.confidence} />}
                  {dna.instrumentDNA?.best && <DNACard label={dna.marketType === "Indian_Market" ? "Best Instrument" : "Best Pair"} value={dna.instrumentDNA.best.name} sub={`${dna.instrumentDNA.best.winRate}% WR · ${fmtP(dna.instrumentDNA.best.netPnL)}`} color={C.bull} conf={dna.instrumentDNA.best.confidence} />}
                  {dna.instrumentDNA?.worst && <DNACard label={dna.marketType === "Indian_Market" ? "Worst Instrument" : "Worst Pair"} value={dna.instrumentDNA.worst.name} sub={`${dna.instrumentDNA.worst.winRate}% WR · ${fmtP(dna.instrumentDNA.worst.netPnL)}`} color={C.bear} conf={dna.instrumentDNA.worst.confidence} />}
                  {dna.styleDNA?.best && <DNACard label="Best Style" value={dna.styleDNA.best.name} sub={`${dna.styleDNA.best.winRate}% WR · ${fmtP(dna.styleDNA.best.netPnL)}`} color={C.bull} conf={dna.styleDNA.best.confidence} />}
                  {dna.styleDNA?.worst && <DNACard label="Worst Style" value={dna.styleDNA.worst.name} sub={`${dna.styleDNA.worst.winRate}% WR · ${fmtP(dna.styleDNA.worst.netPnL)}`} color={C.bear} conf={dna.styleDNA.worst.confidence} />}
                </div>

                {/* All sessions / pairs table */}
                {dna.sessionDNA?.all?.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: "0.06em", marginBottom: 8 }}>ALL SESSIONS</div>
                    {dna.sessionDNA.all.map((s) => (
                      <EmotionRow key={s.name} tag={s.name} winRate={s.winRate} trades={s.trades} netPnL={s.netPnL} conf={s.confidence} />
                    ))}
                  </div>
                )}
                {dna.instrumentDNA?.all?.length > 1 && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: "0.06em", marginBottom: 8 }}>{dna.marketType === "Indian_Market" ? "ALL INSTRUMENTS" : "ALL PAIRS"}</div>
                    {dna.instrumentDNA.all.map((p) => (
                      <EmotionRow key={p.name} tag={p.name} winRate={p.winRate} trades={p.trades} netPnL={p.netPnL} conf={p.confidence} />
                    ))}
                  </div>
                )}
              </div>

              {/* ── Day DNA ─────────────────────────────────────── */}
              {dna.dayDNA?.all?.length > 0 && (
                <div style={{ background: "#FFF", borderRadius: 14, border: "1px solid #E2E8F0", padding: "20px 22px" }}>
                  <SectionTitle>DAY OF WEEK DNA</SectionTitle>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginBottom: 16 }}>
                    {dna.dayDNA?.best && <DNACard label="Best Day" value={dna.dayDNA.best.name} sub={`${dna.dayDNA.best.winRate}% WR · ${fmtP(dna.dayDNA.best.netPnL)}`} color={C.bull} conf={dna.dayDNA.best.confidence} />}
                    {dna.dayDNA?.worst && <DNACard label="Worst Day" value={dna.dayDNA.worst.name} sub={`${dna.dayDNA.worst.winRate}% WR · ${fmtP(dna.dayDNA.worst.netPnL)}`} color={C.bear} conf={dna.dayDNA.worst.confidence} />}
                  </div>
                  {dna.dayDNA.all.map((d) => (
                    <div key={d.name} style={{ marginBottom: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: C.primary }}>{d.name}</span>
                        <div style={{ display: "flex", gap: 12 }}>
                          <span style={{ fontSize: 10, color: C.muted, fontFamily: "'JetBrains Mono',monospace" }}>{d.trades}t</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: d.winRate >= 50 ? C.bull : C.bear }}>{d.winRate}%</span>
                          <span style={{ fontSize: 11, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: d.netPnL >= 0 ? C.bull : C.bear }}>{fmtP(d.netPnL)}</span>
                        </div>
                      </div>
                      <div style={{ height: 5, background: "#F1F5F9", borderRadius: 99 }}>
                        <div style={{ height: "100%", width: `${Math.min(100, d.winRate)}%`, background: d.netPnL >= 0 ? C.bull : C.bear, borderRadius: 99, transition: "width 0.4s" }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Module 3: Psychology DNA ─────────────────────── */}
              <div style={{ background: "#FFF", borderRadius: 14, border: "1px solid #E2E8F0", padding: "20px 22px" }}>
                <SectionTitle>PSYCHOLOGY DNA</SectionTitle>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginBottom: 20 }}>
                  {dna.moodDNA?.best && <DNACard label="Best Mood" value={dna.moodDNA.best.name} sub={`${dna.moodDNA.best.winRate}% WR · ${fmtP(dna.moodDNA.best.netPnL)}`} color={C.bull} conf={dna.moodDNA.best.confidence} />}
                  {dna.moodDNA?.worst && <DNACard label="Worst Mood" value={dna.moodDNA.worst.name} sub={`${dna.moodDNA.worst.winRate}% WR · ${fmtP(dna.moodDNA.worst.netPnL)}`} color={C.bear} conf={dna.moodDNA.worst.confidence} />}
                  {dna.confidenceDNA?.best && <DNACard label="Best Confidence" value={dna.confidenceDNA.best.name} sub={`${dna.confidenceDNA.best.winRate}% WR · ${fmtP(dna.confidenceDNA.best.netPnL)}`} color={C.bull} conf={dna.confidenceDNA.best.confidence} />}
                  {dna.confidenceDNA?.worst && <DNACard label="Worst Confidence" value={dna.confidenceDNA.worst.name} sub={`${dna.confidenceDNA.worst.winRate}% WR · ${fmtP(dna.confidenceDNA.worst.netPnL)}`} color={C.bear} conf={dna.confidenceDNA.worst.confidence} />}
                  {dna.emotionDNA?.mostProfitable && <DNACard label="Most Profitable Emotion" value={dna.emotionDNA.mostProfitable.name} sub={`${dna.emotionDNA.mostProfitable.winRate}% WR · ${fmtP(dna.emotionDNA.mostProfitable.netPnL)}`} color={C.bull} conf={dna.emotionDNA.mostProfitable.confidence} />}
                  {dna.emotionDNA?.mostExpensive && <DNACard label="Most Expensive Emotion" value={dna.emotionDNA.mostExpensive.name} sub={`${dna.emotionDNA.mostExpensive.winRate}% WR · ${fmtP(dna.emotionDNA.mostExpensive.netPnL)}`} color={C.bear} conf={dna.emotionDNA.mostExpensive.confidence} />}
                  {dna.mistakeDNA?.mostExpensive && <DNACard label="Costliest Mistake" value={dna.mistakeDNA.mostExpensive.name} sub={`${dna.mistakeDNA.mostExpensive.trades}× · ${fmtP(dna.mistakeDNA.mostExpensive.netPnL)}`} color={C.bear} conf={dna.mistakeDNA.mostExpensive.confidence} />}
                </div>

                {/* Emotion breakdown table */}
                {dna.emotionDNA?.all?.length > 0 && (
                  <>
                    <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: "0.06em", marginBottom: 8 }}>EMOTION BREAKDOWN</div>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 20, marginBottom: 4 }}>
                      <span style={{ fontSize: 9, color: C.muted, fontFamily: "'JetBrains Mono',monospace" }}>TRADES</span>
                      <span style={{ fontSize: 9, color: C.muted, fontFamily: "'JetBrains Mono',monospace", width: 45, textAlign: "right" }}>WIN%</span>
                      <span style={{ fontSize: 9, color: C.muted, fontFamily: "'JetBrains Mono',monospace", width: 80, textAlign: "right" }}>NET P&L</span>
                    </div>
                    {dna.emotionDNA.all.map((e) => (
                      <EmotionRow key={e.name} tag={e.name} winRate={e.winRate} trades={e.trades} netPnL={e.netPnL} conf={e.confidence} />
                    ))}
                  </>
                )}

                {/* Mistake breakdown */}
                {dna.mistakeDNA?.all?.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: "0.06em", marginBottom: 8 }}>MISTAKE BREAKDOWN</div>
                    {dna.mistakeDNA.all.map((m) => (
                      <EmotionRow key={m.name} tag={m.name} winRate={m.winRate} trades={m.trades} netPnL={m.netPnL} conf={m.confidence} />
                    ))}
                  </div>
                )}
              </div>

              {/* ── Module 4: Discipline DNA ─────────────────────── */}
              {(dna.disciplineDNA?.allRules?.length > 0 || dna.disciplineDNA?.bestSetupRange) && (
                <div style={{ background: "#FFF", borderRadius: 14, border: "1px solid #E2E8F0", padding: "20px 22px" }}>
                  <SectionTitle>DISCIPLINE DNA</SectionTitle>

                  {/* Summary metrics */}
                  <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
                    {dna.disciplineDNA.avgSetupScore != null && (
                      <div style={{ flex: 1, minWidth: 100, padding: "12px 14px", borderRadius: 10, background: "#F8FAFC", border: "1px solid #E2E8F0", textAlign: "center" }}>
                        <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, marginBottom: 4 }}>AVG SETUP SCORE</div>
                        <div style={{ fontSize: 24, fontWeight: 900, color: dna.disciplineDNA.avgSetupScore >= 70 ? C.bull : dna.disciplineDNA.avgSetupScore >= 50 ? C.gold : C.bear, fontFamily: "'JetBrains Mono',monospace" }}>{dna.disciplineDNA.avgSetupScore}%</div>
                      </div>
                    )}
                    {dna.disciplineDNA.avgDisciplineScore != null && (
                      <div style={{ flex: 1, minWidth: 100, padding: "12px 14px", borderRadius: 10, background: "#F8FAFC", border: "1px solid #E2E8F0", textAlign: "center" }}>
                        <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, marginBottom: 4 }}>AVG RULE DISCIPLINE</div>
                        <div style={{ fontSize: 24, fontWeight: 900, color: dna.disciplineDNA.avgDisciplineScore >= 70 ? C.bull : dna.disciplineDNA.avgDisciplineScore >= 50 ? C.gold : C.bear, fontFamily: "'JetBrains Mono',monospace" }}>{dna.disciplineDNA.avgDisciplineScore}%</div>
                      </div>
                    )}
                  </div>

                  {/* Setup score ranges */}
                  {dna.disciplineDNA.allSetupRanges?.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: "0.06em", marginBottom: 8 }}>SETUP SCORE RANGES</div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8 }}>
                        {dna.disciplineDNA.allSetupRanges.map((r) => (
                          <DNACard key={r.name} label={r.name} value={`${r.winRate}% WR`} sub={`${r.trades}t · ${fmtP(r.netPnL)}`} color={r.netPnL >= 0 ? C.bull : C.bear} conf={r.confidence} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Rule adherence bars */}
                  {dna.disciplineDNA.allRules?.length > 0 && (
                    <>
                      <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: "0.06em", marginBottom: 8 }}>RULE ADHERENCE</div>
                      {[...dna.disciplineDNA.allRules]
                        .sort((a, b) => b.followRate - a.followRate)
                        .map((r) => <RuleBar key={r.name} rule={r} />)}
                    </>
                  )}
                </div>
              )}

              {/* ── Module 5: Self-Awareness DNA ─────────────────── */}
              {dna.selfAwarenessDNA && (
                <div style={{ background: "#FFF", borderRadius: 14, border: "1px solid #E2E8F0", padding: "20px 22px" }}>
                  <SectionTitle>SELF-AWARENESS DNA</SectionTitle>
                  <div style={{ display: "flex", gap: 20, alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap" }}>
                    {dna.selfAwarenessDNA.score != null && (
                      <div style={{ textAlign: "center", minWidth: 80 }}>
                        <div style={{ fontSize: 40, fontWeight: 900, fontFamily: "'JetBrains Mono',monospace", color: dna.selfAwarenessDNA.score >= 70 ? C.bull : dna.selfAwarenessDNA.score >= 40 ? C.gold : C.bear, lineHeight: 1 }}>{dna.selfAwarenessDNA.score}%</div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, marginTop: 4 }}>{dna.selfAwarenessDNA.profile}</div>
                        <ConfBadge c={dna.selfAwarenessDNA.confidence} />
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 160 }}>
                      {dna.selfAwarenessDNA.bestJudgedCategory && (
                        <div style={{ fontSize: 12, color: C.bull, marginBottom: 6, display: "flex", gap: 6, alignItems: "center" }}>
                          <span>✓</span> Best at judging <strong>{dna.selfAwarenessDNA.bestJudgedCategory}</strong> trades
                        </div>
                      )}
                      {dna.selfAwarenessDNA.worstJudgedCategory && (
                        <div style={{ fontSize: 12, color: C.bear, marginBottom: 6, display: "flex", gap: 6, alignItems: "center" }}>
                          <span>✗</span> Hardest to judge: <strong>{dna.selfAwarenessDNA.worstJudgedCategory}</strong> trades
                        </div>
                      )}
                      <div style={{ fontSize: 11, color: C.muted }}>Based on {dna.selfAwarenessDNA.trackedCount} evaluated trades</div>
                    </div>
                  </div>

                  {dna.selfAwarenessDNA.biases?.length > 0 && (
                    <div>
                      <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: "0.06em", marginBottom: 8 }}>DETECTED BIASES</div>
                      {dna.selfAwarenessDNA.biases.map((b, i) => (
                        <div key={i} style={{ padding: "10px 14px", borderRadius: 10, background: "#FFF8F8", border: "1px solid #FED7D7", marginBottom: 8 }}>
                          <div style={{ fontSize: 10, fontWeight: 800, color: "#9B1C1C", marginBottom: 4 }}>{b.type}</div>
                          <div style={{ fontSize: 11, color: "#374151", lineHeight: 1.6 }}>{b.description}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Module 6: Behavioral Pattern DNA ─────────────── */}
              {(dna.behavioralDNA?.winningPattern || dna.behavioralDNA?.losingPattern || dna.behavioralDNA?.mostProfitableCombination || dna.behavioralDNA?.mostDangerousCombination) && (
                <div style={{ background: "#FFF", borderRadius: 14, border: "1px solid #E2E8F0", padding: "20px 22px" }}>
                  <SectionTitle>BEHAVIORAL PATTERN DNA</SectionTitle>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
                    <PatternCard title="WINNING PATTERN" data={dna.behavioralDNA.winningPattern} color={C.bull} titleColor="#166534" bg="#F0FDF4" border="#BBF7D0" />
                    <PatternCard title="LOSING PATTERN" data={dna.behavioralDNA.losingPattern} color={C.bear} titleColor="#9B1C1C" bg="#FFF8F8" border="#FED7D7" />
                    <PatternCard title="MOST PROFITABLE COMBINATION" data={dna.behavioralDNA.mostProfitableCombination} color={C.bull} titleColor="#1E40AF" bg="#F0F7FF" border="#BFDBFE" />
                    <PatternCard title="MOST DANGEROUS COMBINATION" data={dna.behavioralDNA.mostDangerousCombination} color={C.bear} titleColor="#92400E" bg="#FFFBEB" border="#FDE68A" />
                  </div>
                </div>
              )}

              {/* ── Data note ─────────────────────────────────────── */}
              <div style={{ padding: "14px 18px", borderRadius: 12, background: "#F8FAFC", border: "1px solid #E2E8F0", fontSize: 11, color: C.muted, lineHeight: 1.7 }}>
                <strong style={{ color: "#475569" }}>Data confidence:</strong> Each insight shows a confidence badge (High/Medium/Low) based on sample size.
                Insights with fewer than 5 trades in a dimension are not shown. For most reliable DNA, aim for 30+ trades per dimension.
              </div>

            </div>
          )}

        </main>
      </div>
    </div>
  );
}

export default function TradingDNAPage() {
  return (
    <ErrorBoundary fallback={<div style={{ padding: "2rem", textAlign: "center" }}>Trading DNA failed to load. Please refresh.</div>}>
      <Suspense><TradingDNAContent /></Suspense>
    </ErrorBoundary>
  );
}
