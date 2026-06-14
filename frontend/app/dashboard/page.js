"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import ErrorBoundary from "@/components/ErrorBoundary";
import { CheckSquare, FileText, Camera, Plus, Sparkles } from "lucide-react";
import CandlestickBackground from "@/features/shared/components/CandlestickBackground";
import TickerTape            from "@/features/shared/components/TickerTape";
import PageHeader            from "@/features/shared/components/PageHeader";
import { useClock }          from "@/features/shared/hooks/useClock";
import StatCard              from "@/features/dashboard/components/StatCard";
import EquityCurve           from "@/features/dashboard/components/EquityCurve";
import CreateTradeButton     from "@/features/dashboard/components/CreateTradeButton";
import OnboardingTour        from "@/features/dashboard/components/OnboardingTour";
import { useDashboard }      from "@/features/dashboard/hooks/useDashboard";
import { Skeleton }          from "@/features/shared";

// ── Build KPI cards from API response ─────────────────────────────────────────
function DashboardPanel({ title, subtitle, children, action, accent = "#0D9E6E" }) {
  return (
    <section style={{ background: "#FFFFFF", borderRadius: 14, border: "1px solid #E2E8F0", boxShadow: "0 2px 12px rgba(15,25,35,0.04)", overflow: "hidden" }}>
      <div style={{ height: 3, background: `linear-gradient(90deg, ${accent}, transparent)` }} />
      <div style={{ padding: "16px 20px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#0F1923" }}>{title}</div>
            {subtitle && <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 3 }}>{subtitle}</div>}
          </div>
          {action}
        </div>
        {children}
      </div>
    </section>
  );
}

function InsightItem({ label, value, tone = "#0D9E6E" }) {
  return (
    <div style={{ padding: "10px 12px", borderRadius: 10, background: `${tone}08`, border: `1px solid ${tone}22` }}>
      <div style={{ fontSize: 9, fontWeight: 900, color: tone, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 12, color: "#334155", lineHeight: 1.55, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function QuickAction({ href, icon: Icon, label, sub, accent = "#0D9E6E" }) {
  return (
    <Link href={href} className="quick-action" style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 70, padding: "12px 14px", borderRadius: 12, border: "1px solid #E2E8F0", background: "#FFFFFF", color: "#0F1923", textDecoration: "none" }}>
      <div style={{ width: 36, height: 36, borderRadius: 10, background: `${accent}12`, color: accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Icon size={18} />
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 900, marginBottom: 3 }}>{label}</div>
        <div style={{ fontSize: 10, color: "#94A3B8", lineHeight: 1.35 }}>{sub}</div>
      </div>
    </Link>
  );
}

function greetingFor(hour) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function firstName(full) {
  if (!full) return "";
  return String(full).trim().split(/\s+/)[0];
}

function buildStats(s) {
  const total   = s?.totalTrades   ?? 0;
  const winRate = s?.winRate       ?? 0;
  const netPnl  = s?.netPnL       ?? s?.totalProfit ?? 0;
  const streak  = s?.currentStreak ?? 0;

  return [
    {
      label: "Total Trades",
      value: total,
      sub: "trades logged",
      accentColor: "#0D9E6E",
      tooltip: "Total number of trades you've logged. More trades unlock better analytics, AI insights, and pattern detection.",
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
      ),
    },
    {
      label: "Win Rate",
      value: `${winRate}%`,
      sub: "of trades profitable",
      accentColor: winRate >= 50 ? "#0D9E6E" : "#D63B3B",
      tooltip: "Percentage of your trades that closed in profit. Above 50% is green. Win rate alone doesn't guarantee profitability — your risk-reward matters equally.",
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      ),
    },
    {
      label: "Net P&L",
      value: `${netPnl >= 0 ? "+" : "-"}$${Math.abs(Number(netPnl)).toFixed(2)}`,
      sub: "total return",
      accentColor: netPnl >= 0 ? "#0D9E6E" : "#D63B3B",
      tooltip: "Your total profit or loss across all logged trades. Green = net profitable, red = net loss. This is your real bottom line.",
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="12" y1="1" x2="12" y2="23"/>
          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
        </svg>
      ),
    },
    {
      label: "Win Streak",
      value: streak,
      sub: "consecutive wins",
      accentColor: "#B8860B",
      tooltip: "Your current consecutive winning streak. Resets to zero on the next loss. Use it as context — not as a reason to increase your position size.",
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
      ),
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────

function DashboardContent() {
  const { stats, mounted, loading, showWelcome, closeWelcome: finishTour, selfAwareness, psychologyCost, tradingDNA, profile } = useDashboard();
  const clock     = useClock();
  const statCards = buildStats(stats);
  const netPnl    = stats?.netPnL ?? stats?.totalProfit ?? 0;
  // Show skeletons while auth is resolving OR while data is loading.
  // Never show a full-page spinner — render the shell immediately.
  const showSkeleton = !mounted || loading;
  const money = (n) => {
    const v = parseFloat(n || 0);
    return `${v >= 0 ? "+" : "-"}$${Math.abs(v).toFixed(2)}`;
  };
  const dnaStrength =
    tradingDNA?.sessionDNA?.best?.name ||
    tradingDNA?.instrumentDNA?.best?.name ||
    tradingDNA?.emotionDNA?.mostProfitable?.name ||
    "Log more trades to reveal your strongest repeatable condition.";
  const topLeak = psychologyCost?.topLeaks?.[0] || psychologyCost?.costliestMistake || psychologyCost?.costliestEmotion;
  const biggestLeak = topLeak
    ? `${topLeak.name || topLeak.type} (${money(topLeak.cost ?? topLeak.netPnL ?? topLeak.profit)})`
    : "No dominant behavioral leak detected yet.";
  const selfAwarenessFocus = selfAwareness?.score != null
    ? `${selfAwareness.score}% calibration. ${selfAwareness.score >= 70 ? "Protect review quality before increasing risk." : "Improve post-trade review accuracy next."}`
    : "Add trade-quality reviews to unlock self-awareness focus.";
  const aiRecommendation = topLeak
    ? `Before the next trade, add one guardrail for ${topLeak.name || topLeak.type}.`
    : tradingDNA?.dnaSummary?.tradingIdentity || "Run the checklist before your next trade and keep the sample clean.";
  const coachInsight = topLeak
    ? `${topLeak.name || topLeak.type} is the clearest coaching priority because it is showing direct P&L impact.`
    : selfAwareness?.score != null
      ? "Your next coaching priority is tightening the gap between trade quality and outcome review."
      : "Edgecipline will show a stronger coaching snapshot once more psychology and setup data is logged.";

  return (
    <div style={{
      minHeight: "100vh",
      background: "#F4F2EE",
      display: "flex",
      flexDirection: "column",
      fontFamily: "'Plus Jakarta Sans',sans-serif",
      color: "#0F1923",
      position: "relative",
    }}>
      {mounted && <CandlestickBackground canvasId="dash-bg-canvas" />}

      <div style={{ position: "relative", zIndex: 10, display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        <PageHeader showMarketSwitcher showClock clock={clock} />
        <TickerTape />

        <main style={{
          flex: 1,
          maxWidth: 1200, width: "100%",
          margin: "0 auto",
          padding: "28px 24px",
          boxSizing: "border-box",
        }}>

          {/* ── Greeting hero ─────────────────────────────────────── */}
          <div style={{
            display: "flex", alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 24, flexWrap: "wrap", gap: 12,
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{
                fontSize: 11, fontWeight: 700, color: "#94A3B8",
                fontFamily: "'JetBrains Mono',monospace",
                letterSpacing: "0.12em", textTransform: "uppercase",
                marginBottom: 6,
              }}>
                {new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
              </div>
              <h1 style={{
                fontSize: 26, fontWeight: 800, color: "#0F1923",
                letterSpacing: "-0.025em", margin: 0, lineHeight: 1.15,
              }}>
                {greetingFor(new Date().getHours())}
                {profile?.name ? <span style={{ color: "#0D9E6E" }}>, {firstName(profile.name)}</span> : ""}
              </h1>
              <p style={{
                fontSize: 13, color: "#64748B",
                margin: "6px 0 0",
              }}>
                Here's your edge today.
              </p>
            </div>
            <div id="tour-create-trade">
              <CreateTradeButton />
            </div>
          </div>

          {/* ── KPI stat cards ───────────────────────────────────── */}
          <div id="tour-kpi-grid" className="dash-kpi-grid" style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 14, marginBottom: 20,
          }}>
            {statCards.map((s, i) => (
              <StatCard key={s.label} {...s} loading={loading} delay={i * 0.07} />
            ))}
          </div>

          {/* ── Equity curve (full width) ────────────────────────── */}
          <div id="tour-equity-curve" style={{
            background: "#FFFFFF",
            borderRadius: 14,
            border: "1px solid #E2E8F0",
            overflow: "hidden",
            boxShadow: "0 2px 12px rgba(15,25,35,0.05)",
            marginBottom: 20,
          }}>
            <div style={{
              height: 3,
              background: `linear-gradient(90deg, ${netPnl >= 0 ? "#0D9E6E" : "#D63B3B"}, transparent)`,
            }} />
            <div style={{ padding: "18px 22px" }}>
              <div style={{
                display: "flex", justifyContent: "space-between",
                alignItems: "center", marginBottom: 16,
              }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#0F1923" }}>
                    Equity Curve
                  </div>
                  <div style={{
                    fontSize: 11, color: "#94A3B8",
                    fontFamily: "'JetBrains Mono',monospace", marginTop: 2,
                  }}>
                    Account growth over time
                  </div>
                </div>
                {showSkeleton ? (
                  <Skeleton width="60px" height="12px" />
                ) : (
                  <span style={{
                    fontSize: 11,
                    color: netPnl >= 0 ? "#0D9E6E" : "#D63B3B",
                    fontFamily: "'JetBrains Mono',monospace",
                    fontWeight: 700,
                    background: netPnl >= 0 ? "rgba(13,158,110,0.08)" : "rgba(214,59,59,0.08)",
                    border: `1px solid ${netPnl >= 0 ? "rgba(13,158,110,0.2)" : "rgba(214,59,59,0.2)"}`,
                    borderRadius: 6, padding: "3px 10px",
                  }}>
                    {netPnl >= 0 ? "▲ BULLISH" : "▼ BEARISH"}
                  </span>
                )}
              </div>
              <div style={{ height: 220, position: "relative" }}>
                {showSkeleton ? (
                  <Skeleton width="100%" height="100%" variant="rect" />
                ) : (
                  <EquityCurve bull={netPnl >= 0} />
                )}
              </div>
            </div>
          </div>

          {/* ── Self Awareness Score ─────────────────────────────── */}
          <div className="dashboard-focus-grid" style={{ display: "grid", gridTemplateColumns: "1.35fr 0.65fr", gap: 16, marginBottom: 20 }}>
            <DashboardPanel
              title="Today's Intelligence"
              subtitle="Biggest strength, leak, focus, and next action"
              accent="#8B5CF6"
              action={<Link href="/intelligence" style={{ fontSize: 11, fontWeight: 800, color: "#8B5CF6", textDecoration: "none", whiteSpace: "nowrap" }}>Open Intelligence -&gt;</Link>}
            >
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                <InsightItem label="Biggest Strength" value={dnaStrength} tone="#0D9E6E" />
                <InsightItem label="Biggest Leak" value={biggestLeak} tone="#D63B3B" />
                <InsightItem label="Next Focus" value={selfAwarenessFocus} tone="#B8860B" />
                <InsightItem label="AI Recommendation" value={aiRecommendation} tone="#8B5CF6" />
              </div>
            </DashboardPanel>

            <DashboardPanel
              title="AI Coach Snapshot"
              subtitle="Most important cue right now"
              accent="#0D9E6E"
              action={<Link href="/analytics/ai-coach" style={{ fontSize: 11, fontWeight: 800, color: "#0D9E6E", textDecoration: "none", whiteSpace: "nowrap" }}>View Coaching -&gt;</Link>}
            >
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(13,158,110,0.1)", color: "#0D9E6E", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Sparkles size={17} />
                </div>
                <div style={{ fontSize: 12, color: "#334155", lineHeight: 1.7, fontWeight: 650 }}>{coachInsight}</div>
              </div>
            </DashboardPanel>
          </div>

          <DashboardPanel title="Quick Actions" subtitle="Plan, execute, journal, review" accent="#0F1923">
            <div className="quick-actions-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
              <QuickAction href="/add-trade" icon={Plus} label="Log Trade" sub="Manual entry" accent="#0D9E6E" />
              <QuickAction href="/upload-trade" icon={Camera} label="Upload Screenshot" sub="AI import" accent="#B8860B" />
              <QuickAction href="/checklist" icon={CheckSquare} label="Run Checklist" sub="Pre-trade plan" accent="#6366F1" />
              <QuickAction href="/weekly-reports?market=Forex" icon={FileText} label="Generate Report" sub="Weekly review" accent="#0D9E6E" />
            </div>
          </DashboardPanel>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <DashboardPanel
              title="Recent Progress"
              subtitle="Growth, improvement, and milestones"
              accent="#7C3AED"
              action={<Link href="/psychology-timeline" style={{ fontSize: 11, fontWeight: 800, color: "#7C3AED", textDecoration: "none", whiteSpace: "nowrap" }}>Open Timeline -&gt;</Link>}
            >
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
                <InsightItem label="Timeline Preview" value={`${stats?.totalTrades ?? 0} trades feeding your improvement history.`} tone="#7C3AED" />
                <InsightItem label="Recent Improvement" value={selfAwareness?.score >= 70 ? "Self-review is becoming more calibrated." : "The next improvement is cleaner review discipline."} tone="#0D9E6E" />
                <InsightItem label="Recent Milestone" value={tradingDNA && !tradingDNA.insufficient ? "Trading DNA profile is active." : "Add more complete trades to unlock deeper milestones."} tone="#B8860B" />
              </div>
            </DashboardPanel>
          </div>

          {false && selfAwareness?.score != null && selfAwareness.trackedCount >= 3 && (() => {
            const sa = selfAwareness;
            const scoreColor = sa.score >= 70 ? "#0D9E6E" : sa.score >= 40 ? "#F59E0B" : "#D63B3B";
            const scoreLabel = sa.score >= 70 ? "Well Calibrated" : sa.score >= 40 ? "Needs Work" : "Blind Spot";
            const cats = [
              { key: "Great",   color: "#0D9E6E", label: "G" },
              { key: "Average", color: "#F59E0B", label: "A" },
              { key: "Poor",    color: "#D63B3B", label: "P" },
            ].filter(c => sa.perCategory?.[c.key]?.total > 0);
            return (
              <div style={{ background: "#FFFFFF", borderRadius: 14, border: "1px solid #E2E8F0", boxShadow: "0 2px 12px rgba(15,25,35,0.04)", marginBottom: 20, padding: "16px 20px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: cats.length ? 14 : 0 }}>
                  <div style={{ flexShrink: 0, textAlign: "center" }}>
                    <div style={{ fontSize: 30, fontWeight: 900, color: scoreColor, fontFamily: "'JetBrains Mono',monospace", lineHeight: 1 }}>{sa.score}%</div>
                    <div style={{ fontSize: 8, color: scoreColor, fontWeight: 700, letterSpacing: "0.08em", marginTop: 3 }}>{scoreLabel.toUpperCase()}</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#0F1923", marginBottom: 2 }}>Self-Awareness Score</div>
                    <div style={{ fontSize: 11, color: "#94A3B8", lineHeight: 1.5 }}>
                      {sa.matchCount}/{sa.trackedCount} trades evaluated correctly.
                      {sa.overconfident > 0 && <span style={{ color: "#D63B3B" }}> Overconfident: {sa.overconfident}t.</span>}
                    </div>
                  </div>
                  <Link href="/analytics/self-awareness" style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: "#8B5CF6", textDecoration: "none" }}>Details →</Link>
                </div>
                {cats.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {cats.map(({ key, color, label }) => {
                      const acc = sa.perCategory?.[key]?.accuracy ?? 0;
                      return (
                        <div key={key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 20, fontSize: 9, fontWeight: 800, color, flexShrink: 0 }}>{label}</div>
                          <div style={{ flex: 1, height: 5, borderRadius: 99, background: "#F1F5F9", overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${acc}%`, background: color, borderRadius: 99 }} />
                          </div>
                          <div style={{ width: 32, fontSize: 10, fontWeight: 700, color, fontFamily: "'JetBrains Mono',monospace", textAlign: "right" }}>{acc}%</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── Psychology Cost Card ─────────────────────────────── */}
          {false && psychologyCost && psychologyCost.trackedTrades >= 3 && (() => {
            const pc = psychologyCost;
            const scoreColor = pc.psychologyCostScore >= 70 ? "#0D9E6E" : pc.psychologyCostScore >= 40 ? "#F59E0B" : "#D63B3B";
            const fmtPnl = (n) => { const v = parseFloat(n || 0); return `${v >= 0 ? "+" : "-"}$${Math.abs(v).toFixed(2)}`; };
            const topLeak = pc.topLeaks?.[0];
            const bestEmotion = pc.behavioralDNA?.mostProfitableEmotion;
            return (
              <div style={{ background: "#FFFFFF", borderRadius: 14, border: "1px solid #E2E8F0", boxShadow: "0 2px 12px rgba(15,25,35,0.04)", marginBottom: 20, padding: "16px 20px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#0F1923", marginBottom: 2 }}>Psychology Cost</div>
                    <div style={{ fontSize: 11, color: "#94A3B8" }}>Behavioural impact on P&L</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 22, fontWeight: 900, color: scoreColor, fontFamily: "'JetBrains Mono',monospace", lineHeight: 1 }}>{pc.psychologyCostScore}<span style={{ fontSize: 11 }}>/100</span></div>
                    <div style={{ fontSize: 8, color: scoreColor, fontWeight: 700, letterSpacing: "0.08em" }}>PSYCH SCORE</div>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: topLeak ? 12 : 0 }}>
                  {topLeak && (
                    <div style={{ padding: "8px 10px", borderRadius: 8, background: "#D63B3B06", border: "1px solid #D63B3B18" }}>
                      <div style={{ fontSize: 9, color: "#D63B3B", fontWeight: 700, marginBottom: 2 }}>BIGGEST LEAK</div>
                      <div style={{ fontSize: 12, fontWeight: 800, color: "#0F1923" }}>{topLeak.name}</div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#D63B3B", fontFamily: "'JetBrains Mono',monospace" }}>{fmtPnl(topLeak.cost)}</div>
                    </div>
                  )}
                  {bestEmotion && (
                    <div style={{ padding: "8px 10px", borderRadius: 8, background: "#0D9E6E08", border: "1px solid #0D9E6E22" }}>
                      <div style={{ fontSize: 9, color: "#0D9E6E", fontWeight: 700, marginBottom: 2 }}>BIGGEST STRENGTH</div>
                      <div style={{ fontSize: 12, fontWeight: 800, color: "#0F1923" }}>{bestEmotion.name}</div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#0D9E6E", fontFamily: "'JetBrains Mono',monospace" }}>{fmtPnl(bestEmotion.profit)}</div>
                    </div>
                  )}
                </div>
                <Link href="/analytics/psychology-cost" style={{ display: "block", textAlign: "right", fontSize: 11, fontWeight: 700, color: "#8B5CF6", textDecoration: "none", marginTop: 4 }}>Full breakdown →</Link>
              </div>
            );
          })()}

          {/* ── Trading DNA Card ────────────────────────────────── */}
          {false && tradingDNA && !tradingDNA.insufficient && (() => {
            const d = tradingDNA;
            const fmtPnl = (n) => { const v = parseFloat(n || 0); return `${v >= 0 ? "+" : "-"}$${Math.abs(v).toFixed(2)}`; };
            const confBadge = (c) => {
              if (!c) return null;
              const bg = c === "High" ? "#0D9E6E18" : c === "Medium" ? "#F59E0B18" : "#94A3B818";
              const fc = c === "High" ? "#0D9E6E" : c === "Medium" ? "#B8860B" : "#64748B";
              return <span style={{ fontSize: 8, fontWeight: 800, color: fc, background: bg, borderRadius: 4, padding: "1px 5px", letterSpacing: "0.06em", marginLeft: 4 }}>{c.toUpperCase()}</span>;
            };
            const dnaRows = [
              d.sessionDNA?.best && { label: "Best Session", val: d.sessionDNA.best.name, sub: fmtPnl(d.sessionDNA.best.netPnL), color: "#0D9E6E", conf: d.sessionDNA.best.confidence },
              d.instrumentDNA?.best && { label: "Best Instrument", val: d.instrumentDNA.best.name, sub: fmtPnl(d.instrumentDNA.best.netPnL), color: "#0D9E6E", conf: d.instrumentDNA.best.confidence },
              d.emotionDNA?.mostProfitable && { label: "Best Emotion", val: d.emotionDNA.mostProfitable.name, sub: fmtPnl(d.emotionDNA.mostProfitable.netPnL), color: "#0D9E6E", conf: d.emotionDNA.mostProfitable.confidence },
              d.emotionDNA?.mostExpensive && { label: "Worst Emotion", val: d.emotionDNA.mostExpensive.name, sub: fmtPnl(d.emotionDNA.mostExpensive.netPnL), color: "#D63B3B", conf: d.emotionDNA.mostExpensive.confidence },
              d.mistakeDNA?.mostExpensive && { label: "Costliest Mistake", val: d.mistakeDNA.mostExpensive.name, sub: fmtPnl(d.mistakeDNA.mostExpensive.netPnL), color: "#D63B3B", conf: d.mistakeDNA.mostExpensive.confidence },
              d.dayDNA?.best && { label: "Best Day", val: d.dayDNA.best.name, sub: `${d.dayDNA.best.winRate}% WR`, color: "#8B5CF6", conf: d.dayDNA.best.confidence },
            ].filter(Boolean).slice(0, 4);
            return (
              <div style={{ background: "#FFFFFF", borderRadius: 14, border: "1px solid #E2E8F0", boxShadow: "0 2px 12px rgba(15,25,35,0.04)", marginBottom: 20, padding: "16px 20px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#0F1923", marginBottom: 2 }}>Trading DNA</div>
                    <div style={{ fontSize: 11, color: "#94A3B8" }}>Your behavioral fingerprint from {d.totalTrades} trades</div>
                  </div>
                  <Link href="/analytics/trading-dna" style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: "#8B5CF6", textDecoration: "none", whiteSpace: "nowrap" }}>Full DNA →</Link>
                </div>
                {d.dnaSummary?.tradingIdentity && (
                  <div style={{ fontSize: 11, color: "#475569", lineHeight: 1.6, marginBottom: 12, padding: "8px 10px", background: "#F8FAFC", borderRadius: 8, borderLeft: "3px solid #8B5CF6" }}>
                    {d.dnaSummary.tradingIdentity}
                  </div>
                )}
                {dnaRows.length > 0 && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {dnaRows.map((row, i) => (
                      <div key={i} style={{ padding: "8px 10px", borderRadius: 8, background: `${row.color}06`, border: `1px solid ${row.color}20` }}>
                        <div style={{ fontSize: 9, color: "#94A3B8", fontWeight: 700, marginBottom: 2, display: "flex", alignItems: "center" }}>
                          {row.label}{confBadge(row.conf)}
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 800, color: "#0F1923" }}>{row.val}</div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: row.color, fontFamily: "'JetBrains Mono',monospace" }}>{row.sub}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

        </main>
      </div>

      {showWelcome && <OnboardingTour onFinish={finishTour} />}

      <style jsx global>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0);    }
        }
        @media (max-width: 640px) {
          main { padding: 16px !important; }
          .dash-kpi-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .dashboard-focus-grid { grid-template-columns: 1fr !important; }
          .quick-actions-grid { grid-template-columns: 1fr !important; }
          .quick-action { min-height: 58px !important; }
        }
        @media (max-width: 360px) {
          .dash-kpi-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <ErrorBoundary fallback={<div style={{ padding: "2rem", textAlign: "center" }}>Dashboard failed to load. Please refresh.</div>}>
      <Suspense><DashboardContent /></Suspense>
    </ErrorBoundary>
  );
}
