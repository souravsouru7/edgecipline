"use client";

import { Suspense } from "react";
import ErrorBoundary from "@/components/ErrorBoundary";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import CandlestickBackground from "@/features/shared/components/CandlestickBackground";
import TickerTape            from "@/features/shared/components/TickerTape";
import PageHeader            from "@/features/shared/components/PageHeader";
import StatCard              from "@/features/analytics/components/StatCard";
import SectionCard           from "@/features/analytics/components/SectionCard";
import ProgressBar           from "@/features/analytics/components/ProgressBar";
import ListItem              from "@/features/analytics/components/ListItem";
import CalendarPnL           from "@/features/analytics/components/CalendarPnL";
import InsightTag            from "@/features/analytics/components/InsightTag";
import { useAnalytics }      from "@/features/analytics/hooks/useAnalytics";
import { Skeleton }          from "@/features/shared";

const C = { bull: "#0D9E6E", bear: "#D63B3B", gold: "#B8860B", purple: "#8B5CF6", primary: "#0F1923", muted: "#94A3B8" };

// ── helpers ────────────────────────────────────────────────────────────────────
function fmt(n, prefix = "$") {
  const v = parseFloat(n || 0);
  return `${v >= 0 ? "+" : ""}${prefix}${Math.abs(v).toFixed(2)}`;
}

function sessionFmt(s) {
  if (!s || !s.trades) return null;
  const p = parseFloat(s.profit || 0);
  return { profit: `${p >= 0 ? "+" : ""}$${Math.abs(p).toFixed(2)}`, winRate: s.winRate, trades: s.trades, name: s.name };
}

function classifyInsight(text) {
  if (!text) return "info";
  const t = text.toLowerCase();
  if (t.includes("risk") || t.includes("drawdown") || t.includes("loss") || t.includes("negative")) return "danger";
  if (t.includes("excellent") || t.includes("strong") || t.includes("well") || t.includes("consistent")) return "success";
  if (t.includes("improve") || t.includes("consider") || t.includes("caution")) return "warning";
  return "info";
}

// Convert distribution.byPair / byStrategy (object) → sorted array
function objToRows(obj, keyName = "name", limit = 6) {
  return Object.entries(obj || {})
    .filter(([k]) => k && k !== "Unspecified" && k !== "undefined")
    .map(([k, s]) => ({
      [keyName]: k,
      count: s.total || 0,
      winRate: s.winRate ?? "0.0",
      profit: parseFloat(s.profit || 0).toFixed(2),
    }))
    .sort((a, b) => parseFloat(b.profit) - parseFloat(a.profit))
    .slice(0, limit);
}

// ── Pair row ───────────────────────────────────────────────────────────────────
function PairRow({ name, count, winRate, profit }) {
  const p = parseFloat(profit);
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #F4F2EE" }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.primary, fontFamily: "'JetBrains Mono',monospace" }}>{name}</div>
        <div style={{ fontSize: 10, color: C.muted }}>{count} trades · {winRate}% WR</div>
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: p >= 0 ? C.bull : C.bear }}>
        {p >= 0 ? "+" : ""}${Math.abs(p).toFixed(2)}
      </div>
    </div>
  );
}

// ── Generate actionable psychology insights from data ─────────────────────────
function generatePsychInsights({ moodRows, confRows, tagRows, wouldRetakeAnalysis, disciplineScore }) {
  const insights = [];

  // Mood insights
  if (moodRows.length >= 2) {
    const sorted = [...moodRows].sort((a, b) => parseFloat(b.avgProfit) - parseFloat(a.avgProfit));
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    if (best && parseFloat(best.avgProfit) > 0) {
      insights.push({ type: "success", icon: "🧠", title: `Trade best when ${best.label}`, body: `${best.winRate}% win rate · avg +$${parseFloat(best.avgProfit).toFixed(2)} per trade. Prioritize setups in this mental state.` });
    }
    if (worst && parseFloat(worst.avgProfit) < 0 && worst.trades >= 2) {
      insights.push({ type: "danger", icon: "⚠️", title: `Avoid trading when ${worst.label}`, body: `${worst.winRate}% win rate · avg $${parseFloat(worst.avgProfit).toFixed(2)} per trade across ${worst.trades} trades. Step away or reduce size.` });
    }
  }

  // Confidence paradox — high confidence losing
  const highConf = confRows.find(c => c.level === "High" || c.level === "Overconfident");
  const lowConf  = confRows.find(c => c.level === "Low");
  if (highConf && parseFloat(highConf.avgProfit) < 0 && highConf.trades >= 2) {
    insights.push({ type: "warning", icon: "🚨", title: "High confidence → losing trades", body: `Your "High" confidence trades average $${parseFloat(highConf.avgProfit).toFixed(2)}. Overconfidence may be causing oversizing or skipping confirmation.` });
  }
  if (lowConf && parseFloat(lowConf.avgProfit) > 0 && lowConf.trades >= 2) {
    insights.push({ type: "success", icon: "💡", title: "Low confidence trades are profitable", body: `Cautious entries average +$${parseFloat(lowConf.avgProfit).toFixed(2)}. Your hesitation signals good instincts — trust them.` });
  }

  // Dangerous emotional tags
  const dangerTags = ["FOMO", "Revenge", "Fear", "Greed", "Rushed", "Frustrated"];
  tagRows.forEach(t => {
    if (dangerTags.includes(t.tag) && parseFloat(t.avgProfit) < 0 && t.trades >= 1) {
      insights.push({ type: "danger", icon: t.emoji || "❌", title: `${t.tag} trades cost you money`, body: `${t.trades} trade${t.trades > 1 ? "s" : ""} · ${t.winRate}% WR · avg $${parseFloat(t.avgProfit).toFixed(2)}. Rule: when you feel ${t.tag.toLowerCase()}, close the platform.` });
    }
  });

  // Positive emotional tags
  tagRows.forEach(t => {
    if (!dangerTags.includes(t.tag) && parseFloat(t.avgProfit) > 5 && parseFloat(t.winRate) >= 70 && t.trades >= 2) {
      insights.push({ type: "success", icon: t.emoji || "✅", title: `${t.tag} state is your edge`, body: `${t.trades} trades · ${t.winRate}% WR · avg +$${parseFloat(t.avgProfit).toFixed(2)}. Seek more trades in this mindset.` });
    }
  });

  // Would retake divergence
  const yes = wouldRetakeAnalysis?.yes;
  const no  = wouldRetakeAnalysis?.no;
  if (yes && no && yes.trades >= 2 && no.trades >= 2) {
    const yesPnl = parseFloat(yes.avgProfit);
    const noPnl  = parseFloat(no.avgProfit);
    if (yesPnl > 0 && noPnl < 0) {
      insights.push({ type: "success", icon: "🔁", title: "Your trade instincts are calibrated", body: `Trades you'd retake avg +$${yesPnl.toFixed(2)} vs trades you'd skip avg $${noPnl.toFixed(2)}. Your gut is telling you the right thing — listen to it before entry.` });
    } else if (yesPnl < 0 && no.trades > 0) {
      insights.push({ type: "warning", icon: "🔁", title: "Retake instinct may need recalibration", body: `Even trades you'd retake are losing (avg $${yesPnl.toFixed(2)}). Review your entry criteria — the setups themselves may be flawed.` });
    }
  }

  // Discipline score interpretation
  if (typeof disciplineScore === "number" && disciplineScore > 0) {
    if (disciplineScore >= 80) {
      insights.push({ type: "success", icon: "🏆", title: `Strong discipline score: ${disciplineScore}%`, body: "You're following your rules consistently. Keep protecting this score — it's your moat against emotional trading." });
    } else if (disciplineScore < 50) {
      insights.push({ type: "danger", icon: "📉", title: `Discipline score at ${disciplineScore}%`, body: "Less than half your trades follow your plan. Focus on process over outcome: one disciplined loss beats one undisciplined win." });
    }
  }

  return insights.slice(0, 6);
}

// ── Psychology insight card ────────────────────────────────────────────────────
function PsychInsightCard({ icon, title, body, type }) {
  const colors = {
    success: { bg: "#F0FDF4", border: "#BBF7D0", title: "#166534" },
    danger:  { bg: "#FFF8F8", border: "#FED7D7", title: "#9B1C1C" },
    warning: { bg: "#FFFBEB", border: "#FDE68A", title: "#92400E" },
    info:    { bg: "#F0F7FF", border: "#BFDBFE", title: "#1E40AF" },
  };
  const s = colors[type] || colors.info;
  return (
    <div style={{ borderRadius: 12, border: `1px solid ${s.border}`, background: s.bg, padding: "14px 16px", display: "flex", gap: 12, alignItems: "flex-start" }}>
      <div style={{ fontSize: 18, flexShrink: 0, lineHeight: 1.2 }}>{icon}</div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 800, color: s.title, marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 11, color: "#374151", lineHeight: 1.65 }}>{body}</div>
      </div>
    </div>
  );
}

// ── Psych bar row ──────────────────────────────────────────────────────────────
function PsychRow({ label, winRate, trades, avgProfit, color }) {
  const wr = parseFloat(winRate || 0);
  const ap = parseFloat(avgProfit || 0);
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: C.primary }}>{label}</span>
        <div style={{ display: "flex", gap: 12 }}>
          <span style={{ fontSize: 10, color: C.muted, fontFamily: "'JetBrains Mono',monospace" }}>{trades}t</span>
          <span style={{ fontSize: 11, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: ap >= 0 ? C.bull : C.bear }}>{ap >= 0 ? "+" : "-"}${Math.abs(ap).toFixed(2)}</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: wr >= 50 ? C.bull : C.bear }}>{wr}%</span>
        </div>
      </div>
      <div style={{ height: 4, background: "#F4F2EE", borderRadius: 99 }}>
        <div style={{ height: "100%", width: `${Math.min(100, wr)}%`, background: color || (wr >= 50 ? C.bull : C.bear), borderRadius: 99, transition: "width 0.4s" }} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function AnalyticsContent() {
  const queryClient = useQueryClient();
  const {
    loading,
    coreLoading,
    deepLoading,
    data,
    calendarMonth,
    prevMonth,
    nextMonth,
    error,
    retryAfterSeconds
  } = useAnalytics();
  const { summary, riskReward, distribution, performance, timeAnalysis, quality, drawdown, aiInsights, psychology } = data || {};

  const has    = summary?.totalTrades > 0;
  const pnl    = parseFloat(summary?.totalProfit ?? 0);
  const bullPnl = pnl >= 0;

  // Rate limit error banner
  if (error?.status === 429 && retryAfterSeconds > 0) {
    const minutes = Math.floor(retryAfterSeconds / 60);
    const seconds = retryAfterSeconds % 60;
    return (
      <div style={{ minHeight: "100vh", background: "#F4F2EE", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", padding: "40px 20px", textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 24 }}>⏳</div>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: C.primary, marginBottom: 12 }}>Rate Limited</h1>
        <p style={{ fontSize: 16, color: C.muted, marginBottom: 24, maxWidth: "400px" }}>
          Too many analytics requests. Server cooldown: <strong>{minutes}m {seconds}s</strong>
        </p>
        <p style={{ fontSize: 14, color: C.muted, marginBottom: 32 }}>
          Core charts loading above. Deep analytics (psychology, AI insights) will appear shortly.
        </p>
        <button
          onClick={() => queryClient.invalidateQueries({ queryKey: ["analytics"] })}
          style={{
            background: C.bull,
            color: "white",
            border: "none",
            padding: "12px 32px",
            borderRadius: 12,
            fontSize: 14,
            fontWeight: 700,
            cursor: "pointer"
          }}
        >
          🔄 Refresh Now
        </button>
      </div>
    );
  }

  // Strategy rows — FIX: was reading quality?.byStrategy (doesn't exist); correct source is distribution.byStrategy
  const strategyRows = objToRows(distribution?.byStrategy, "name", 6);

  // Pair rows — data collected but was never shown
  const pairRows = objToRows(distribution?.byPair, "name", 6);

  // Mood data — FIX: was reading psychology.moodWinRate which doesn't exist
  const moodRows = psychology?.moodAnalysis || [];
  const confRows = psychology?.confidenceAnalysis || [];
  const tagRows  = psychology?.emotionalTagImpact || [];

  // FOMO count — FIX: was reading psychology.fomoTrades which doesn't exist
  const fomoTrades = tagRows.find(t => t.tag === "FOMO")?.trades ?? 0;
  const revengeTrades = tagRows.find(t => t.tag === "Revenge")?.trades ?? 0;

  // Discipline score — FIX: was reading psychology.disciplineScore; correct field is psychologyScore
  const disciplineScore = psychology?.psychologyScore ?? 0;

  // Mood win rate — computed from moodAnalysis (was previously always 0)
  const totalMoodTrades = moodRows.reduce((s, m) => s + m.trades, 0);
  const totalMoodWins   = moodRows.reduce((s, m) => s + m.wins,   0);
  const moodWinRate     = totalMoodTrades > 0 ? ((totalMoodWins / totalMoodTrades) * 100).toFixed(1) : "0.0";

  // Score breakdown for entry basis
  const sb = psychology?.scoreBreakdown || {};

  return (
    <div style={{ minHeight: "100vh", background: "#F4F2EE", display: "flex", flexDirection: "column", fontFamily: "'Plus Jakarta Sans',sans-serif", color: "#0F1923", position: "relative" }}>
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <CandlestickBackground canvasId="analytics-bg-canvas" />

      <div style={{ position: "relative", zIndex: 10, display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        <PageHeader showMarketSwitcher />
        <TickerTape />

        <main style={{ flex: 1, maxWidth: 1200, width: "100%", margin: "0 auto", padding: "28px 24px", boxSizing: "border-box" }}>

          {/* ── Page title ─────────────────────────────────────── */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 800, color: C.primary, letterSpacing: "-0.02em", margin: 0 }}>Analytics</h1>
              <p style={{ fontSize: 12, color: C.muted, fontFamily: "'JetBrains Mono',monospace", margin: "4px 0 0", letterSpacing: "0.04em" }}>
                Performance intelligence
              </p>
            </div>
            <Link href="/trades" style={{ fontSize: 12, color: C.primary, border: "1px solid #E2E8F0", borderRadius: 8, padding: "8px 14px", textDecoration: "none", fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, background: "#FFFFFF" }}>← Journal</Link>
          </div>

          {/* ── Row 1: Core KPIs ───────────────────────────────── */}
          <div className="analytics-kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 14 }}>
            {[
              { label: "Total Trades",  value: has ? String(summary.totalTrades)  : "—", sub: "trades logged",        color: C.primary, tooltip: "Total number of trades you've logged. More trades = more accurate analytics and better AI pattern detection." },
              { label: "Win Rate",      value: has ? `${summary.winRate}%`          : "—", sub: "of trades profitable", color: summary?.winRate >= 50 ? C.bull : C.bear, tooltip: "Percentage of trades that closed in profit. Above 50% is green. Win rate alone doesn't guarantee profitability — your R:R matters equally." },
              { label: "Net P&L",       value: has ? `${bullPnl ? "+" : ""}$${Math.abs(pnl).toFixed(2)}` : "—", sub: "total return", color: bullPnl ? C.bull : C.bear, tooltip: "Your total profit or loss across all logged trades. Green = net profitable, red = net loss. This is your real bottom line." },
              { label: "Avg Win",       value: has ? `$${parseFloat(summary.avgWin  || 0).toFixed(2)}` : "—", sub: "avg winner",     color: C.bull, tooltip: "Average profit per winning trade. Compare with Avg Loss — ideally your wins should be at least 1.5× your losses for a positive edge." },
              { label: "Avg Loss",      value: has ? `$${parseFloat(summary.avgLoss || 0).toFixed(2)}` : "—", sub: "avg loser",      color: C.bear, tooltip: "Average loss per losing trade. Lower is better. If this is much larger than Avg Win, tighten your stop losses and risk management." },
            ].map((s, i) => <StatCard key={s.label} {...s} loading={loading} delay={i * 0.05} />)}
          </div>

          {/* ── Row 2: Risk & Performance KPIs ─────────────────── */}
          <div className="analytics-kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 20 }}>
            {[
              {
                label: "Profit Factor",
                value: has ? (performance?.profitFactor || "0.00") : "—",
                sub: "gross profit / loss",
                color: parseFloat(performance?.profitFactor || 0) >= 1.5 ? C.bull : C.bear,
                tooltip: "Gross profit divided by gross loss. Above 1.0 = profitable. 1.5+ is good, 2.0+ is excellent. Below 1.0 means you're losing money overall.",
              },
              {
                label: "Sharpe Ratio",
                value: has ? parseFloat(riskReward?.riskAdjustedReturn || 0).toFixed(2) : "—",
                sub: "risk-adjusted return",
                color: parseFloat(riskReward?.riskAdjustedReturn || 0) >= 1 ? C.bull : C.bear,
                tooltip: "Risk-adjusted return — how much reward you earn per unit of risk. Above 1.0 is good, 2.0+ is excellent. Negative means losses outpace your risk.",
              },
              { label: "Max Drawdown", value: has ? `${drawdown?.maxDrawdown || 0}%`  : "—", sub: "largest equity drop", color: C.bear, tooltip: "Largest peak-to-trough drop in your cumulative P&L. Lower is better. Keep drawdowns under 20% to stay in the game long-term." },
              { label: "Expectancy",   value: has ? `$${parseFloat(performance?.expectancy || 0).toFixed(2)}` : "—", sub: "per trade expectancy", color: parseFloat(performance?.expectancy || 0) >= 0 ? C.bull : C.bear, tooltip: "Expected average profit per trade. Formula: (Win Rate × Avg Win) − (Loss Rate × Avg Loss). Positive = you have a statistical edge in the market." },
              { label: "Best Streak",  value: has ? String(performance?.maxWinStreak || 0) : "—", sub: "win streak record", color: C.gold, tooltip: "Your longest consecutive winning streak on record. A high streak shows consistency, but never use it as a reason to oversize your positions." },
              { label: "Worst Streak", value: has ? String(performance?.maxLossStreak || 0) : "—", sub: "loss streak record", color: C.bear, tooltip: "Your longest consecutive losing streak. Know this number — if you're approaching it again, pause and review your setups before continuing." },
            ].map((s, i) => <StatCard key={s.label} {...s} loading={loading} delay={i * 0.05} />)}
          </div>

          {loading && (
            <>
              {/* ── Skeleton section rows ─────────────────────────── */}
              {[
                { cols: 3, heights: [180, 160, 160] },
                { cols: 3, heights: [160, 140, 140] },
                { cols: 1, heights: [200] },
                { cols: 2, heights: [220, 180] },
              ].map((row, ri) => (
                <div key={ri} style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(280px, 1fr))`, gap: 16, marginBottom: 24 }}>
                  {row.heights.map((h, ci) => (
                    <div key={ci} style={{ background: "#FFFFFF", borderRadius: 14, border: "1px solid #E2E8F0", overflow: "hidden", boxShadow: "0 2px 12px rgba(15,25,35,0.05)" }}>
                      <div style={{ height: 3, background: "#EDF2F7" }} />
                      <div style={{ padding: "16px 20px", borderBottom: "1px solid #E2E8F0" }}>
                        <Skeleton width="120px" height="14px" style={{ marginBottom: 6 }} />
                        <Skeleton width="80px" height="10px" />
                      </div>
                      <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
                        {[...Array(Math.round(h / 28))].map((_, li) => (
                          <Skeleton key={li} width={`${100 - li * 8}%`} height="16px" />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}

          {!loading && (
            <>
              {/* ── Distribution + Strategy + Pairs ──────────────── */}
              <div className="analytics-section-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 20 }}>

                {/* Long vs Short */}
                <SectionCard title="Trade Direction" subtitle="LONG VS SHORT" delay={0.2} accentColor={C.bull}>
                  {(() => {
                    // Derive long/short from byType.BUY / byType.SELL if top-level fields are missing
                    const longT  = distribution?.longTrades  ?? distribution?.byType?.BUY?.total  ?? 0;
                    const shortT = distribution?.shortTrades ?? distribution?.byType?.SELL?.total ?? 0;
                    const longWR  = distribution?.longWinRate  ?? distribution?.byType?.BUY?.winRate  ?? "0.0";
                    const shortWR = distribution?.shortWinRate ?? distribution?.byType?.SELL?.winRate ?? "0.0";
                    const longP   = parseFloat(distribution?.longProfit  ?? distribution?.byType?.BUY?.profit  ?? 0);
                    const shortP  = parseFloat(distribution?.shortProfit ?? distribution?.byType?.SELL?.profit ?? 0);
                    const total   = (longT + shortT) || 1;
                    const hasData = longT > 0 || shortT > 0;
                    return hasData ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        <ProgressBar label={`Long (${longT})`}  value={longT}  max={total} color={C.bull} />
                        <ProgressBar label={`Short (${shortT})`} value={shortT} max={total} color={C.bear} />
                        <div style={{ height: 1, background: "#E2E8F0", margin: "4px 0" }} />
                        <ProgressBar label={`Long Win Rate  ${longWR}%`}  value={parseFloat(longWR)}  showPercent={false} color={C.bull} />
                        <ProgressBar label={`Short Win Rate ${shortWR}%`} value={parseFloat(shortWR)} showPercent={false} color={C.bear} />
                        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
                          <span style={{ fontSize: 10, color: C.bull, fontFamily: "'JetBrains Mono',monospace", fontWeight: 700 }}>Long P&L: {longP >= 0 ? "+" : ""}${Math.abs(longP).toFixed(2)}</span>
                          <span style={{ fontSize: 10, color: C.bear, fontFamily: "'JetBrains Mono',monospace", fontWeight: 700 }}>Short P&L: {shortP >= 0 ? "+" : ""}${Math.abs(shortP).toFixed(2)}</span>
                        </div>
                      </div>
                    ) : <p style={{ color: C.muted, fontSize: 12 }}>No trade direction data yet.</p>;
                  })()}
                </SectionCard>

                {/* Strategy Breakdown — FIX: was quality?.byStrategy (doesn't exist), now using distribution.byStrategy */}
                <SectionCard title="Strategy Breakdown" subtitle="PERFORMANCE BY SETUP" delay={0.25} accentColor={C.gold}>
                  {strategyRows.length > 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                      {strategyRows.map((s, i) => (
                        <PairRow key={i} name={s.name} count={s.count} winRate={s.winRate} profit={s.profit} />
                      ))}
                    </div>
                  ) : <p style={{ color: C.muted, fontSize: 12 }}>Tag trades with strategies to see breakdown.</p>}
                </SectionCard>

                {/* Currency Pair Performance — NEW: data was collected but never shown */}
                <SectionCard title="Pair Performance" subtitle="BY CURRENCY PAIR" delay={0.3} accentColor={C.gold}>
                  {pairRows.length > 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                      {pairRows.map((s, i) => (
                        <PairRow key={i} name={s.name} count={s.count} winRate={s.winRate} profit={s.profit} />
                      ))}
                    </div>
                  ) : <p style={{ color: C.muted, fontSize: 12 }}>No pair data yet.</p>}
                </SectionCard>
              </div>

              {/* ── R:R Analysis ──────────────────────────────────── */}
              <div className="analytics-section-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 20 }}>
                <SectionCard title="Risk / Reward" subtitle="RR DISTRIBUTION" delay={0.35} accentColor={C.bear}>
                  {riskReward ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {[
                        { label: "Avg R:R Ratio",   value: `${parseFloat(riskReward.avgRR     || 0).toFixed(2)}:1`, color: parseFloat(riskReward.avgRR || 0) >= 1 ? C.bull : C.bear },
                        { label: "Best Trade RR",   value: `${parseFloat(riskReward.bestRR    || 0).toFixed(2)}:1`, color: C.bull },
                        { label: "Avg RR — Wins",   value: `${parseFloat(riskReward.avgWinRR  || 0).toFixed(2)}:1`, color: C.bull },
                        { label: "Avg RR — Losses", value: `${parseFloat(riskReward.avgLossRR || 0).toFixed(2)}:1`, color: C.bear },
                        { label: "Largest Win",     value: `$${parseFloat(performance?.largestWin  || 0).toFixed(2)}`, color: C.bull },
                        { label: "Largest Loss",    value: `$${Math.abs(parseFloat(performance?.largestLoss || 0)).toFixed(2)}`, color: C.bear },
                      ].map(r => (
                        <div key={r.label} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid #F4F2EE" }}>
                          <span style={{ fontSize: 10, color: C.muted, fontFamily: "'JetBrains Mono',monospace" }}>{r.label}</span>
                          <span style={{ fontSize: 12, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: r.color }}>{r.value}</span>
                        </div>
                      ))}
                    </div>
                  ) : <p style={{ color: C.muted, fontSize: 12 }}>No data yet.</p>}
                </SectionCard>

                {/* Session cards */}
                {timeAnalysis && (
                  <SectionCard title="Session Performance" subtitle="BEST & WORST SESSIONS" delay={0.4} accentColor={C.primary}>
                    {timeAnalysis.bestSession ? (
                      <div>
                        <ListItem label="Best Session"    value={`$${timeAnalysis.bestSession.profit || 0}`}  color={C.bull} sub={`${timeAnalysis.bestSession.name} · ${timeAnalysis.bestSession.winRate}% WR`} />
                        <ListItem label="Worst Session"   value={timeAnalysis.worstSession ? `$${timeAnalysis.worstSession.profit}` : "—"} color={C.bear} sub={timeAnalysis.worstSession ? `${timeAnalysis.worstSession.name} · ${timeAnalysis.worstSession.winRate}% WR` : "Need more data"} />
                        <ListItem label="Highest WR"      value={timeAnalysis.bestSessionWR ? `${timeAnalysis.bestSessionWR.winRate}%` : "—"} color={C.gold} sub={timeAnalysis.bestSessionWR?.name || "Need more data"} />
                      </div>
                    ) : <p style={{ color: C.muted, fontSize: 12 }}>Tag trades with sessions to see breakdown.</p>}
                  </SectionCard>
                )}

                {/* Timing Insights */}
                <SectionCard title="Timing Insights" subtitle="OPTIMAL WINDOWS" delay={0.45} accentColor={C.gold}>
                  {timeAnalysis ? (
                    <div>
                      <ListItem label="Best Day"    value={timeAnalysis.bestDay?.profit  > 0 ? `$${timeAnalysis.bestDay.profit}`   : "—"} color={C.bull} sub={timeAnalysis.bestDay?.name  || "Need more data"} />
                      <ListItem label="Worst Day"   value={timeAnalysis.worstDay?.profit ? `$${timeAnalysis.worstDay.profit}`       : "—"} color={C.bear} sub={timeAnalysis.worstDay?.name || "Need more data"} />
                      <ListItem label="Best Hour"   value={timeAnalysis.bestHour?.profit  > 0 ? `$${timeAnalysis.bestHour.profit}`  : "—"} color={C.bull} sub={timeAnalysis.bestHour ? `${String(timeAnalysis.bestHour.hour).padStart(2,"0")}:00 UTC` : "Need more data"} />
                      <ListItem label="Worst Hour"  value={timeAnalysis.worstHour?.hour != null ? `$${timeAnalysis.worstHour.profit}` : "—"} color={C.bear} sub={timeAnalysis.worstHour ? `${String(timeAnalysis.worstHour.hour).padStart(2,"0")}:00 UTC` : "Need more data"} />
                    </div>
                  ) : <p style={{ color: C.muted, fontSize: 12 }}>Log more trades to see timing data.</p>}
                </SectionCard>
              </div>

              {/* ── Calendar ──────────────────────────────────────── */}
              <div style={{ marginBottom: 24 }}>
                <SectionCard title="Calendar Performance" subtitle="DAILY P&L HEATMAP" delay={0.5} accentColor={C.bull}>
                  <CalendarPnL byDate={timeAnalysis?.byDate || {}} activeMonth={calendarMonth} onPrevMonth={prevMonth} onNextMonth={nextMonth} currency="$" />
                </SectionCard>
              </div>

              {/* ── Psychology ────────────────────────────────────── */}
              {psychology && (
                <div style={{ marginBottom: 24 }}>
                  <SectionCard title="Psychology & Discipline" subtitle="EMOTIONAL TRADING ANALYSIS" delay={0.55} accentColor={C.purple}>

                    {/* Top scores */}
                    <div className="analytics-psych-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: 16 }}>
                      {[
                        // FIX: was psychology.disciplineScore (doesn't exist) → now psychologyScore
                        { label: "Discipline Score", value: `${disciplineScore}%`, color: C.purple },
                        // FIX: was psychology.moodWinRate (doesn't exist) → computed from moodAnalysis
                        { label: "Mood Win Rate",    value: `${moodWinRate}%`,     color: totalMoodTrades > 0 ? (parseFloat(moodWinRate) >= 50 ? C.bull : C.bear) : C.muted },
                        // FIX: was psychology.fomoTrades (doesn't exist) → from emotionalTagImpact
                        { label: "FOMO Trades",      value: String(fomoTrades),    color: fomoTrades > 0 ? C.bear : C.bull },
                        { label: "Revenge Trades",   value: String(revengeTrades), color: revengeTrades > 0 ? C.bear : C.bull },
                        { label: "Plan Adherence",   value: sb.planAdherencePct ? `${parseFloat(sb.planAdherencePct).toFixed(0)}%` : "—", color: C.gold },
                      ].map(m => (
                        <div key={m.label} style={{ background: "#FAFAFA", borderRadius: 10, padding: "12px 14px", border: "1px solid #E8EDF2" }}>
                          <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: "0.06em", marginBottom: 6 }}>{m.label.toUpperCase()}</div>
                          <div style={{ fontSize: 20, fontWeight: 800, color: m.color, fontFamily: "'JetBrains Mono',monospace" }}>{m.value}</div>
                        </div>
                      ))}
                    </div>

                    <div className="analytics-psych-sub" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 20 }}>

                      {/* Mood breakdown */}
                      {moodRows.length > 0 && (
                        <div>
                          <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 12 }}>MOOD LEVEL (1–5)</div>
                          {moodRows.map(m => (
                            <PsychRow key={m.level} label={m.label} winRate={m.winRate} trades={m.trades} avgProfit={m.avgProfit}
                              color={m.level >= 4 ? C.bull : m.level <= 2 ? C.bear : C.gold} />
                          ))}
                        </div>
                      )}

                      {/* Confidence breakdown */}
                      {confRows.length > 0 && (
                        <div>
                          <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 12 }}>CONFIDENCE LEVEL</div>
                          {confRows.map(c => {
                            const confColor = { Low: C.bear, Medium: C.gold, High: C.bull, Overconfident: C.bear };
                            return <PsychRow key={c.level} label={c.level} winRate={c.winRate} trades={c.trades} avgProfit={c.avgProfit} color={confColor[c.level]} />;
                          })}
                        </div>
                      )}

                      {/* Emotional tag impact */}
                      {tagRows.length > 0 && (
                        <div>
                          <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 12 }}>EMOTIONAL TAG IMPACT</div>
                          {tagRows.slice(0, 6).map(t => (
                            <PsychRow key={t.tag} label={`${t.emoji} ${t.tag}`} winRate={t.winRate} trades={t.trades} avgProfit={t.avgProfit}
                              color={["FOMO","Revenge","Fear","Frustrated","Greed"].includes(t.tag) ? C.bear : C.bull} />
                          ))}
                        </div>
                      )}

                      {/* Would Retake */}
                      {(psychology.wouldRetakeAnalysis?.yes || psychology.wouldRetakeAnalysis?.no) && (
                        <div>
                          <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 12 }}>WOULD YOU RETAKE?</div>
                          {psychology.wouldRetakeAnalysis.yes && (
                            <PsychRow label="Yes — retake" winRate={psychology.wouldRetakeAnalysis.yes.winRate}
                              trades={psychology.wouldRetakeAnalysis.yes.trades} avgProfit={psychology.wouldRetakeAnalysis.yes.avgProfit} color={C.bull} />
                          )}
                          {psychology.wouldRetakeAnalysis.no && (
                            <PsychRow label="No — skip" winRate={psychology.wouldRetakeAnalysis.no.winRate}
                              trades={psychology.wouldRetakeAnalysis.no.trades} avgProfit={psychology.wouldRetakeAnalysis.no.avgProfit} color={C.bear} />
                          )}
                          {psychology.totalTrackedTrades > 0 && (
                            <div style={{ fontSize: 10, color: C.muted, marginTop: 8 }}>{psychology.totalTrackedTrades} psychologically tracked trades</div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* ── Actionable Insights ───────────────────────── */}
                    {(() => {
                      const psychInsights = generatePsychInsights({
                        moodRows, confRows, tagRows,
                        wouldRetakeAnalysis: psychology.wouldRetakeAnalysis,
                        disciplineScore,
                      });
                      return psychInsights.length > 0 ? (
                        <div style={{ marginTop: 20 }}>
                          <div style={{ fontSize: 10, color: C.purple, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 12 }}>PSYCHOLOGY INSIGHTS — WHAT TO DO WITH THIS DATA</div>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
                            {psychInsights.map((ins, i) => (
                              <PsychInsightCard key={i} icon={ins.icon} title={ins.title} body={ins.body} type={ins.type} />
                            ))}
                          </div>
                        </div>
                      ) : null;
                    })()}

                    {/* Empty state */}
                    {moodRows.length === 0 && confRows.length === 0 && tagRows.length === 0 && (
                      <p style={{ color: C.muted, fontSize: 12, textAlign: "center", padding: "20px 0" }}>
                        Tag your trades with mood, confidence, and emotional state to unlock psychology insights.
                      </p>
                    )}
                  </SectionCard>
                </div>
              )}

              {/* ── Repeated Mistakes Feed ───────────────────────── */}
              {aiInsights?.mistakeFeed?.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <SectionCard title="Repeated Mistakes" subtitle="YOUR MOST COSTLY PATTERNS" delay={0.6} accentColor={C.bear}>
                    <div style={{ fontSize: 11, color: C.muted, marginBottom: 14, lineHeight: 1.6 }}>
                      These are your self-tagged mistakes ranked by total P&L cost. Fixing the top one is worth more than finding new setups.
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {aiInsights.mistakeFeed.map((m, i) => {
                        const isLoss = m.totalPnl < 0;
                        const rankColors = ["#DC2626", "#EA580C", "#D97706", "#65A30D", "#0284C7"];
                        const rankColor = rankColors[i] || C.muted;
                        return (
                          <div key={m.tag} style={{ borderRadius: 12, border: `1px solid ${rankColor}22`, background: `${rankColor}06`, padding: "14px 16px" }}>
                            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
                                <div style={{ width: 28, height: 28, borderRadius: 8, background: `${rankColor}18`, border: `1.5px solid ${rankColor}44`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 900, color: rankColor, flexShrink: 0, fontFamily: "'JetBrains Mono',monospace" }}>
                                  {i + 1}
                                </div>
                                <div>
                                  <div style={{ fontSize: 13, fontWeight: 800, color: C.primary }}>{m.tag}</div>
                                  <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{m.count} occurrence{m.count !== 1 ? "s" : ""} · avg ${Math.abs(m.avgPnl).toFixed(2)} {m.avgPnl < 0 ? "lost" : "made"} per trade</div>
                                </div>
                              </div>
                              <div style={{ textAlign: "right", flexShrink: 0 }}>
                                <div style={{ fontSize: 15, fontWeight: 900, color: isLoss ? C.bear : C.bull, fontFamily: "'JetBrains Mono',monospace" }}>
                                  {isLoss ? "-" : "+"}${Math.abs(m.totalPnl).toFixed(2)}
                                </div>
                                <div style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>total cost</div>
                              </div>
                            </div>
                            {m.lessons?.length > 0 && (
                              <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${rankColor}20` }}>
                                <div style={{ fontSize: 9, fontWeight: 700, color: rankColor, letterSpacing: "0.1em", marginBottom: 6 }}>LESSON LOGGED</div>
                                <div style={{ fontSize: 11, color: "#374151", fontStyle: "italic", lineHeight: 1.6 }}>"{m.lessons[0]}"</div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </SectionCard>
                </div>
              )}

              {/* ── Discipline Trend + Revenge/Tilt ──────────────── */}
              {aiInsights?.weeklyDisciplineTrend?.length > 1 && (
                <div style={{ marginBottom: 24 }}>
                  <div className="analytics-section-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>

                    {/* Discipline Trend */}
                    <SectionCard title="Discipline Trend" subtitle="WEEKLY PLAN ADHERENCE" delay={0.62} accentColor={C.gold}>
                      <div style={{ fontSize: 11, color: C.muted, marginBottom: 12 }}>% of trades following your plan each week</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {aiInsights.weeklyDisciplineTrend.slice(-8).map((w, i, arr) => {
                          const pct = w.planAdherencePct;
                          const barColor = pct >= 70 ? C.bull : pct >= 40 ? C.gold : C.bear;
                          const weekLabel = w.week.replace(/^\d{4}-/, "");
                          const isLatest = i === arr.length - 1;
                          const prevPct = i > 0 ? arr[i - 1].planAdherencePct : null;
                          const trend = prevPct !== null ? (pct > prevPct ? "▲" : pct < prevPct ? "▼" : "—") : "";
                          const trendColor = trend === "▲" ? C.bull : trend === "▼" ? C.bear : C.muted;
                          return (
                            <div key={w.week} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <div style={{ fontSize: 9, fontFamily: "'JetBrains Mono',monospace", color: isLatest ? C.primary : C.muted, width: 48, flexShrink: 0, fontWeight: isLatest ? 700 : 400 }}>{weekLabel}</div>
                              <div style={{ flex: 1, height: 6, background: "#F4F2EE", borderRadius: 99, overflow: "hidden" }}>
                                <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", background: barColor, borderRadius: 99, transition: "width 0.4s" }} />
                              </div>
                              <div style={{ fontSize: 10, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: barColor, width: 36, textAlign: "right" }}>{pct}%</div>
                              <div style={{ fontSize: 9, color: trendColor, width: 12 }}>{trend}</div>
                              <div style={{ fontSize: 9, fontFamily: "'JetBrains Mono',monospace", color: w.pnl >= 0 ? C.bull : C.bear, width: 54, textAlign: "right" }}>{w.pnl >= 0 ? "+" : ""}${Math.abs(w.pnl).toFixed(0)}</div>
                            </div>
                          );
                        })}
                      </div>
                      {(() => {
                        const trend = aiInsights.weeklyDisciplineTrend.slice(-4);
                        if (trend.length < 2) return null;
                        const first = trend[0].planAdherencePct;
                        const last = trend[trend.length - 1].planAdherencePct;
                        const delta = last - first;
                        if (Math.abs(delta) < 5) return null;
                        return (
                          <div style={{ marginTop: 12, padding: "8px 12px", borderRadius: 8, background: delta > 0 ? "#F0FDF4" : "#FFF8F8", border: `1px solid ${delta > 0 ? "#BBF7D0" : "#FED7D7"}`, fontSize: 11, color: delta > 0 ? "#166534" : "#9B1C1C" }}>
                            {delta > 0 ? "▲" : "▼"} Discipline {delta > 0 ? "improving" : "declining"} {Math.abs(delta).toFixed(0)}pp over last 4 weeks
                          </div>
                        );
                      })()}
                    </SectionCard>

                    {/* Revenge / Tilt Alerts */}
                    <SectionCard title="Revenge & Tilt Alerts" subtitle="EMOTIONAL SPIRAL DETECTION" delay={0.64} accentColor={C.bear}>
                      {/* Revenge trades */}
                      <div style={{ marginBottom: 16 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                          <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: "0.08em" }}>REVENGE TRADES</div>
                          <div style={{
                            fontSize: 18, fontWeight: 900, fontFamily: "'JetBrains Mono',monospace",
                            color: (aiInsights.behaviorDiscipline?.revengeTradesCount || 0) > 0 ? C.bear : C.bull,
                          }}>
                            {aiInsights.behaviorDiscipline?.revengeTradesCount || 0}
                          </div>
                        </div>
                        {(aiInsights.behaviorDiscipline?.revengeTradesCount || 0) > 0 ? (
                          <>
                            <div style={{ fontSize: 11, color: "#374151", lineHeight: 1.6, marginBottom: 8 }}>
                              Trades taken immediately after a loss with 1.5× bigger risk. Total cost:{" "}
                              <span style={{ fontWeight: 700, color: C.bear, fontFamily: "'JetBrains Mono',monospace" }}>
                                ${Math.abs(parseFloat(aiInsights.behaviorDiscipline.revengeCostTotal || 0)).toFixed(2)}
                              </span>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                              {(aiInsights.behaviorDiscipline.revengeTrades || []).slice(-3).map((t, i) => (
                                <div key={i} style={{ fontSize: 10, color: C.muted, display: "flex", justifyContent: "space-between", padding: "4px 8px", background: "#FFF8F8", borderRadius: 6, border: "1px solid #FED7D7" }}>
                                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 600 }}>{t.pair}</span>
                                  <span>{new Date(t.createdAt).toLocaleDateString()}</span>
                                  <span style={{ color: C.bear, fontWeight: 700 }}>${Math.abs(t.prevProfit || 0).toFixed(2)} trigger loss</span>
                                </div>
                              ))}
                            </div>
                            <div style={{ marginTop: 8, fontSize: 10, fontWeight: 700, color: C.bear }}>Rule: After a loss, wait 15 min before taking another trade.</div>
                          </>
                        ) : (
                          <div style={{ fontSize: 11, color: C.bull, fontWeight: 600 }}>✓ No revenge trades detected — strong emotional control.</div>
                        )}
                      </div>

                      {/* Tilt days */}
                      <div style={{ borderTop: "1px solid #F4F2EE", paddingTop: 14 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                          <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: "0.08em" }}>TILT DAYS</div>
                          <div style={{
                            fontSize: 18, fontWeight: 900, fontFamily: "'JetBrains Mono',monospace",
                            color: (aiInsights.psychologicalPatterns?.tiltDays?.length || 0) > 0 ? C.bear : C.bull,
                          }}>
                            {aiInsights.psychologicalPatterns?.tiltDays?.length || 0}
                          </div>
                        </div>
                        {(aiInsights.psychologicalPatterns?.tiltDays?.length || 0) > 0 ? (
                          <>
                            <div style={{ fontSize: 11, color: "#374151", lineHeight: 1.6, marginBottom: 8 }}>
                              Days with 3+ consecutive losses + increasing position size detected.
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                              {aiInsights.psychologicalPatterns.tiltDays.slice(-3).map((td, i) => (
                                <div key={i} style={{ fontSize: 10, color: C.muted, display: "flex", justifyContent: "space-between", padding: "4px 8px", background: "#FFF8F8", borderRadius: 6, border: "1px solid #FED7D7" }}>
                                  <span>{td.day}</span>
                                  <span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{td.streakLength} losses</span>
                                  <span style={{ color: C.bear, fontWeight: 700 }}>-${Math.abs(parseFloat(td.totalLoss)).toFixed(2)}</span>
                                </div>
                              ))}
                            </div>
                            <div style={{ marginTop: 8, fontSize: 10, fontWeight: 700, color: C.bear }}>Rule: Stop trading after 3 consecutive losses.</div>
                          </>
                        ) : (
                          <div style={{ fontSize: 11, color: C.bull, fontWeight: 600 }}>✓ No tilt days detected — great discipline.</div>
                        )}
                      </div>
                    </SectionCard>
                  </div>
                </div>
              )}

              {/* ── AI Insights ───────────────────────────────────── */}
              {aiInsights?.insights?.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <SectionCard title="AI Insights" subtitle="AUTOMATED ANALYSIS" delay={0.7} accentColor={C.bull}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 0 }}>
                      {aiInsights.insights.slice(0, 6).map((insight, i) => (
                        <InsightTag key={i} text={insight} type={classifyInsight(insight)} />
                      ))}
                    </div>
                  </SectionCard>
                </div>
              )}
            </>
          )}

          {/* ── No data state ──────────────────────────────────── */}
          {!has && !loading && (
            <div style={{ textAlign: "center", padding: "80px 20px", color: C.muted }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.primary, marginBottom: 8 }}>No trades yet</div>
              <div style={{ fontSize: 13, marginBottom: 24 }}>Upload your first trade to unlock analytics.</div>
              <Link href="/upload-trade" style={{ display: "inline-block", background: C.bull, color: "#FFFFFF", padding: "12px 24px", borderRadius: 10, textDecoration: "none", fontSize: 13, fontWeight: 700 }}>
                Upload First Trade
              </Link>
            </div>
          )}
        </main>
      </div>

      <style jsx global>{`
        @keyframes fadeUp { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
        * { box-sizing: border-box; }
        @media (max-width: 640px) {
          main { padding: 14px !important; }
          .analytics-kpi-grid   { grid-template-columns: repeat(2, 1fr) !important; gap: 10px !important; }
          .analytics-section-grid { grid-template-columns: 1fr !important; }
          .analytics-psych-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .analytics-psych-sub  { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 360px) {
          .analytics-kpi-grid { grid-template-columns: 1fr !important; }
          .analytics-psych-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

export default function AnalyticsPage() {
  return (
    <ErrorBoundary fallback={<div style={{ padding: "2rem", textAlign: "center" }}>Analytics failed to load. Please refresh.</div>}>
      <Suspense><AnalyticsContent /></Suspense>
    </ErrorBoundary>
  );
}
