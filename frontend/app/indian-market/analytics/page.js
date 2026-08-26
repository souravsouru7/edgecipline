"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRequireAuth } from "@/features/auth/hooks/useRequireAuth";
import {
  getAnalyticsSnapshot
} from "@/services/analyticsApi";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  AreaChart,
  Area
} from "recharts";
import IndianMarketHeader from "@/components/IndianMarketHeader";
import IndianMarketLoadingState from "@/components/IndianMarketLoadingState";
import { MARKETS } from "@/context/MarketContext";
import CalendarPnL from "@/features/analytics/components/CalendarPnL";
import PatternInsightsCard from "@/features/analytics/components/PatternInsightsCard";

const theme = {
  bull: "#0D9E6E",
  bear: "#D63B3B",
  gold: "#B8860B",
  primary: "#0D9E6E",
  secondary: "#0F1923",
  muted: "#94A3B8",
  border: "#E2E8F0",
  bg: "#F0EEE9",
  card: "#FFFFFF"
};

const s = (...codes) => String.fromCharCode(...codes);
const mojibakeTokenPattern = new RegExp(
  `(?:${s(0x00f0, 0x0178)}|${s(0x00ef, 0x00b8)}|${s(0x00c3)}|${s(0x00c2)}|${s(0x00e2)})[^\\s]*`,
  "g"
);

const cleanPsychText = (value = "") =>
  String(value ?? "")
    .replace(mojibakeTokenPattern, "")
    .replace(/\s+/g, " ")
    .trim();

function StatCard({ label, value, sub, color, delay = 0, tooltip }) {
  const [showTip, setShowTip] = useState(false);
  return (
    <div
      className="premium-card"
      onMouseEnter={() => setShowTip(true)}
      onMouseLeave={() => setShowTip(false)}
      style={{
        background: theme.card,
        borderRadius: 12,
        border: `1px solid ${theme.border}`,
        padding: 20,
        minWidth: 0,
        animation: `fadeUp 0.5s ease ${delay}s both`,
        boxShadow: "0 2px 12px rgba(15,25,35,0.06)",
        transition: "transform 0.2s, box-shadow 0.2s",
        position: "relative",
        overflow: "visible"
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 700, color: theme.muted, letterSpacing: "0.12em", marginBottom: 10, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 4 }}>
        {label}
        {tooltip && (
          <span style={{ width: 13, height: 13, borderRadius: "50%", background: "#E2E8F0", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 900, color: "#64748B", cursor: "help", flexShrink: 0 }}>?</span>
        )}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color, letterSpacing: "-0.02em", fontFamily: "'JetBrains Mono',monospace", lineHeight: 1.2 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: theme.muted, marginTop: 6, fontWeight: 500, letterSpacing: "0.04em" }}>{sub}</div>}
      {tooltip && showTip && (
        <div style={{
          position: "absolute",
          bottom: "calc(100% + 8px)",
          left: "50%",
          transform: "translateX(-50%)",
          background: "#0F1923",
          color: "#E2E8F0",
          fontSize: 11,
          padding: "10px 14px",
          borderRadius: 10,
          width: 220,
          zIndex: 200,
          lineHeight: 1.6,
          pointerEvents: "none",
          boxShadow: "0 8px 24px rgba(0,0,0,0.25)"
        }}>
          {tooltip}
          <div style={{ position: "absolute", bottom: -5, left: "50%", transform: "translateX(-50%)", width: 10, height: 10, background: "#0F1923", clipPath: "polygon(0 0, 100% 0, 50% 100%)" }} />
        </div>
      )}
      <style jsx>{`
        .premium-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 16px rgba(15,25,35,0.08);
        }
      `}</style>
    </div>
  );
}

function SmallStat({ label, value, color, sub, tooltip }) {
  const [showTip, setShowTip] = useState(false);
  return (
    <div
      onMouseEnter={() => setShowTip(true)}
      onMouseLeave={() => setShowTip(false)}
      style={{ flex: "1 1 140px", background: theme.card, borderRadius: 12, border: `1px solid ${theme.border}`, padding: "14px 16px", position: "relative", cursor: "default" }}
    >
      <div style={{ fontSize: 9, fontWeight: 700, color: theme.muted, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}>
        {label}
        {tooltip && <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#E2E8F0", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 7, fontWeight: 900, color: "#64748B", cursor: "help", flexShrink: 0 }}>?</span>}
      </div>
      <div style={{ fontSize: 18, fontWeight: 900, color, letterSpacing: "-0.01em" }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: theme.muted, marginTop: 4 }}>{sub}</div>}
      {tooltip && showTip && (
        <div style={{ position: "absolute", bottom: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)", background: "#0F1923", color: "#E2E8F0", fontSize: 10, padding: "8px 12px", borderRadius: 8, width: 200, zIndex: 200, lineHeight: 1.6, pointerEvents: "none", boxShadow: "0 8px 24px rgba(0,0,0,0.25)" }}>
          {tooltip}
        </div>
      )}
    </div>
  );
}

function TipCell({ label, value, color, tip }) {
  const [show, setShow] = useState(false);
  return (
    <div onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)} style={{ position: "relative", cursor: "default" }}>
      <div style={{ color: theme.muted, fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
        {label}
        <span style={{ width: 11, height: 11, borderRadius: "50%", background: "#E2E8F0", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 7, fontWeight: 900, color: "#64748B", cursor: "help", flexShrink: 0 }}>?</span>
      </div>
      <div style={{ fontWeight: 700, color: color || "inherit", fontSize: 12 }}>{value}</div>
      {tip && show && (
        <div style={{ position: "absolute", bottom: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)", background: "#0F1923", color: "#E2E8F0", fontSize: 10, padding: "8px 12px", borderRadius: 8, width: 200, zIndex: 300, lineHeight: 1.6, pointerEvents: "none", boxShadow: "0 8px 24px rgba(0,0,0,0.25)" }}>
          {tip}
          <div style={{ position: "absolute", bottom: -5, left: "50%", transform: "translateX(-50%)", width: 10, height: 10, background: "#0F1923", clipPath: "polygon(0 0, 100% 0, 50% 100%)" }} />
        </div>
      )}
    </div>
  );
}

function HoverBox({ tip, style, children }) {
  const [show, setShow] = useState(false);
  return (
    <div onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)} style={{ position: "relative", ...style }}>
      {children}
      {tip && show && (
        <div style={{ position: "absolute", bottom: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)", background: "#0F1923", color: "#E2E8F0", fontSize: 10, padding: "8px 12px", borderRadius: 8, width: 210, zIndex: 300, lineHeight: 1.6, pointerEvents: "none", boxShadow: "0 8px 24px rgba(0,0,0,0.25)" }}>
          {tip}
          <div style={{ position: "absolute", bottom: -5, left: "50%", transform: "translateX(-50%)", width: 10, height: 10, background: "#0F1923", clipPath: "polygon(0 0, 100% 0, 50% 100%)" }} />
        </div>
      )}
    </div>
  );
}

function DistList({ title, data, currency = "₹", maxItems = 6 }) {
  if (!data || Object.keys(data).length === 0) return null;
  const entries = Object.entries(data)
    .filter((entry) => entry[1].total > 0)
    .sort((a, b) => parseFloat(b[1].profit) - parseFloat(a[1].profit))
    .slice(0, maxItems);
  if (entries.length === 0) return null;
  return (
    <div style={{ marginBottom: title ? 20 : 0 }}>
      {title && <div style={{ fontSize: 11, fontWeight: 700, color: theme.muted, letterSpacing: "0.08em", marginBottom: 10 }}>{title}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {entries.map(([name, v]) => (
          <div key={name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${theme.border}` }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{name}</span>
            <span style={{ fontSize: 11, color: theme.muted, marginRight: 8 }}>{v.winRate}% WR</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: parseFloat(v.profit) >= 0 ? theme.bull : theme.bear }}>
              {parseFloat(v.profit) >= 0 ? "+" : "-"}{currency}{parseFloat(v.profit).toFixed(0)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Generate actionable psychology insights ───────────────────────────────────
function generatePsychInsights({ moodRows, confRows, tagRows, wouldRetakeAnalysis, disciplineScore, currency = "₹" }) {
  const insights = [];
  if (moodRows.length >= 2) {
    const sorted = [...moodRows].sort((a, b) => parseFloat(b.avgProfit) - parseFloat(a.avgProfit));
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    if (best && parseFloat(best.avgProfit) > 0)
      insights.push({ type: "success", icon: "PSY", title: `Trade best when ${cleanPsychText(best.label)}`, body: `${best.winRate}% win rate · avg +${currency}${parseFloat(best.avgProfit).toFixed(2)} per trade. Prioritize setups in this mental state.` });
    if (worst && parseFloat(worst.avgProfit) < 0 && worst.trades >= 2)
      insights.push({ type: "danger", icon: "!", title: `Avoid trading when ${cleanPsychText(worst.label)}`, body: `${worst.winRate}% win rate · avg ${currency}${parseFloat(worst.avgProfit).toFixed(2)} per trade across ${worst.trades} trades. Step away or reduce size.` });
  }
  const highConf = confRows.find(c => c.level === "High" || c.level === "Overconfident");
  const lowConf  = confRows.find(c => c.level === "Low");
  if (highConf && parseFloat(highConf.avgProfit) < 0 && highConf.trades >= 2)
    insights.push({ type: "warning", icon: "!", title: "High confidence -> losing trades", body: `Your "High" confidence trades average ${currency}${parseFloat(highConf.avgProfit).toFixed(2)}. Overconfidence may be causing oversizing or skipping confirmation.` });
  if (lowConf && parseFloat(lowConf.avgProfit) > 0 && lowConf.trades >= 2)
    insights.push({ type: "success", icon: "IDEA", title: "Low confidence trades are profitable", body: `Cautious entries average +${currency}${parseFloat(lowConf.avgProfit).toFixed(2)}. Your hesitation signals good instincts - trust them.` });
  const dangerTags = ["FOMO", "Revenge", "Fear", "Greed", "Rushed", "Frustrated"];
  tagRows.forEach(t => {
    if (dangerTags.includes(t.tag) && parseFloat(t.avgProfit) < 0 && t.trades >= 1)
      insights.push({ type: "danger", icon: "X", title: `${t.tag} trades cost you money`, body: `${t.trades} trade${t.trades > 1 ? "s" : ""} · ${t.winRate}% WR · avg ${currency}${parseFloat(t.avgProfit).toFixed(2)}. Rule: when you feel ${t.tag.toLowerCase()}, close the platform.` });
  });
  tagRows.forEach(t => {
    if (!dangerTags.includes(t.tag) && parseFloat(t.avgProfit) > 5 && parseFloat(t.winRate) >= 70 && t.trades >= 2)
      insights.push({ type: "success", icon: "OK", title: `${t.tag} state is your edge`, body: `${t.trades} trades · ${t.winRate}% WR · avg +${currency}${parseFloat(t.avgProfit).toFixed(2)}. Seek more trades in this mindset.` });
  });
  const yes = wouldRetakeAnalysis?.yes;
  const no  = wouldRetakeAnalysis?.no;
  if (yes && no && yes.trades >= 2 && no.trades >= 2) {
    const yesPnl = parseFloat(yes.avgProfit), noPnl = parseFloat(no.avgProfit);
    if (yesPnl > 0 && noPnl < 0)
      insights.push({ type: "success", icon: "NOTE", title: "Your trade instincts are calibrated", body: `Trades you'd retake avg +${currency}${yesPnl.toFixed(2)} vs trades you'd skip avg ${currency}${noPnl.toFixed(2)}. Your gut is telling you the right thing - listen to it before entry.` });
    else if (yesPnl < 0)
      insights.push({ type: "warning", icon: "NOTE", title: "Retake instinct may need recalibration", body: `Even trades you'd retake are losing (avg ${currency}${yesPnl.toFixed(2)}). Review your entry criteria - the setups themselves may be flawed.` });
  }
  if (typeof disciplineScore === "number" && disciplineScore > 0) {
    if (disciplineScore >= 80)
      insights.push({ type: "success", icon: "WIN", title: `Strong discipline score: ${disciplineScore}%`, body: "You're following your rules consistently. Keep protecting this score - it's your moat against emotional trading." });
    else if (disciplineScore < 50)
      insights.push({ type: "danger", icon: "DOWN", title: `Discipline score at ${disciplineScore}%`, body: "Less than half your trades follow your plan. Focus on process over outcome: one disciplined loss beats one undisciplined win." });
  }
  return insights.slice(0, 6);
}

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

function PathToAdvanced({ summary, ai, perf, quality, psychology, currency }) {
  const totalTrades = summary?.totalTrades ?? 0;
  const totalProfit = parseFloat(summary?.totalProfit || 0);
  const winRate = parseFloat(summary?.winRate || 0);
  const planPct = parseFloat(ai?.behaviorDiscipline?.ruleEmotion?.planPct || 0);
  const aiScore = parseFloat(ai?.score || 0);
  const profitFactor = parseFloat(perf?.profitFactor || 0);
  const qualityScore = parseFloat(quality?.qualityScore || 0);
  const psychologyScore = parseFloat(psychology?.psychologyScore || 0);

  const checks = [
    { label: "Log at least 5 trades with details (trading setup, entry basis)", done: totalTrades >= 5, value: `${totalTrades} / 5` },
    { label: "Log at least 10 trades for advanced insights", done: totalTrades >= 10, value: `${totalTrades} / 10` },
    { label: "Win rate ≥ 50%", done: winRate >= 50, value: `${winRate}%` },
    { label: "Total P&L positive", done: totalProfit > 0, value: `${currency}${totalProfit.toFixed(0)}` },
    { label: "Plan-based entries ≥ 70%", done: planPct >= 70, value: `${planPct}%` },
    { label: "AI discipline score ≥ 60", done: aiScore >= 60, value: `${aiScore}` },
    { label: "Profit factor ≥ 1.2", done: profitFactor >= 1.2, value: profitFactor.toFixed(2) },
    { label: "Quality score ≥ 70", done: qualityScore >= 70, value: `${qualityScore}` },
    { label: "Psychology score ≥ 60", done: psychologyScore >= 60, value: `${psychologyScore}` }
  ];
  const doneCount = checks.filter((c) => c.done).length;
  const totalCount = checks.length;
  const percent = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;
  const isAdvanced = doneCount >= 5 && totalProfit > 0 && winRate >= 50;

  return (
    <div
      style={{
        background: isAdvanced ? "linear-gradient(135deg, rgba(22,163,74,0.08), rgba(22,163,74,0.02))" : "linear-gradient(135deg, rgba(251,191,36,0.08), rgba(251,191,36,0.02))",
        border: `2px solid ${isAdvanced ? theme.bull : theme.gold}`,
        borderRadius: 16,
        padding: 24,
        marginBottom: 24
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: theme.primary }}>Path to Advanced & Profitable</div>
          <div style={{ fontSize: 11, color: theme.muted, marginTop: 4 }}>
            Complete these to unlock advanced-level analytics and build a profitable edge.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 28, fontWeight: 900, color: isAdvanced ? theme.bull : theme.gold }}>{percent}%</div>
          <div style={{ width: 100, height: 10, background: theme.border, borderRadius: 5, overflow: "hidden" }}>
            <div style={{ width: `${percent}%`, height: "100%", background: isAdvanced ? theme.bull : theme.gold, borderRadius: 5, transition: "width 0.5s ease" }} />
          </div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
        {checks.map((c, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 14px",
              background: c.done ? "rgba(22,163,74,0.08)" : "rgba(0,0,0,0.02)",
              borderRadius: 10,
              border: `1px solid ${c.done ? theme.bull + "44" : theme.border}`
            }}
          >
            <span style={{ fontSize: 18, flexShrink: 0 }}>{c.done ? "✓" : "○"}</span>
            <span style={{ fontSize: 12, color: theme.primary, flex: 1 }}>{c.label}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: c.done ? theme.bull : theme.muted }}>{c.value}</span>
          </div>
        ))}
      </div>
      {isAdvanced && (
        <div style={{ marginTop: 16, padding: "12px 16px", background: "rgba(22,163,74,0.15)", borderRadius: 10, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 900, fontFamily: "'JetBrains Mono',monospace" }}>WIN</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: theme.bull }}>Advanced level unlocked</div>
            <div style={{ fontSize: 11, color: theme.secondary }}>You are building a data-driven edge. Keep logging trades and reviewing analytics to stay profitable.</div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProgressBar({ value, max = 100, color = theme.bull, label }) {
  const safeMax = max || 1;
  const pct = Math.min(100, Math.max(0, (Number(value) / safeMax) * 100));

  return (
    <div style={{ marginBottom: 12 }}>
      {label && (
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: theme.muted, fontWeight: 700 }}>{label}</span>
          <span style={{ fontSize: 11, color, fontWeight: 800, fontFamily: "'JetBrains Mono',monospace" }}>{pct.toFixed(1)}%</span>
        </div>
      )}
      <div style={{ height: 8, background: "#F0EEE9", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: `linear-gradient(90deg, ${color}, ${color}88)`, borderRadius: 4, transition: "width 0.6s ease" }} />
      </div>
    </div>
  );
}

function ListItem({ label, value, color = theme.primary, sub }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${theme.border}` }}>
      <div style={{ maxWidth: "70%" }}>
        <div style={{ fontSize: 12, color: theme.secondary, fontWeight: 600 }}>{label}</div>
        {sub && <div style={{ fontSize: 10, color: theme.muted, marginTop: 2 }}>{sub}</div>}
      </div>
      <div style={{ fontSize: 13, fontWeight: 900, color, fontFamily: "'JetBrains Mono',monospace" }}>{value}</div>
    </div>
  );
}

export default function IndianAnalyticsPage() {
  const { ready } = useRequireAuth();
  const [loading, setLoading] = useState(true);
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const lastMonthNavAtRef = useRef(0);
  const shiftCalendarMonth = (amount) => {
    const now = Date.now();
    if (now - lastMonthNavAtRef.current < 220) return;
    lastMonthNavAtRef.current = now;
    setCalendarMonth((d) => new Date(d.getFullYear(), d.getMonth() + amount, 1));
  };
  const prevMonth = () => shiftCalendarMonth(-1);
  const nextMonth = () => shiftCalendarMonth(1);
  const [instrumentType, setInstrumentType] = useState("OPTION");
  const [data, setData] = useState({
    summary: null,
    rr: null,
    perf: null,
    time: null,
    drawdown: null,
    ai: null,
    breakdown: null,
    distribution: null,
    quality: null,
    psychology: null,
    patterns: null
  });
  const [timeFilter, setTimeFilter] = useState("daily"); // daily, weekly, monthly

  useEffect(() => {
    if (!ready) return;
    fetchData(instrumentType);
  }, [ready, instrumentType]);

  const switchInstrumentType = (type) => {
    if (type === instrumentType) return;
    setInstrumentType(type);
  };

  const fetchData = async (itType = "OPTION") => {
    setLoading(true);
    try {
      const snapshot = await getAnalyticsSnapshot(MARKETS.INDIAN_MARKET, itType, { period: "weekly" });
      setData({
        summary: snapshot?.summary || null,
        rr: snapshot?.riskReward || null,
        perf: snapshot?.performance || null,
        time: snapshot?.timeAnalysis || null,
        drawdown: snapshot?.drawdown || null,
        ai: snapshot?.aiInsights || snapshot?.coachFeed || null,
        breakdown: snapshot?.pnlBreakdown || null,
        distribution: snapshot?.distribution || null,
        quality: snapshot?.quality || snapshot?.tradeQualityAnalysis || null,
        psychology: snapshot?.psychology || null,
        patterns: snapshot?.patterns || null,
        snapshot,
      });
    } catch (error) {
      if (error?.status === 401 || error?.data?.errorCode === "AUTH_REQUIRED") {
        return;
      }
      console.warn("Failed to fetch Indian analytics data:", error?.message || error);
    } finally {
      setLoading(false);
    }
  };

  const currency = "₹";
  const totalTrades = parseFloat(data.summary?.totalTrades || 0);
  const hasAnyTrades = totalTrades > 0;
  const pnlReadyTrades = parseFloat(data.summary?.pnlReadyTrades || 0);
  const tradesMissingPnl = parseFloat(data.summary?.tradesMissingPnl || 0);
  const hasPnlData = pnlReadyTrades > 0;
  const hasEnoughTrades = totalTrades >= 5;
  const tradesWithRR = parseFloat(data.quality?.tradesWithRR || 0);
  const hasRRFields = hasEnoughTrades && tradesWithRR > 0;
  // Two very different reasons the quality panel can be blank, and the copy used
  // to blame the wrong one: with 3 fully-planned trades it still said "add RR
  // fields". Say which gate is actually open.
  const rrGateReason = !hasEnoughTrades
    ? `Need 5+ trades (${totalTrades}/5 logged)`
    : tradesWithRR === 0
      ? "Add entry price, stop loss and take profit"
      : null;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#F4F2EE",
        fontFamily: "'Plus Jakarta Sans',sans-serif",
        color: theme.primary
      }}
    >
      <IndianMarketHeader />

      <main style={{ padding: "28px 24px", maxWidth: 1200, width: "100%", boxSizing: "border-box", margin: "0 auto" }}>
        <div className="indian-analytics-title" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: theme.secondary, letterSpacing: "-0.02em", margin: 0 }}>Analytics</h1>
            <p style={{ fontSize: 12, color: theme.muted, fontFamily: "'JetBrains Mono',monospace", margin: "4px 0 0", letterSpacing: "0.04em" }}>
              {instrumentType === "EQUITY" ? "Intraday stocks performance" : "Options performance"}
            </p>
          </div>
          <Link href="/indian-market/trades" style={{ fontSize: 12, color: theme.secondary, border: `1px solid ${theme.border}`, borderRadius: 8, padding: "8px 14px", textDecoration: "none", fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, background: "#FFFFFF" }}>
            Trade Log
          </Link>
        </div>

        {/* Instrument type tab bar */}
        <div className="indian-analytics-tabs" style={{ display: "flex", gap: 4, marginBottom: 24, borderRadius: 10, border: `1px solid ${theme.border}`, width: "fit-content", padding: 4, background: "#FFFFFF" }}>
          {[{ v: "OPTION", label: "Options Analytics" }, { v: "EQUITY", label: "Intraday Stocks" }].map(({ v, label }) => (
            <button
              key={v}
              type="button"
              onClick={() => switchInstrumentType(v)}
              style={{
                padding: "8px 16px",
                border: "none",
                borderRadius: 7,
                background: instrumentType === v ? theme.secondary : "transparent",
                color: instrumentType === v ? "#FFFFFF" : theme.muted,
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
                transition: "all 0.15s",
                fontFamily: "'Plus Jakarta Sans',sans-serif"
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <IndianMarketLoadingState
            title={`Loading ${instrumentType === "EQUITY" ? "stock" : "options"} analytics`}
            subtitle="Preparing your Indian Market performance data"
          />
        ) : (
          <>
            {hasAnyTrades && tradesMissingPnl > 0 && (
              <div style={{
                marginBottom: 18,
                padding: "14px 16px",
                borderRadius: 12,
                border: "1px solid rgba(184,134,11,0.35)",
                background: "rgba(184,134,11,0.08)",
                color: theme.secondary,
                fontSize: 12,
                lineHeight: 1.6,
                fontWeight: 650
              }}>
                {tradesMissingPnl} trade{tradesMissingPnl === 1 ? "" : "s"} need P&L details before analytics can calculate win rate, net P&L, and charts. Open the trade log, edit those trades, and fill quantity, lot size, entry, exit, P&L, mood, confidence, and trade quality.
              </div>
            )}
            {/* TOP SUMMARY ROW */}
            <div className="indian-analytics-kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, marginBottom: 14 }}>
              <StatCard
                label="TOTAL P&L"
                value={hasPnlData ? `${currency}${parseFloat(data.summary?.totalProfit || 0).toLocaleString("en-IN")}` : "—"}
                color={hasPnlData ? (parseFloat(data.summary?.totalProfit || 0) >= 0 ? theme.bull : theme.bear) : theme.secondary}
                sub={hasPnlData ? `${pnlReadyTrades} trade${pnlReadyTrades === 1 ? "" : "s"} analyzed` : "Fill P&L details to compute"}
                tooltip="Sum of all your trade profits and losses (gross, before brokerage and taxes). Green = net profitable, Red = net loss."
              />
              <StatCard
                label="NET AFTER COSTS"
                value={hasPnlData ? `${currency}${parseFloat(data.summary?.netProfit || 0).toLocaleString("en-IN")}` : "—"}
                color={hasPnlData ? (parseFloat(data.summary?.netProfit || 0) >= 0 ? theme.bull : theme.bear) : theme.secondary}
                sub={
                  hasPnlData
                    ? `Brokerage & taxes: ${currency}${parseFloat(data.summary?.totalCosts || 0).toLocaleString("en-IN")}`
                    : "Fill P&L details to compute"
                }
                tooltip="Your real take-home P&L after deducting brokerage, STT, GST, and other trading costs. This is what actually hits your account."
              />
              <StatCard
                label="WIN RATE"
                value={hasPnlData ? `${data.summary?.winRate || 0}%` : "—"}
                color={hasPnlData ? (parseFloat(data.summary?.winRate || 0) >= 50 ? theme.bull : theme.bear) : theme.secondary}
                sub={hasPnlData ? `${data.summary?.winningTrades || 0} Wins / ${data.summary?.losingTrades || 0} Losses` : "Fill P&L details to compute win rate"}
                tooltip="Percentage of trades that closed in profit. A win rate above 50% is green. Remember: high win rate alone doesn't mean profitability — R:R matters too."
              />
              <StatCard
                label="TOTAL TRADES"
                value={String(totalTrades)}
                color={theme.secondary}
                sub="trades logged"
                tooltip="Total number of trades logged for the selected Indian Market instrument."
              />
            </div>

            {/* SECONDARY STATS ROW */}
            {hasAnyTrades && (
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 }}>
                <SmallStat label="AVG WIN" value={`${currency}${parseFloat(data.perf?.avgWin || 0).toLocaleString("en-IN")}`} color={theme.bull} tooltip="Average profit per winning trade. Compare this with Avg Loss to understand your R:R in practice." />
                <SmallStat label="AVG LOSS" value={`${currency}${Math.abs(parseFloat(data.perf?.avgLoss || 0)).toLocaleString("en-IN")}`} color={theme.bear} tooltip="Average loss per losing trade. Ideally Avg Win should be at least 1.5× your Avg Loss." />
                <SmallStat label="AVG TRADE" value={`${currency}${parseFloat(data.summary?.avgTrade || 0).toFixed(2)}`} color={parseFloat(data.summary?.avgTrade || 0) >= 0 ? theme.bull : theme.bear} tooltip="Average P&L across every trade (wins + losses combined). Must be positive to be consistently profitable." />
                <SmallStat label="EXPECTANCY" value={`${data.rr?.expectancy || "0.00"} R`} color={parseFloat(data.rr?.expectancy || 0) >= 0 ? theme.bull : theme.bear} tooltip="Expected profit per trade in R units. Formula: (WinRate × AvgWin) − (LossRate × AvgLoss). Positive = you have an edge." />
                <SmallStat label="SETUP SCORE" value={data.summary?.avgSetupScore == null ? "—" : `${data.summary.avgSetupScore}/100`} color={theme.gold} tooltip="Average quality score across all your setups (0–100). Higher score = better pre-trade preparation and rule following." />
                <SmallStat label="COST-HIT TRADES" value={`${data.quality?.costImpactedTrades || 0}`} color={theme.bear} sub="Costs > gross profit" tooltip="Number of winning trades where brokerage + STT/taxes actually exceeded your gross profit. These trades hurt despite showing a 'win'." />
              </div>
            )}

            {/* P&L BREAKDOWN CHART */}
            <div
              style={{
                background: theme.card,
                borderRadius: 14,
                border: `1px solid ${theme.border}`,
                padding: 24,
                marginBottom: 24,
                boxShadow: "0 2px 10px rgba(15,23,42,0.05)"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 800 }}>P&L Breakdown</div>
                  <div style={{ fontSize: 11, color: theme.muted }}>Analyze your performance over time.</div>
                </div>
                <div style={{ display: "flex", gap: 4, background: theme.bg, padding: 4, borderRadius: 10 }}>
                  {["daily", "weekly", "monthly"].map((f) => (
                    <button
                      key={f}
                      onClick={() => setTimeFilter(f)}
                      style={{
                        padding: "6px 14px",
                        fontSize: 11,
                        fontWeight: 700,
                        borderRadius: 8,
                        border: "none",
                        cursor: "pointer",
                        background: timeFilter === f ? theme.card : "transparent",
                        color: timeFilter === f ? theme.primary : theme.muted,
                        boxShadow: timeFilter === f ? "0 2px 4px rgba(0,0,0,0.05)" : "none",
                        transition: "all 0.2s"
                      }}
                    >
                      {f.charAt(0).toUpperCase() + f.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ position: "relative", height: 350, width: "100%", marginTop: 10 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.breakdown?.[timeFilter] || []} margin={{ top: 20, right: 30, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={theme.bull} stopOpacity={0.4} />
                        <stop offset="95%" stopColor={theme.bull} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorLoss" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={theme.bear} stopOpacity={0.4} />
                        <stop offset="95%" stopColor={theme.bear} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorNegProfit" x1="0" y1="1" x2="0" y2="0">
                        <stop offset="5%" stopColor={theme.bear} stopOpacity={0.4} />
                        <stop offset="95%" stopColor={theme.bear} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="0" vertical={false} stroke="#E2E8F0" strokeOpacity={0.4} />
                    <XAxis
                      dataKey={timeFilter === "daily" ? "date" : timeFilter === "weekly" ? "week" : "month"}
                      fontSize={11}
                      fontWeight={600}
                      tickLine={false}
                      axisLine={false}
                      dy={10}
                      tick={{ fill: theme.muted }}
                      tickFormatter={(val) => (timeFilter === "daily" ? val.split("-").slice(2).join("/") : val)}
                    />
                    <YAxis 
                      fontSize={11} 
                      fontWeight={600} 
                      tickLine={false} 
                      axisLine={false} 
                      tick={{ fill: theme.muted }}
                      tickFormatter={(val) => `₹${Math.abs(val) >= 1000 ? (val/1000).toFixed(0) + 'k' : val}`} 
                    />
                    <Tooltip
                      cursor={{ stroke: theme.primary, strokeWidth: 1, strokeDasharray: '6 6', opacity: 0.3 }}
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const val = payload[0].value;
                          const label = payload[0].payload[timeFilter === "daily" ? "date" : timeFilter === "weekly" ? "week" : "month"];
                          return (
                            <div
                              style={{
                                background: "rgba(255, 255, 255, 0.9)",
                                backdropFilter: "blur(12px)",
                                border: `1px solid rgba(255, 255, 255, 0.5)`,
                                padding: "14px 20px",
                                borderRadius: 16,
                                boxShadow: "0 20px 40px -10px rgba(0, 0, 0, 0.15)",
                                display: "flex",
                                flexDirection: "column",
                                gap: 4
                              }}
                            >
                              <div style={{ fontSize: 10, color: theme.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>{label}</div>
                              <div style={{ fontSize: 22, fontWeight: 900, color: val >= 0 ? theme.bull : theme.bear }}>
                                {val >= 0 ? "+" : "-"}₹{Math.abs(val).toLocaleString("en-IN")}
                              </div>
                              <div style={{ fontSize: 9, color: theme.muted, fontStyle: "italic" }}>Model-verified performance</div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <ReferenceLine y={0} stroke={theme.border} strokeWidth={2} strokeDasharray="4 4" />
                    {(() => {
                      const chartData = data.breakdown?.[timeFilter] || [];
                      const totalPeriodProfit = chartData.reduce((sum, d) => sum + (d.profit || 0), 0);
                      const isPositive = totalPeriodProfit >= 0;
                      const lineColor = isPositive ? theme.bull : theme.bear;
                      const fillId = isPositive ? "colorProfit" : "colorNegProfit";
                      return (
                        <Area
                          type="monotone"
                          dataKey="profit"
                          stroke={lineColor}
                          strokeWidth={4}
                          fillOpacity={1}
                          fill={`url(#${fillId})`}
                          connectNulls
                          activeDot={{
                            r: 8,
                            fill: lineColor,
                            stroke: "#FFF",
                            strokeWidth: 3,
                            style: { filter: `drop-shadow(0 4px 8px ${lineColor}44)` }
                          }}
                        />
                      );
                    })()}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* EQUITY CURVE */}
            {Array.isArray(data.drawdown?.equityCurve) && data.drawdown.equityCurve.length > 1 && (
              <div style={{ background: theme.card, borderRadius: 14, border: `1px solid ${theme.border}`, padding: 24, marginBottom: 24, boxShadow: "0 2px 10px rgba(15,23,42,0.05)" }}>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 16, fontWeight: 800 }}>Equity Curve</div>
                  <div style={{ fontSize: 11, color: theme.muted, marginTop: 2 }}>Running cumulative P&L from your first trade to the latest — shows the health of your account growth.</div>
                </div>
                <div style={{ height: 200 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.drawdown.equityCurve.map((p, i) => ({ i: i + 1, balance: parseFloat(p.balance) }))} margin={{ top: 10, right: 20, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="eqPos" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={theme.bull} stopOpacity={0.35} />
                          <stop offset="95%" stopColor={theme.bull} stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="eqNeg" x1="0" y1="1" x2="0" y2="0">
                          <stop offset="5%" stopColor={theme.bear} stopOpacity={0.35} />
                          <stop offset="95%" stopColor={theme.bear} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="0" vertical={false} stroke="#E2E8F0" strokeOpacity={0.4} />
                      <XAxis dataKey="i" hide />
                      <YAxis fontSize={10} tickLine={false} axisLine={false} tick={{ fill: theme.muted }} tickFormatter={v => `₹${Math.abs(v) >= 1000 ? (v / 1000).toFixed(0) + "k" : v}`} />
                      <ReferenceLine y={0} stroke={theme.border} strokeWidth={2} strokeDasharray="4 4" />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            const val = payload[0].value;
                            return (
                              <div style={{ background: "#0F1923", color: "#fff", padding: "10px 14px", borderRadius: 10, fontSize: 12 }}>
                                <div style={{ fontSize: 10, color: "#94A3B8", marginBottom: 4 }}>Cumulative P&L</div>
                                <div style={{ fontWeight: 900, color: val >= 0 ? theme.bull : theme.bear }}>{val >= 0 ? "+" : "-"}₹{Math.abs(val).toLocaleString("en-IN")}</div>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Area type="monotone" dataKey="balance" stroke={parseFloat(data.drawdown.equityCurve[data.drawdown.equityCurve.length - 1]?.balance) >= 0 ? theme.bull : theme.bear} strokeWidth={2.5} fill={parseFloat(data.drawdown.equityCurve[data.drawdown.equityCurve.length - 1]?.balance) >= 0 ? "url(#eqPos)" : "url(#eqNeg)"} connectNulls activeDot={{ r: 5, fill: theme.bull, stroke: "#fff", strokeWidth: 2 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* RISK / REWARD + DRAWDOWN */}
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
              <div
                style={{
                  flex: "1 1 280px",
                  background: theme.card,
                  borderRadius: 14,
                  border: `1px solid ${theme.border}`,
                  padding: 20
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Risk / Reward Model</div>
                <div style={{ fontSize: 11, color: theme.muted, marginBottom: 12 }}>
                  Based on your options trades (planned and realized).
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 12 }}>
                  <TipCell label="Average R:R" value={`1:${data.rr?.avgRR || "0.0"}`} tip="Your planned risk-to-reward ratio. 1:2 means you risk ₹1 to make ₹2. Higher is better — ideally ≥ 1:1.5 for options." />
                  <TipCell label="Realized R:R" value={`1:${data.rr?.actualRR || "0.0"}`} tip="What your R:R actually turned out to be after closing trades. Compare with Average R:R to see if you're hitting your planned targets." />
                  <TipCell label="Expectancy" value={`${data.rr?.expectancy || "0.00"} R / trade`} tip="Expected average profit per trade in R units. Formula: (Win Rate × Avg Win) − (Loss Rate × Avg Loss). Positive = edge in the market." />
                  <TipCell label="Risk / Trade" value={`${currency}${parseFloat(data.rr?.riskPerTrade || 0).toFixed(2)}`} tip="Average capital at risk per trade (entry to stop loss × lot size). Keep this consistent — erratic sizing destroys your edge." />
                </div>
                <HoverBox tip="Total net profit divided by total risk taken. Higher positive value = better returns for the risk you accepted." style={{ marginTop: 12, fontSize: 11, color: theme.muted }}>
                  Risk-adjusted return:{" "}
                  <span style={{ fontWeight: 700, color: parseFloat(data.rr?.riskAdjustedReturn || 0) >= 0 ? theme.bull : theme.bear }}>
                    {data.rr?.riskAdjustedReturn}
                  </span>
                </HoverBox>
              </div>

              <div
                style={{
                  flex: "1 1 280px",
                  background: theme.card,
                  borderRadius: 14,
                  border: `1px solid ${theme.border}`,
                  padding: 20
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Drawdown & Equity</div>
                <div style={{ fontSize: 11, color: theme.muted, marginBottom: 12 }}>
                  How deep your options P&L dipped from peak.
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 12 }}>
                  <TipCell label="Max Drawdown" value={`${currency}${parseFloat(data.drawdown?.maxDrawdown || 0).toFixed(2)}${data.drawdown?.maxDrawdownPercent == null ? "" : ` (${data.drawdown.maxDrawdownPercent}%)`}`} color={theme.bear} tip="The largest peak-to-trough drop in your P&L. E.g., peak ₹10k → drop to ₹7k = 30% drawdown. Keep this manageable to stay in the game." />
                  <TipCell label="Current Drawdown" value={`${currency}${parseFloat(data.drawdown?.currentDrawdown || 0).toFixed(2)} (${data.drawdown?.currentDrawdownPercent || "0.0"}%)`} color={theme.bear} tip="How far you are below your all-time equity peak right now. If zero, you're at a new high. Any positive value means you're in an active drawdown." />
                  <TipCell label="Recovery Factor" value={data.drawdown?.recoveryFactor || "0.00"} tip="Net profit divided by max drawdown. E.g., ₹5k profit with ₹2k max drawdown = 2.5. Higher = you earn more relative to the risk you absorbed." />
                  <TipCell label="Peak vs Current" value={`${currency}${parseFloat(data.drawdown?.peakBalance || 0).toFixed(0)} → ${currency}${parseFloat(data.drawdown?.currentBalance || 0).toFixed(0)}`} tip="Your highest ever cumulative P&L vs. where you are now. If current < peak, you're in a drawdown and working to recover that high." />
                </div>
              </div>
            </div>

            {/* TRADE QUALITY */}
            <div
              style={{
                background: theme.card,
                borderRadius: 14,
                border: `1px solid ${theme.border}`,
                padding: 24,
                marginBottom: 24,
                boxShadow: "0 2px 10px rgba(15,23,42,0.05)"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 900 }}>Trade Quality</div>
                  <div style={{ fontSize: 11, color: theme.muted, marginTop: 4 }}>
                    RR distribution + breakeven calibration from your trade log.
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 16 }}>
                <StatCard
                  label="QUALITY SCORE"
                  value={hasRRFields ? `${data.quality?.qualityScore || 0}/100` : "—"}
                  color={
                    hasRRFields
                      ? parseFloat(data.quality?.qualityScore || 0) >= 70
                        ? theme.bull
                        : parseFloat(data.quality?.qualityScore || 0) >= 40
                          ? theme.gold
                          : theme.bear
                      : theme.muted
                  }
                  sub={hasRRFields ? "Overall trade quality rating" : rrGateReason}
                  tooltip="Composite score (0–100) measuring how well you plan and execute trades. Factors in R:R ratios, SL/TP discipline, and entry quality. Score ≥ 70 = good trader."
                />
                <StatCard
                  label="BREAKEVEN RATE"
                  value={hasRRFields ? `${data.quality?.breakevenRate || 0}%` : "—"}
                  color={hasRRFields ? (parseFloat(data.quality?.breakevenRate || 0) <= 30 ? theme.bull : theme.bear) : theme.muted}
                  sub={hasRRFields ? "Trades near flat (|P&L| < 5)" : rrGateReason}
                  tooltip="Percentage of trades where P&L is near zero (within ₹5). A lower breakeven rate is better — it means you're letting winners run and cutting losers clean."
                />
                <StatCard
                  label="TRADES WITH RR"
                  value={tradesWithRR > 0 ? tradesWithRR : "—"}
                  color={tradesWithRR > 0 ? theme.primary : theme.muted}
                  sub={tradesWithRR > 0 ? "Has SL/TP + entryPrice" : "Add entry price, stop loss and take profit"}
                  tooltip="Number of trades where you logged entry price, stop loss, and take profit. These trades unlock full R:R quality analytics. Log more for better insights."
                />
              </div>

              <div style={{ fontSize: 12, fontWeight: 900, color: theme.secondary, marginBottom: 10 }}>
                RR Buckets (Win Rate)
              </div>
              {Array.isArray(data.quality?.rrAnalysis) && data.quality.rrAnalysis.length > 0 ? (
                <div style={{ border: `1px solid ${theme.border}`, borderRadius: 14, background: "#fff", overflow: "hidden" }}>
                  {data.quality.rrAnalysis.slice(0, 6).map((r) => {
                    const winRate = parseFloat(r.winRate || 0);
                    const c = winRate >= 50 ? theme.bull : theme.bear;
                    return (
                      <ListItem
                        key={r.label}
                        label={r.label}
                        value={`${winRate}%`}
                        color={c}
                        sub={`${r.total} trades • Avg: ${currency}${parseFloat(r.avgProfit || 0).toFixed(2)}`}
                      />
                    );
                  })}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: theme.muted, lineHeight: 1.6 }}>
                  Add trades with <code>entryPrice</code>, <code>stopLoss</code> and <code>takeProfit</code> to unlock RR quality analytics.
                </div>
              )}
            </div>

            {/* Timing analysis */}
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", marginBottom: 24 }}>
              <div
                style={{
                  background: theme.card,
                  borderRadius: 12,
                  border: `1px solid ${theme.border}`,
                  padding: 20,
                  boxShadow: "0 2px 12px rgba(15,25,35,0.06)"
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 900 }}>Timing Edge</div>
                    <div style={{ fontSize: 11, color: theme.muted, marginTop: 4, lineHeight: 1.5 }}>
                      Best-performing day/hour/session from your NIFTY / BANKNIFTY trade log.
                    </div>
                  </div>
                  <div style={{ background: `${theme.bull}14`, border: `1px solid ${theme.bull}44`, color: theme.primary, fontSize: 10, fontWeight: 900, padding: "6px 10px", borderRadius: 999 }}>
                    {data.time?.bestHour?.hour != null ? `${data.time.bestHour.hour}:00` : "—"} Peak Hour
                  </div>
                </div>

                {data.time ? (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <HoverBox tip="The weekday (Mon–Fri) where your average profit and win rate is highest. Focus more trades on this day to maximise your edge." style={{ background: "#F8FAFC", border: `1px solid ${theme.border}`, borderRadius: 12, padding: 12, minHeight: 106 }}>
                      <div style={{ fontSize: 10, fontWeight: 900, color: theme.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>Best Day</div>
                      <div style={{ fontSize: 18, fontWeight: 900, color: theme.primary, fontFamily: "'JetBrains Mono',monospace", marginTop: 6 }}>
                        {data.time.bestDay?.name || "—"}
                      </div>
                      <div style={{ fontSize: 11, color: theme.muted, marginTop: 4, lineHeight: 1.4 }}>
                        Avg Profit:{" "}
                        {data.time.bestDay?.profit != null ? `${currency}${parseFloat(data.time.bestDay.profit).toFixed(0)}` : "—"}
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 900, color: parseFloat(data.time.bestDay?.winRate || 0) >= 50 ? theme.bull : theme.bear, marginTop: 6 }}>
                        {data.time.bestDay?.winRate != null ? `${data.time.bestDay.winRate}% WR` : "—"}
                      </div>
                    </HoverBox>

                    <HoverBox tip="The hour (IST, 24h) where your profit and win rate is highest. E.g., '10h' = trades entered 10:00–10:59 IST performed best. Concentrate entries in this window." style={{ background: "#F8FAFC", border: `1px solid ${theme.border}`, borderRadius: 12, padding: 12, minHeight: 106 }}>
                      <div style={{ fontSize: 10, fontWeight: 900, color: theme.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>Best Hour</div>
                      <div style={{ fontSize: 18, fontWeight: 900, color: theme.primary, fontFamily: "'JetBrains Mono',monospace", marginTop: 6 }}>
                        {data.time.bestHour?.hour != null ? `${data.time.bestHour.hour}h` : "—"}
                      </div>
                      <div style={{ fontSize: 11, color: theme.muted, marginTop: 4, lineHeight: 1.4 }}>
                        Avg Profit:{" "}
                        {data.time.bestHour?.profit != null ? `${currency}${parseFloat(data.time.bestHour.profit).toFixed(0)}` : "—"}
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 900, color: parseFloat(data.time.bestHour?.winRate || 0) >= 50 ? theme.bull : theme.bear, marginTop: 6 }}>
                        {data.time.bestHour?.winRate != null ? `${data.time.bestHour.winRate}% WR` : "—"}
                      </div>
                    </HoverBox>

                    <HoverBox tip="Market session (Opening 9:15–10:30 / Midday 10:30–13:00 / Closing 13:00–15:30) where you performed best. Identifies your strongest time window." style={{ background: "#F8FAFC", border: `1px solid ${theme.border}`, borderRadius: 12, padding: 12, minHeight: 106 }}>
                      <div style={{ fontSize: 10, fontWeight: 900, color: theme.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>Best Session</div>
                      <div style={{ fontSize: 18, fontWeight: 900, color: theme.primary, fontFamily: "'JetBrains Mono',monospace", marginTop: 6 }}>
                        {data.time.bestSession?.name || "—"}
                      </div>
                      <div style={{ fontSize: 11, color: theme.muted, marginTop: 4, lineHeight: 1.4 }}>
                        Trades: {data.time.bestSession?.trades != null ? data.time.bestSession.trades : "—"}
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 900, color: parseFloat(data.time.bestSession?.winRate || 0) >= 50 ? theme.bull : theme.bear, marginTop: 6 }}>
                        {data.time.bestSession?.winRate != null ? `${data.time.bestSession.winRate}% WR` : "—"}
                      </div>
                    </HoverBox>

                    <HoverBox tip="The weekday where your average profit is lowest or most negative. Consider reducing size or skipping trades on this day entirely." style={{ background: `${theme.bear}08`, border: `1px solid ${theme.bear}44`, borderRadius: 12, padding: 12, minHeight: 106 }}>
                      <div style={{ fontSize: 10, fontWeight: 900, color: theme.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>Worst Day</div>
                      <div style={{ fontSize: 18, fontWeight: 900, color: theme.bear, fontFamily: "'JetBrains Mono',monospace", marginTop: 6 }}>
                        {data.time.worstDay?.name || "—"}
                      </div>
                      <div style={{ fontSize: 11, color: theme.muted, marginTop: 4, lineHeight: 1.4 }}>
                        Avg Profit:{" "}
                        {data.time.worstDay?.profit != null ? `${currency}${parseFloat(data.time.worstDay.profit).toFixed(0)}` : "—"}
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 900, color: parseFloat(data.time.worstDay?.winRate || 0) >= 50 ? theme.bull : theme.bear, marginTop: 6 }}>
                        {data.time.worstDay?.winRate != null ? `${data.time.worstDay.winRate}% WR` : "—"}
                      </div>
                    </HoverBox>
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: theme.muted, lineHeight: 1.6 }}>Not enough data to compute timing edge yet.</div>
                )}
              </div>

            </div>

            {/* STRATEGY LEAGUE + SESSION EDGE + PLAN ADHERENCE */}
            {hasEnoughTrades && (
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>

                {/* Strategy League */}
                {Array.isArray(data.ai?.strategyLeague) && data.ai.strategyLeague.filter(s => s.strategy !== "Unspecified").length > 0 && (
                  <div style={{ flex: "1 1 280px", background: theme.card, borderRadius: 14, border: `1px solid ${theme.border}`, padding: 20 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>Trading Setup League</div>
                    <div style={{ fontSize: 11, color: theme.muted, marginBottom: 14 }}>Your setups ranked by total profit.</div>
                    {data.ai.strategyLeague.filter(s => s.strategy !== "Unspecified").slice(0, 6).map((s, i) => {
                      const profit = parseFloat(s.totalProfit);
                      const color = profit >= 0 ? theme.bull : theme.bear;
                      return (
                        <div key={s.strategy} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${theme.border}` }}>
                          <div style={{ width: 20, height: 20, borderRadius: "50%", background: i === 0 ? "#FFD700" : i === 1 ? "#C0C0C0" : i === 2 ? "#CD7F32" : theme.border, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 900, color: i < 3 ? "#fff" : theme.muted, flexShrink: 0 }}>#{i + 1}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.strategy}</div>
                            <div style={{ fontSize: 10, color: theme.muted }}>{s.trades} trades · {s.winRate}% WR</div>
                          </div>
                          <div style={{ fontSize: 12, fontWeight: 800, color, fontFamily: "'JetBrains Mono',monospace", flexShrink: 0 }}>
                            {profit >= 0 ? "+" : "-"}₹{Math.abs(profit).toLocaleString("en-IN")}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Session Edge */}
                {Array.isArray(data.ai?.sessionEdge) && data.ai.sessionEdge.length > 0 && (
                  <div style={{ flex: "1 1 240px", background: theme.card, borderRadius: 14, border: `1px solid ${theme.border}`, padding: 20 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>Session Edge</div>
                    <div style={{ fontSize: 11, color: theme.muted, marginBottom: 14 }}>Your P&L split by trading session.</div>
                    {data.ai.sessionEdge.slice(0, 6).map(s => {
                      const profit = parseFloat(s.totalProfit);
                      const color = profit >= 0 ? theme.bull : theme.bear;
                      return (
                        <div key={s.session} style={{ padding: "8px 0", borderBottom: `1px solid ${theme.border}` }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                            <span style={{ fontSize: 12, fontWeight: 700 }}>{s.session}</span>
                            <span style={{ fontSize: 12, fontWeight: 800, color, fontFamily: "'JetBrains Mono',monospace" }}>{profit >= 0 ? "+" : "-"}₹{Math.abs(profit).toLocaleString("en-IN")}</span>
                          </div>
                          <div style={{ fontSize: 10, color: theme.muted }}>{s.trades} trades · {s.winRate}% WR · avg ₹{parseFloat(s.avgProfit).toFixed(0)}</div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Plan Adherence Trend */}
                {Array.isArray(data.ai?.behaviorDiscipline?.planTimeline) && data.ai.behaviorDiscipline.planTimeline.length > 1 && (
                  <div style={{ flex: "1 1 240px", background: theme.card, borderRadius: 14, border: `1px solid ${theme.border}`, padding: 20 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>Plan Adherence Trend</div>
                    <div style={{ fontSize: 11, color: theme.muted, marginBottom: 14 }}>% of trades entered from a plan — week by week.</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {data.ai.behaviorDiscipline.planTimeline.slice(-8).map(w => {
                        const pct = parseFloat(w.planAdherencePct || 0);
                        const color = pct >= 70 ? theme.bull : pct >= 40 ? theme.gold : theme.bear;
                        return (
                          <div key={w.week}>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                              <span style={{ fontSize: 10, color: theme.muted, fontFamily: "'JetBrains Mono',monospace" }}>{w.week}</span>
                              <span style={{ fontSize: 10, fontWeight: 800, color }}>{pct}%</span>
                            </div>
                            <div style={{ height: 5, background: "#F0EEE9", borderRadius: 3 }}>
                              <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 3, transition: "width 0.5s ease" }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* PATTERN DETECTION */}
            {data.patterns ? (
              <div>
                <PatternInsightsCard patterns={data.patterns} delay={0.66} />
              </div>
            ) : loading ? (
              <div style={{ background: theme.card, borderRadius: 14, border: `1px solid ${theme.border}`, padding: 24, marginBottom: 24, height: 120, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div style={{ fontSize: 12, color: theme.muted }}>Loading pattern analysis...</div>
              </div>
            ) : null}

            {/* PERFORMANCE DEEP DIVE */}
            <div
              style={{
                background: theme.card,
                borderRadius: 14,
                border: `1px solid ${theme.border}`,
                padding: 24,
                marginBottom: 24,
                boxShadow: "0 2px 10px rgba(15,23,42,0.05)"
              }}
            >
              <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 20 }}>Performance Deep Dive</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 24 }}>
                <div title="Total winning P&L divided by total losing P&L. Profit Factor > 1 = system earns more than it loses. ≥ 1.5 is solid; ≥ 2.0 is excellent for options.">
                  <div style={{ fontSize: 11, color: theme.muted, marginBottom: 4 }}>PROFIT FACTOR</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: theme.gold }}>{data.perf?.profitFactor || "0.00"}</div>
                  <div style={{ fontSize: 10, color: theme.muted }}>Gross Profit / Gross Loss</div>
                </div>
                <div title="Your longest back-to-back winning run and back-to-back losing run. High loss streaks signal risk management or strategy issues to investigate.">
                  <div style={{ fontSize: 11, color: theme.muted, marginBottom: 4 }}>MAX STREAKS</div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>
                    <span style={{ color: theme.bull }}>{data.perf?.maxWinStreak || 0} Wins</span> / <span style={{ color: theme.bear }}>{data.perf?.maxLossStreak || 0} Losses</span>
                  </div>
                  <div style={{ fontSize: 10, color: theme.muted }}>Consecutive wins vs losses</div>
                </div>
                <div title="The single most profitable trade in your trade log. Useful to know if your overall profit is driven by one lucky trade or spread across many.">
                  <div style={{ fontSize: 11, color: theme.muted, marginBottom: 4 }}>LARGEST WIN</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: theme.bull }}>₹{parseFloat(data.perf?.largestWin || 0).toLocaleString()}</div>
                  <div style={{ fontSize: 10, color: theme.muted }}>Single best trade</div>
                </div>
                <div title="The single most damaging trade in your trade log. If this is much larger than your average loss, it suggests you didn't respect your stop loss on that trade.">
                  <div style={{ fontSize: 11, color: theme.muted, marginBottom: 4 }}>LARGEST LOSS</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: theme.bear }}>₹{parseFloat(data.perf?.largestLoss || 0).toLocaleString()}</div>
                  <div style={{ fontSize: 10, color: theme.muted }}>Single worst trade</div>
                </div>
              </div>
            </div>

            {/* DAY OF WEEK + MONTHLY PERFORMANCE */}
            {data.time && (
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
                {/* Full day-of-week breakdown */}
                {(() => {
                  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
                  const dayData = days.map(d => ({ name: d.slice(0, 3), ...((data.time.byDay || {})[d] || { total: 0, profit: 0, winRate: 0 }) })).filter(d => d.total > 0);
                  if (!dayData.length) return null;
                  const maxAbs = Math.max(...dayData.map(d => Math.abs(parseFloat(d.profit || 0))), 1);
                  return (
                    <div style={{ flex: "1 1 280px", background: theme.card, borderRadius: 14, border: `1px solid ${theme.border}`, padding: 20 }}>
                      <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>Day of Week Performance</div>
                      <div style={{ fontSize: 11, color: theme.muted, marginBottom: 14 }}>Total P&L and win rate per trading day.</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {dayData.map(d => {
                          const profit = parseFloat(d.profit || 0);
                          const wr = parseFloat(d.winRate || 0);
                          const pct = Math.min(100, (Math.abs(profit) / maxAbs) * 100);
                          const color = profit >= 0 ? theme.bull : theme.bear;
                          return (
                            <div key={d.name} title={`${d.name}: ${d.total} trades · ${wr}% win rate`}>
                              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                                <span style={{ fontSize: 11, fontWeight: 700 }}>{d.name}</span>
                                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                                  <span style={{ fontSize: 10, color: theme.muted }}>{d.total}T · {wr}%WR</span>
                                  <span style={{ fontSize: 11, fontWeight: 800, color, fontFamily: "'JetBrains Mono',monospace" }}>{profit >= 0 ? "+" : "-"}₹{Math.abs(profit).toFixed(0)}</span>
                                </div>
                              </div>
                              <div style={{ height: 6, background: "#F0EEE9", borderRadius: 3, overflow: "hidden" }}>
                                <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 3, transition: "width 0.5s ease" }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* Monthly performance table */}
                {(() => {
                  const byMonth = data.time.byMonth || {};
                  const months = Object.entries(byMonth).filter(([, v]) => v.total > 0).sort(([a], [b]) => new Date("1 " + a) - new Date("1 " + b));
                  if (!months.length) return null;
                  return (
                    <div style={{ flex: "1 1 280px", background: theme.card, borderRadius: 14, border: `1px solid ${theme.border}`, padding: 20 }}>
                      <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>Monthly Performance</div>
                      <div style={{ fontSize: 11, color: theme.muted, marginBottom: 14 }}>P&L, trades, and win rate per calendar month.</div>
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                          <thead>
                            <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
                              {["Month", "Trades", "W/L", "Win%", "P&L"].map(h => (
                                <th key={h} style={{ padding: "4px 6px", textAlign: h === "P&L" ? "right" : "left", fontWeight: 700, color: theme.muted, fontSize: 10, letterSpacing: "0.06em" }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {months.slice(-8).map(([month, v]) => {
                              const profit = parseFloat(v.profit || 0);
                              const color = profit >= 0 ? theme.bull : theme.bear;
                              return (
                                <tr key={month} style={{ borderBottom: `1px solid ${theme.border}` }}>
                                  <td style={{ padding: "6px 6px", fontWeight: 700 }}>{month}</td>
                                  <td style={{ padding: "6px 6px", color: theme.muted }}>{v.total}</td>
                                  <td style={{ padding: "6px 6px", color: theme.muted }}>{v.wins}/{v.losses}</td>
                                  <td style={{ padding: "6px 6px", color: parseFloat(v.winRate) >= 50 ? theme.bull : theme.bear, fontWeight: 700 }}>{v.winRate}%</td>
                                  <td style={{ padding: "6px 6px", textAlign: "right", fontWeight: 800, color, fontFamily: "'JetBrains Mono',monospace" }}>{profit >= 0 ? "+" : "-"}₹{Math.abs(profit).toLocaleString("en-IN")}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Calendar Performance */}
            {data.time?.byDate && Object.keys(data.time.byDate).length > 0 && (
              <div style={{ background: theme.card, borderRadius: 14, border: `1px solid ${theme.border}`, padding: 24, marginBottom: 24, boxShadow: "0 2px 10px rgba(15,23,42,0.05)" }}>
                <div style={{ fontSize: 16, fontWeight: 900, marginBottom: 4 }}>Calendar Performance</div>
                <div style={{ fontSize: 11, color: theme.muted, marginBottom: 16 }}>DAILY P&L HEATMAP</div>
                <CalendarPnL byDate={data.time.byDate || {}} activeMonth={calendarMonth} onPrevMonth={prevMonth} onNextMonth={nextMonth} currency="₹" />
              </div>
            )}

            {/* Distribution by new Indian form fields */}
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 16, marginTop: 8 }}>Performance by your trade log fields</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16, marginBottom: 24 }}>
              {data.distribution?.byStrategy && Object.keys(data.distribution.byStrategy).length > 0 && (
                <div style={{ background: theme.card, borderRadius: 14, border: `1px solid ${theme.border}`, padding: 20 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 12, color: theme.primary }}>By Trading Setup</div>
                  <DistList title="" data={data.distribution.byStrategy} currency={currency} maxItems={6} />
                </div>
              )}
              {data.distribution?.byTradeType && Object.keys(data.distribution.byTradeType).filter(k => data.distribution.byTradeType[k].total > 0).length > 0 && (
                <div style={{ background: theme.card, borderRadius: 14, border: `1px solid ${theme.border}`, padding: 20 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 12, color: theme.primary }}>By Trade Type</div>
                  <DistList title="" data={data.distribution.byTradeType} currency={currency} maxItems={5} />
                </div>
              )}
              {data.distribution?.byEntryBasis && Object.keys(data.distribution.byEntryBasis).filter(k => data.distribution.byEntryBasis[k].total > 0).length > 0 && (
                <div style={{ background: theme.card, borderRadius: 14, border: `1px solid ${theme.border}`, padding: 20 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 12, color: theme.primary }}>By Entry Basis</div>
                  <DistList title="" data={data.distribution.byEntryBasis} currency={currency} maxItems={5} />
                </div>
              )}
              {instrumentType === "EQUITY" ? (
                <>
                  {data.distribution?.byStockSymbol && Object.keys(data.distribution.byStockSymbol).filter(k => data.distribution.byStockSymbol[k].total > 0).length > 0 && (
                    <div style={{ background: theme.card, borderRadius: 14, border: `1px solid ${theme.border}`, padding: 20 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 4, color: theme.primary }}>By Stock</div>
                      <div style={{ fontSize: 11, color: theme.muted, marginBottom: 12 }}>Best and worst performing stocks in your trade log.</div>
                      <DistList title="" data={data.distribution.byStockSymbol} currency={currency} maxItems={8} />
                    </div>
                  )}
                  {data.distribution?.bySector && Object.keys(data.distribution.bySector).filter(k => data.distribution.bySector[k].total > 0).length > 0 && (
                    <div style={{ background: theme.card, borderRadius: 14, border: `1px solid ${theme.border}`, padding: 20 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 4, color: theme.primary }}>By Sector</div>
                      <div style={{ fontSize: 11, color: theme.muted, marginBottom: 12 }}>IT vs Banking vs Pharma — where your edge lies.</div>
                      <DistList title="" data={data.distribution.bySector} currency={currency} maxItems={6} />
                    </div>
                  )}
                </>
              ) : (
                <>
                  {data.distribution?.byUnderlying && Object.keys(data.distribution.byUnderlying).filter(k => data.distribution.byUnderlying[k].total > 0).length > 0 && (
                    <div style={{ background: theme.card, borderRadius: 14, border: `1px solid ${theme.border}`, padding: 20 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 12, color: theme.primary }}>By Underlying</div>
                      <DistList title="" data={data.distribution.byUnderlying} currency={currency} maxItems={6} />
                    </div>
                  )}
                  {/* CE vs PE */}
                  {data.distribution?.byOptionType && Object.keys(data.distribution.byOptionType).filter(k => k !== "Unspecified" && data.distribution.byOptionType[k].total > 0).length > 0 && (
                    <div style={{ background: theme.card, borderRadius: 14, border: `1px solid ${theme.border}`, padding: 20 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 4, color: theme.primary }}>CE vs PE</div>
                      <div style={{ fontSize: 11, color: theme.muted, marginBottom: 12 }}>Which option type you profit from more.</div>
                      <DistList title="" data={data.distribution.byOptionType} currency={currency} maxItems={4} />
                    </div>
                  )}
                </>
              )}
              {data.distribution?.byMistakeTag && Object.keys(data.distribution.byMistakeTag).filter(k => k !== "None" && data.distribution.byMistakeTag[k].total > 0).length > 0 && (
                <div style={{ background: theme.card, borderRadius: 14, border: `1px solid ${theme.border}`, padding: 20 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 12, color: theme.primary }}>By Mistake Tag</div>
                  <DistList title="" data={data.distribution.byMistakeTag} currency={currency} maxItems={6} />
                </div>
              )}
              {/* BUY vs SELL direction */}
              {data.distribution?.byDirection && Object.keys(data.distribution.byDirection).filter(k => k !== "Unspecified" && data.distribution.byDirection[k].total > 0).length > 0 && (
                <div style={{ background: theme.card, borderRadius: 14, border: `1px solid ${theme.border}`, padding: 20 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 4, color: theme.primary }}>By Direction</div>
                  <div style={{ fontSize: 11, color: theme.muted, marginBottom: 12 }}>BUY (long) vs SELL (short) performance.</div>
                  <DistList title="" data={data.distribution.byDirection} currency={currency} maxItems={4} />
                </div>
              )}
              {/* By Symbol (options) */}
              {instrumentType !== "EQUITY" && data.distribution?.byPair && Object.keys(data.distribution.byPair).filter(k => data.distribution.byPair[k].total > 0).length > 0 && (
                <div style={{ background: theme.card, borderRadius: 14, border: `1px solid ${theme.border}`, padding: 20 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 4, color: theme.primary }}>By Symbol</div>
                  <div style={{ fontSize: 11, color: theme.muted, marginBottom: 12 }}>Top performing options symbols in your trade log.</div>
                  <DistList title="" data={data.distribution.byPair} currency={currency} maxItems={6} />
                </div>
              )}
            </div>

            {/* BEHAVIORAL PATTERNS */}
            {hasEnoughTrades && data.ai?.psychologicalPatterns && (
              <div style={{ background: theme.card, borderRadius: 14, border: `1px solid ${theme.border}`, padding: 24, marginBottom: 24, boxShadow: "0 2px 10px rgba(15,23,42,0.05)" }}>
                <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>Behavioral Patterns</div>
                <div style={{ fontSize: 11, color: theme.muted, marginBottom: 18 }}>How your trading behavior shifts after extreme outcomes — detected from your trade log.</div>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>

                  {/* After Big Win */}
                  {data.ai.psychologicalPatterns.afterBigWin?.trades > 0 && (
                    <div style={{ flex: "1 1 180px", background: `${theme.bull}08`, border: `1px solid ${theme.bull}44`, borderRadius: 12, padding: 16 }} title="Tracks how you perform on the trade immediately following one of your largest winning trades. Overconfidence often leads to worse next-trade results.">
                      <div style={{ fontSize: 10, fontWeight: 800, color: theme.muted, letterSpacing: "0.08em", marginBottom: 8 }}>AFTER BIG WIN</div>
                      <div style={{ display: "flex", gap: 16 }}>
                        <div>
                          <div style={{ fontSize: 20, fontWeight: 900, color: parseFloat(data.ai.psychologicalPatterns.afterBigWin.avgProfit) >= 0 ? theme.bull : theme.bear }}>
                            {parseFloat(data.ai.psychologicalPatterns.afterBigWin.avgProfit) >= 0 ? "+" : "-"}₹{Math.abs(parseFloat(data.ai.psychologicalPatterns.afterBigWin.avgProfit)).toFixed(0)}
                          </div>
                          <div style={{ fontSize: 10, color: theme.muted, marginTop: 2 }}>avg P&L next trade</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 20, fontWeight: 900, color: parseFloat(data.ai.psychologicalPatterns.afterBigWin.winRate) >= 50 ? theme.bull : theme.bear }}>
                            {data.ai.psychologicalPatterns.afterBigWin.winRate}%
                          </div>
                          <div style={{ fontSize: 10, color: theme.muted, marginTop: 2 }}>win rate ({data.ai.psychologicalPatterns.afterBigWin.trades} trades)</div>
                        </div>
                      </div>
                      <div style={{ marginTop: 10, fontSize: 10, color: theme.muted, lineHeight: 1.5 }}>
                        {parseFloat(data.ai.psychologicalPatterns.afterBigWin.winRate) < 45
                          ? "! You tend to overtrade or oversize after a big win. Take a breath."
                          : "✓ Good — you stay disciplined after strong wins."}
                      </div>
                    </div>
                  )}

                  {/* After Big Loss */}
                  {data.ai.psychologicalPatterns.afterBigLoss?.trades > 0 && (
                    <div style={{ flex: "1 1 180px", background: `${theme.bear}08`, border: `1px solid ${theme.bear}44`, borderRadius: 12, padding: 16 }} title="Tracks how you perform immediately after one of your biggest losses. Fear or revenge can heavily distort next-trade decisions.">
                      <div style={{ fontSize: 10, fontWeight: 800, color: theme.muted, letterSpacing: "0.08em", marginBottom: 8 }}>AFTER BIG LOSS</div>
                      <div style={{ display: "flex", gap: 16 }}>
                        <div>
                          <div style={{ fontSize: 20, fontWeight: 900, color: parseFloat(data.ai.psychologicalPatterns.afterBigLoss.avgProfit) >= 0 ? theme.bull : theme.bear }}>
                            {parseFloat(data.ai.psychologicalPatterns.afterBigLoss.avgProfit) >= 0 ? "+" : "-"}₹{Math.abs(parseFloat(data.ai.psychologicalPatterns.afterBigLoss.avgProfit)).toFixed(0)}
                          </div>
                          <div style={{ fontSize: 10, color: theme.muted, marginTop: 2 }}>avg P&L next trade</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 20, fontWeight: 900, color: parseFloat(data.ai.psychologicalPatterns.afterBigLoss.winRate) >= 50 ? theme.bull : theme.bear }}>
                            {data.ai.psychologicalPatterns.afterBigLoss.winRate}%
                          </div>
                          <div style={{ fontSize: 10, color: theme.muted, marginTop: 2 }}>win rate ({data.ai.psychologicalPatterns.afterBigLoss.trades} trades)</div>
                        </div>
                      </div>
                      <div style={{ marginTop: 10, fontSize: 10, color: theme.muted, lineHeight: 1.5 }}>
                        {parseFloat(data.ai.psychologicalPatterns.afterBigLoss.winRate) < 45
                          ? "! You likely revenge trade after big losses. Consider stopping for the day."
                          : "✓ You stay composed after losses — strong mental resilience."}
                      </div>
                    </div>
                  )}

                  {/* Tilt Days */}
                  <div style={{ flex: "1 1 180px", background: data.ai.psychologicalPatterns.tiltDays?.length > 0 ? `${theme.bear}08` : `${theme.bull}08`, border: `1px solid ${data.ai.psychologicalPatterns.tiltDays?.length > 0 ? theme.bear + "44" : theme.bull + "44"}`, borderRadius: 12, padding: 16 }} title="A tilt day is detected when you had 3+ consecutive losses AND kept increasing position size — a classic emotional spiral. Each tilt day logged shows the date, streak length, and total loss.">
                    <div style={{ fontSize: 10, fontWeight: 800, color: theme.muted, letterSpacing: "0.08em", marginBottom: 8 }}>TILT DAYS DETECTED</div>
                    {data.ai.psychologicalPatterns.tiltDays?.length > 0 ? (
                      <>
                        <div style={{ fontSize: 28, fontWeight: 900, color: theme.bear, marginBottom: 4 }}>{data.ai.psychologicalPatterns.tiltDays.length}</div>
                        <div style={{ fontSize: 10, color: theme.muted, marginBottom: 10 }}>days with emotional spiraling detected</div>
                        {data.ai.psychologicalPatterns.tiltDays.slice(-3).map((td, i) => (
                          <div key={i} style={{ fontSize: 10, color: theme.muted, padding: "4px 0", borderTop: `1px solid ${theme.border}` }}>
                            {td.day} · {td.streakLength} losses · ₹{Math.abs(parseFloat(td.totalLoss)).toFixed(0)} lost
                          </div>
                        ))}
                        <div style={{ marginTop: 8, fontSize: 10, color: theme.bear, fontWeight: 700 }}>Rule: Stop trading after 3 consecutive losses.</div>
                      </>
                    ) : (
                      <>
                        <div style={{ fontSize: 28, fontWeight: 900, color: theme.bull, marginBottom: 4 }}>0</div>
                        <div style={{ fontSize: 10, color: theme.muted }}>No emotional spiraling detected — great discipline.</div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* PSYCHOLOGY ANALYTICS */}
            <div
              style={{
                background: theme.card,
                borderRadius: 14,
                border: `1px solid ${theme.border}`,
                padding: 24,
                marginBottom: 24,
                boxShadow: "0 2px 10px rgba(15,23,42,0.05)"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 900 }}>Psychology Analytics</div>
                  <div style={{ fontSize: 11, color: theme.muted, marginTop: 4 }}>
                    Discipline + mood calibration from your option trade log.
                  </div>
                </div>
                {data.psychology?.totalTrackedTrades ? (
                  <div style={{ fontSize: 12, color: theme.secondary, fontWeight: 900, padding: "8px 12px", borderRadius: 999, border: `1px solid ${theme.border}`, background: theme.bg }}>
                    {data.psychology.totalTrackedTrades} tracked trades
                  </div>
                ) : null}
              </div>

              {data.psychology && data.psychology.totalTrackedTrades > 0 ? (
                <>
                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 16 }}>
                    <StatCard
                      label="PSYCHOLOGY SCORE"
                      value={`${data.psychology.psychologyScore}/100`}
                      color={
                        parseFloat(data.psychology.psychologyScore || 0) >= 70
                          ? theme.bull
                          : parseFloat(data.psychology.psychologyScore || 0) >= 40
                            ? theme.gold
                            : theme.bear
                      }
                      sub="Composite discipline rating"
                      tooltip="Overall mental discipline score (0–100) combining plan adherence, emotional control, calm trading frequency, and revenge trade avoidance. Score ≥ 70 = strong mindset."
                    />
                    <StatCard
                      label="PLAN ADHERENCE"
                      value={`${data.psychology.scoreBreakdown?.planAdherencePct || 0}%`}
                      color={parseFloat(data.psychology.scoreBreakdown?.planAdherencePct || 0) >= 70 ? theme.bull : theme.bear}
                      sub="Trades executed from plan"
                      delay={0}
                      tooltip="% of trades where your entry was based on a pre-defined plan (not emotion). Higher is better — ideally ≥ 70%. Trades marked as 'Planned' count here."
                    />
                    <StatCard
                      label="CALM TRADING"
                      value={`${data.psychology.scoreBreakdown?.calmTradingPct || 0}%`}
                      color={parseFloat(data.psychology.scoreBreakdown?.calmTradingPct || 0) >= 50 ? theme.bull : theme.gold}
                      sub="Calm / focused behavior"
                      delay={0}
                      tooltip="% of trades logged with a calm or focused mood state. Trading calm tends to produce better outcomes. Target ≥ 50% calm sessions."
                    />
                  </div>

                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
                    <div style={{ flex: "1 1 320px", background: theme.card, borderRadius: 14, border: `1px solid ${theme.border}`, padding: 20 }}>
                      <div style={{ fontSize: 14, fontWeight: 900, marginBottom: 10 }}>Mood vs Performance</div>
                      {Array.isArray(data.psychology.moodAnalysis) && data.psychology.moodAnalysis.length > 0 ? (
                        data.psychology.moodAnalysis.map((m) => {
                          const winRate = parseFloat(m.winRate || 0);
                          const c = winRate >= 50 ? theme.bull : theme.bear;
                          return (
                            <div key={m.level} style={{ marginBottom: 10 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                                <div style={{ fontSize: 12, fontWeight: 900, color: theme.secondary }}>{cleanPsychText(m.label)}</div>
                                <div style={{ fontSize: 11, fontWeight: 900, color: c, fontFamily: "'JetBrains Mono',monospace" }}>
                                  {currency}{parseFloat(m.avgProfit || 0).toFixed(2)} avg
                                </div>
                              </div>
                              <ProgressBar value={winRate} max={100} color={c} label={`${m.trades} trades`} />
                            </div>
                          );
                        })
                      ) : (
                        <div style={{ fontSize: 12, color: theme.muted, lineHeight: 1.6 }}>
                          Start tagging your mood when logging trades to unlock this section.
                        </div>
                      )}
                    </div>

                    <div style={{ flex: "1 1 320px", background: theme.card, borderRadius: 14, border: `1px solid ${theme.border}`, padding: 20 }}>
                      <div style={{ fontSize: 14, fontWeight: 900, marginBottom: 10 }}>Confidence Calibration</div>
                      {Array.isArray(data.psychology.confidenceAnalysis) && data.psychology.confidenceAnalysis.length > 0 ? (
                        data.psychology.confidenceAnalysis.map((c) => {
                          const winRate = parseFloat(c.winRate || 0);
                          const isOver = String(c.level).toLowerCase().includes("over");
                          const barColor = isOver ? theme.bear : winRate >= 50 ? theme.bull : theme.bear;
                          return (
                            <div key={c.level} style={{ marginBottom: 10 }}>
                              <ProgressBar value={winRate} max={100} color={barColor} label={`${c.level} • ${c.trades} trades`} />
                              <div style={{ fontSize: 11, color: theme.muted, marginTop: -2 }}>
                                Avg: {currency}{parseFloat(c.avgProfit || 0).toFixed(2)}
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div style={{ fontSize: 12, color: theme.muted, lineHeight: 1.6 }}>
                          Start tagging your confidence level to unlock this section.
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
                    <div style={{ flex: "1 1 520px", background: theme.card, borderRadius: 14, border: `1px solid ${theme.border}`, padding: 20 }}>
                      <div style={{ fontSize: 14, fontWeight: 900, marginBottom: 10 }}>Emotional Tag Impact</div>
                      {Array.isArray(data.psychology.emotionalTagImpact) && data.psychology.emotionalTagImpact.length > 0 ? (
                        <div>
                          {data.psychology.emotionalTagImpact.slice(0, 8).map((t) => {
                            const winRate = parseFloat(t.winRate || 0);
                            const c = winRate >= 50 ? theme.bull : theme.bear;
                            return (
                              <ListItem
                                key={t.tag}
                                label={cleanPsychText(t.tag)}
                                value={`${winRate}%`}
                                color={c}
                                sub={`${t.trades} trades • Avg: ${currency}${parseFloat(t.avgProfit || 0).toFixed(2)}`}
                              />
                            );
                          })}
                        </div>
                      ) : (
                        <div style={{ fontSize: 12, color: theme.muted, lineHeight: 1.6 }}>
                          Tag your emotions when logging trades to see their impact.
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                    <div style={{ flex: "1 1 320px", background: theme.card, borderRadius: 14, border: `1px solid ${theme.border}`, padding: 20 }}>
                      <div style={{ fontSize: 14, fontWeight: 900, marginBottom: 10 }}>Would Retake (OK)</div>
                      {data.psychology.wouldRetakeAnalysis?.yes ? (
                        <div style={{ background: `${theme.bull}08`, border: `1px solid ${theme.bull}44`, borderRadius: 12, padding: 14 }}>
                          <div style={{ fontSize: 12, fontWeight: 900, color: theme.bull, marginBottom: 8 }}>Would Retake</div>
                          <div style={{ fontSize: 11, color: theme.muted, display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                            <span>Trades</span>
                            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 900, color: theme.secondary }}>{data.psychology.wouldRetakeAnalysis.yes.trades}</span>
                          </div>
                          <div style={{ fontSize: 11, color: theme.muted, display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                            <span>Win Rate</span>
                            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 900, color: theme.bull }}>{data.psychology.wouldRetakeAnalysis.yes.winRate}%</span>
                          </div>
                          <div style={{ fontSize: 11, color: theme.muted, display: "flex", justifyContent: "space-between" }}>
                            <span>Avg P&L</span>
                            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 900, color: theme.secondary }}>
                              {currency}{parseFloat(data.psychology.wouldRetakeAnalysis.yes.avgProfit || 0).toFixed(2)}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize: 12, color: theme.muted, lineHeight: 1.6 }}>Use the &quot;Would Retake&quot; toggle when logging trades.</div>
                      )}
                    </div>

                    <div style={{ flex: "1 1 320px", background: theme.card, borderRadius: 14, border: `1px solid ${theme.border}`, padding: 20 }}>
                      <div style={{ fontSize: 14, fontWeight: 900, marginBottom: 10 }}>Would NOT Retake (X)</div>
                      {data.psychology.wouldRetakeAnalysis?.no ? (
                        <div style={{ background: `${theme.bear}08`, border: `1px solid ${theme.bear}44`, borderRadius: 12, padding: 14 }}>
                          <div style={{ fontSize: 12, fontWeight: 900, color: theme.bear, marginBottom: 8 }}>Would NOT Retake</div>
                          <div style={{ fontSize: 11, color: theme.muted, display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                            <span>Trades</span>
                            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 900, color: theme.secondary }}>{data.psychology.wouldRetakeAnalysis.no.trades}</span>
                          </div>
                          <div style={{ fontSize: 11, color: theme.muted, display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                            <span>Win Rate</span>
                            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 900, color: theme.bear }}>{data.psychology.wouldRetakeAnalysis.no.winRate}%</span>
                          </div>
                          <div style={{ fontSize: 11, color: theme.muted, display: "flex", justifyContent: "space-between" }}>
                            <span>Avg P&L</span>
                            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 900, color: theme.secondary }}>
                              {currency}{parseFloat(data.psychology.wouldRetakeAnalysis.no.avgProfit || 0).toFixed(2)}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize: 12, color: theme.muted, lineHeight: 1.6 }}>Use the &quot;Would Retake&quot; toggle when logging trades.</div>
                      )}
                    </div>
                  </div>
                  {/* ── Psychology Insights ── */}
                  {(() => {
                    const moodRows = data.psychology.moodAnalysis || [];
                    const confRows = data.psychology.confidenceAnalysis || [];
                    const tagRows  = data.psychology.emotionalTagImpact || [];
                    const psychInsights = generatePsychInsights({
                      moodRows, confRows, tagRows,
                      wouldRetakeAnalysis: data.psychology.wouldRetakeAnalysis,
                      disciplineScore: data.psychology.psychologyScore,
                      currency,
                    });
                    return psychInsights.length > 0 ? (
                      <div style={{ marginTop: 20 }}>
                        <div style={{ fontSize: 10, color: "#8B5CF6", fontWeight: 700, letterSpacing: "0.08em", marginBottom: 12 }}>
                          PSYCHOLOGY INSIGHTS — WHAT TO DO WITH THIS DATA
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
                          {psychInsights.map((ins, i) => (
                            <PsychInsightCard key={i} icon={ins.icon} title={ins.title} body={ins.body} type={ins.type} />
                          ))}
                        </div>
                      </div>
                    ) : null;
                  })()}
                </>
              ) : (
                <div style={{ padding: 18, borderRadius: 12, border: `1px dashed ${theme.border}`, background: "#F8FAFC", color: theme.muted, fontSize: 12, lineHeight: 1.6 }}>
                  Psychology analytics unlocks after you log trades with mood, confidence, emotional tags, and the &quot;Would Retake&quot; toggle.
                </div>
              )}
            </div>

            {/* ── Repeated Mistakes Feed ── */}
            {data.ai?.mistakeFeed?.length > 0 && (
              <div style={{ background: theme.card, borderRadius: 14, border: `1px solid ${theme.border}`, padding: 24, marginBottom: 24, boxShadow: "0 2px 10px rgba(15,23,42,0.05)" }}>
                <div style={{ fontSize: 16, fontWeight: 900, marginBottom: 4 }}>Repeated Mistakes</div>
                <div style={{ fontSize: 11, color: theme.muted, marginBottom: 16 }}>
                  Your self-tagged mistakes ranked by total P&L cost. Fixing #1 is worth more than finding new setups.
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {data.ai.mistakeFeed.map((m, i) => {
                    const rankColors = ["#DC2626", "#EA580C", "#D97706", "#65A30D", "#0284C7"];
                    const rankColor = rankColors[i] || theme.muted;
                    return (
                      <div key={m.tag} style={{ borderRadius: 12, border: `1px solid ${rankColor}22`, background: `${rankColor}06`, padding: "14px 16px" }}>
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
                            <div style={{ width: 28, height: 28, borderRadius: 8, background: `${rankColor}18`, border: `1.5px solid ${rankColor}44`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 900, color: rankColor, flexShrink: 0, fontFamily: "'JetBrains Mono',monospace" }}>
                              {i + 1}
                            </div>
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 800, color: theme.secondary }}>{m.tag}</div>
                              <div style={{ fontSize: 10, color: theme.muted, marginTop: 2 }}>{m.count} occurrence{m.count !== 1 ? "s" : ""} · avg ₹{Math.abs(m.avgPnl).toFixed(2)} {m.avgPnl < 0 ? "lost" : "made"} per trade</div>
                            </div>
                          </div>
                          <div style={{ textAlign: "right", flexShrink: 0 }}>
                            <div style={{ fontSize: 15, fontWeight: 900, color: m.totalPnl < 0 ? theme.bear : theme.bull, fontFamily: "'JetBrains Mono',monospace" }}>
                              {m.totalPnl < 0 ? "-" : "+"}₹{Math.abs(m.totalPnl).toFixed(2)}
                            </div>
                            <div style={{ fontSize: 9, color: theme.muted, marginTop: 2 }}>total cost</div>
                          </div>
                        </div>
                        {m.lessons?.length > 0 && (
                          <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${rankColor}20` }}>
                            <div style={{ fontSize: 9, fontWeight: 700, color: rankColor, letterSpacing: "0.1em", marginBottom: 6 }}>LESSON LOGGED</div>
                            <div style={{ fontSize: 11, color: "#374151", fontStyle: "italic", lineHeight: 1.6 }}>&quot;{m.lessons[0]}&quot;</div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Discipline Trend + Revenge/Tilt ── */}
            {data.ai?.weeklyDisciplineTrend?.length > 1 && (
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 24 }}>

                {/* Discipline Trend */}
                <div style={{ flex: "1 1 320px", background: theme.card, borderRadius: 14, border: `1px solid ${theme.border}`, padding: 24, boxShadow: "0 2px 10px rgba(15,23,42,0.05)" }}>
                  <div style={{ fontSize: 15, fontWeight: 900, marginBottom: 4 }}>Discipline Trend</div>
                  <div style={{ fontSize: 11, color: theme.muted, marginBottom: 14 }}>Weekly plan adherence % with P&L</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {data.ai.weeklyDisciplineTrend.slice(-8).map((w, i, arr) => {
                      const pct = w.planAdherencePct;
                      const barColor = pct >= 70 ? theme.bull : pct >= 40 ? theme.gold : theme.bear;
                      const weekLabel = w.week.replace(/^\d{4}-/, "");
                      const isLatest = i === arr.length - 1;
                      const prevPct = i > 0 ? arr[i - 1].planAdherencePct : null;
                      const trend = prevPct !== null ? (pct > prevPct ? "▲" : pct < prevPct ? "▼" : "—") : "";
                      const trendColor = trend === "▲" ? theme.bull : trend === "▼" ? theme.bear : theme.muted;
                      return (
                        <div key={w.week} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ fontSize: 9, fontFamily: "'JetBrains Mono',monospace", color: isLatest ? theme.secondary : theme.muted, width: 48, flexShrink: 0, fontWeight: isLatest ? 700 : 400 }}>{weekLabel}</div>
                          <div style={{ flex: 1, height: 6, background: theme.bg, borderRadius: 99, overflow: "hidden" }}>
                            <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", background: barColor, borderRadius: 99 }} />
                          </div>
                          <div style={{ fontSize: 10, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: barColor, width: 36, textAlign: "right" }}>{pct}%</div>
                          <div style={{ fontSize: 9, color: trendColor, width: 12 }}>{trend}</div>
                          <div style={{ fontSize: 9, fontFamily: "'JetBrains Mono',monospace", color: w.pnl >= 0 ? theme.bull : theme.bear, width: 60, textAlign: "right" }}>{w.pnl >= 0 ? "+" : "-"}₹{Math.abs(w.pnl).toFixed(0)}</div>
                        </div>
                      );
                    })}
                  </div>
                  {(() => {
                    const trend = data.ai.weeklyDisciplineTrend.slice(-4);
                    if (trend.length < 2) return null;
                    const delta = trend[trend.length - 1].planAdherencePct - trend[0].planAdherencePct;
                    if (Math.abs(delta) < 5) return null;
                    return (
                      <div style={{ marginTop: 12, padding: "8px 12px", borderRadius: 8, background: delta > 0 ? "#F0FDF4" : "#FFF8F8", border: `1px solid ${delta > 0 ? "#BBF7D0" : "#FED7D7"}`, fontSize: 11, color: delta > 0 ? "#166534" : "#9B1C1C" }}>
                        {delta > 0 ? "▲" : "▼"} Discipline {delta > 0 ? "improving" : "declining"} {Math.abs(delta).toFixed(0)}pp over last 4 weeks
                      </div>
                    );
                  })()}
                </div>

                {/* Revenge & Tilt Alerts */}
                <div style={{ flex: "1 1 320px", background: theme.card, borderRadius: 14, border: `1px solid ${theme.border}`, padding: 24, boxShadow: "0 2px 10px rgba(15,23,42,0.05)" }}>
                  <div style={{ fontSize: 15, fontWeight: 900, marginBottom: 16 }}>Revenge & Tilt Alerts</div>

                  {/* Revenge */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: theme.muted, letterSpacing: "0.08em" }}>REVENGE TRADES</div>
                      <div style={{ fontSize: 22, fontWeight: 900, color: (data.ai.behaviorDiscipline?.revengeTradesCount || 0) > 0 ? theme.bear : theme.bull, fontFamily: "'JetBrains Mono',monospace" }}>
                        {data.ai.behaviorDiscipline?.revengeTradesCount || 0}
                      </div>
                    </div>
                    {(data.ai.behaviorDiscipline?.revengeTradesCount || 0) > 0 ? (
                      <>
                        <div style={{ fontSize: 11, color: "#374151", lineHeight: 1.6, marginBottom: 8 }}>
                          Trades taken after a loss with 1.5× bigger risk. Total cost:{" "}
                          <span style={{ fontWeight: 700, color: theme.bear, fontFamily: "'JetBrains Mono',monospace" }}>
                            ₹{Math.abs(parseFloat(data.ai.behaviorDiscipline.revengeCostTotal || 0)).toFixed(2)}
                          </span>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {(data.ai.behaviorDiscipline.revengeTrades || []).slice(-3).map((t, i) => (
                            <div key={i} style={{ fontSize: 10, color: theme.muted, display: "flex", justifyContent: "space-between", padding: "4px 8px", background: "#FFF8F8", borderRadius: 6, border: "1px solid #FED7D7" }}>
                              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 600 }}>{t.pair}</span>
                              <span>{new Date(t.createdAt).toLocaleDateString("en-IN")}</span>
                              <span style={{ color: theme.bear, fontWeight: 700 }}>₹{Math.abs(t.prevProfit || 0).toFixed(0)} trigger</span>
                            </div>
                          ))}
                        </div>
                        <div style={{ marginTop: 8, fontSize: 10, fontWeight: 700, color: theme.bear }}>Rule: After a loss, wait 15 min before the next trade.</div>
                      </>
                    ) : (
                      <div style={{ fontSize: 11, color: theme.bull, fontWeight: 600 }}>✓ No revenge trades detected — strong control.</div>
                    )}
                  </div>

                  {/* Tilt */}
                  <div style={{ borderTop: `1px solid ${theme.border}`, paddingTop: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: theme.muted, letterSpacing: "0.08em" }}>TILT DAYS</div>
                      <div style={{ fontSize: 22, fontWeight: 900, color: (data.ai.psychologicalPatterns?.tiltDays?.length || 0) > 0 ? theme.bear : theme.bull, fontFamily: "'JetBrains Mono',monospace" }}>
                        {data.ai.psychologicalPatterns?.tiltDays?.length || 0}
                      </div>
                    </div>
                    {(data.ai.psychologicalPatterns?.tiltDays?.length || 0) > 0 ? (
                      <>
                        <div style={{ fontSize: 11, color: "#374151", lineHeight: 1.6, marginBottom: 8 }}>
                          3+ consecutive losses with increasing lot size detected.
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {data.ai.psychologicalPatterns.tiltDays.slice(-3).map((td, i) => (
                            <div key={i} style={{ fontSize: 10, color: theme.muted, display: "flex", justifyContent: "space-between", padding: "4px 8px", background: "#FFF8F8", borderRadius: 6, border: "1px solid #FED7D7" }}>
                              <span>{td.day}</span>
                              <span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{td.streakLength} losses</span>
                              <span style={{ color: theme.bear, fontWeight: 700 }}>-₹{Math.abs(parseFloat(td.totalLoss)).toFixed(0)}</span>
                            </div>
                          ))}
                        </div>
                        <div style={{ marginTop: 8, fontSize: 10, fontWeight: 700, color: theme.bear }}>Rule: Stop trading after 3 consecutive losses.</div>
                      </>
                    ) : (
                      <div style={{ fontSize: 11, color: theme.bull, fontWeight: 600 }}>✓ No tilt days detected — great discipline.</div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Path to Advanced / Profitable */}
            <PathToAdvanced
              summary={data.summary}
              ai={data.ai}
              perf={data.perf}
              quality={data.quality}
              psychology={data.psychology}
              currency={currency}
            />
          </>
        )}
      </main>
      <style jsx global>{`
        @keyframes fadeUp {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @media (max-width: 900px) {
          .indian-analytics-kpi-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          }
        }
        @media (max-width: 560px) {
          .indian-analytics-kpi-grid {
            grid-template-columns: minmax(0, 1fr) !important;
          }
          .indian-analytics-tabs {
            width: 100% !important;
          }
          .indian-analytics-tabs button {
            flex: 1;
            padding-inline: 10px !important;
          }
        }
      `}</style>
    </div>
  );
}
