"use client";

import { Suspense, useState, useEffect } from "react";
import Link from "next/link";
import ErrorBoundary from "@/components/ErrorBoundary";
import CandlestickBackground from "@/features/shared/components/CandlestickBackground";
import PageHeader            from "@/features/shared/components/PageHeader";
import { useQuery }          from "@tanstack/react-query";
import { getPsychologyTimeline } from "@/services/analyticsApi";
import { hasValidAuthToken } from "@/utils/auth";
import { TRADE_QUERY_FRESHNESS_OPTIONS } from "@/utils/queryInvalidation";
import { useRouter }         from "next/navigation";
import {
  ComposedChart,
  LineChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from "recharts";

// ── Colour palette ─────────────────────────────────────────────────────────────

const C = {
  psych:    "#7C3AED",
  aware:    "#2563EB",
  disc:     "#0D9E6E",
  pnlPos:   "#0D9E6E",
  pnlNeg:   "#DC2626",
  muted:    "#94A3B8",
  primary:  "#0F172A",
  bg:       "#F8FAFC",
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function trendIcon(t) {
  if (t === "improving") return { icon: "↑", color: "#059669" };
  if (t === "declining") return { icon: "↓", color: "#DC2626" };
  return { icon: "→", color: "#94A3B8" };
}

function scoreColor(n) {
  if (n === null || n === undefined) return C.muted;
  if (n >= 70) return "#059669";
  if (n >= 45) return "#D97706";
  return "#DC2626";
}

function fmtNet(n) {
  const v = parseFloat(n || 0);
  return `${v >= 0 ? "+" : "-"}$${Math.abs(v).toFixed(0)}`;
}

function InterpretationGrid({ items, accent = C.psych }) {
  const visible = (items || []).filter(Boolean);
  if (!visible.length) return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10 }}>
      {visible.map((item) => (
        <div key={item.label} style={{ borderRadius: 10, border: `1px solid ${accent}24`, background: `${accent}08`, padding: "12px 14px" }}>
          <div style={{ fontSize: 9, fontWeight: 900, color: accent, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>{item.label}</div>
          <div style={{ fontSize: 12, color: "#334155", lineHeight: 1.65 }}>{item.text}</div>
        </div>
      ))}
    </div>
  );
}

function buildTimelineInterpretation({ buckets, trends, stats }) {
  if (!buckets?.length) return null;
  const latest = buckets[buckets.length - 1];
  const first = buckets[0];
  const latestPsych = latest?.psychologyScore ?? null;
  const firstPsych = first?.psychologyScore ?? null;
  const delta = latestPsych != null && firstPsych != null ? latestPsych - firstPsych : null;
  const improving = delta != null && delta > 0;
  const declining = delta != null && delta < 0;
  const focus =
    trends?.discipline === "declining" ? "discipline and rule follow-through" :
    trends?.selfAwareness === "declining" ? "post-trade self-review accuracy" :
    trends?.psychology === "declining" ? "emotional reset before the next trade" :
    "protecting the routines that are already improving";

  return [
    {
      label: "Growth Summary",
      text: delta == null
        ? `Your timeline now contains ${buckets.length} periods. Edgecipline is building a longitudinal view of your trading psychology.`
        : `Your psychology score is ${latestPsych}/100 in the latest period, ${improving ? "up" : declining ? "down" : "flat"} ${Math.abs(delta)} points from the first tracked period.`,
    },
    {
      label: "Positive Changes",
      text: trends?.psychology === "improving" || trends?.selfAwareness === "improving" || trends?.discipline === "improving"
        ? `The improving signals are: ${[
            trends?.psychology === "improving" ? "psychology" : null,
            trends?.selfAwareness === "improving" ? "self-awareness" : null,
            trends?.discipline === "improving" ? "discipline" : null,
          ].filter(Boolean).join(", ")}. These are the habits to keep repeating.`
        : "No major upward trend is confirmed yet. Keep logging emotions, trade quality, and rule adherence so the timeline can separate noise from real growth.",
    },
    {
      label: "Areas Still Improving",
      text: trends?.psychology === "declining" || trends?.selfAwareness === "declining" || trends?.discipline === "declining"
        ? `The current weak signal is ${focus}. Treat this as the next behavior to review before adding more strategy complexity.`
        : "The main opportunity is consistency: keep the same review inputs on every trade so progress becomes easier to measure.",
    },
    {
      label: "Current Focus",
      text: `For the next review cycle, focus on ${focus}. The expected outcome is a cleaner emotional baseline and fewer preventable mistakes across ${stats?.totalBuckets || buckets.length} tracked periods.`,
    },
  ];
}

// ── Skeleton ───────────────────────────────────────────────────────────────────

function Skel({ w = "100%", h = 14, r = 6 }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: r,
      background: "linear-gradient(90deg, #E2E8F0 0%, #F1F5F9 50%, #E2E8F0 100%)",
      backgroundSize: "200% 100%",
      animation: "shimmer 1.4s infinite",
    }} />
  );
}

// ── Trend badge ────────────────────────────────────────────────────────────────

function TrendBadge({ trend, label }) {
  const { icon, color } = trendIcon(trend);
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 4,
      padding: "10px 16px",
      background: "#FFFFFF",
      borderRadius: 12,
      border: "1px solid #E2E8F0",
      minWidth: 90,
    }}>
      <div style={{ fontSize: 22, color, fontWeight: 900, lineHeight: 1 }}>{icon}</div>
      <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textAlign: "center", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: 9, color, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}>{trend || "stable"}</div>
    </div>
  );
}

// ── Custom chart tooltip ───────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "#0F172A",
      border: "none",
      borderRadius: 10,
      padding: "10px 14px",
      color: "#E2E8F0",
      fontSize: 11,
      boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
    }}>
      <div style={{ fontWeight: 800, marginBottom: 6, color: "#FFFFFF" }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 3 }}>
          <span style={{ color: p.color || "#94A3B8" }}>{p.name}</span>
          <span style={{ fontWeight: 700, color: "#FFFFFF" }}>{p.value !== null && p.value !== undefined ? p.value : "—"}</span>
        </div>
      ))}
    </div>
  );
}

// ── Milestone item ─────────────────────────────────────────────────────────────

function MilestoneItem({ milestone }) {
  const typeColors = {
    psychology_threshold:   { bg: "#F5F3FF", border: "#7C3AED33", icon: "🧠" },
    self_awareness_threshold: { bg: "#EFF6FF", border: "#2563EB33", icon: "🔍" },
    best_psychology:        { bg: "#F0FDF4", border: "#059669 33", icon: "🏆" },
    worst_psychology:       { bg: "#FEF2F2", border: "#DC262633", icon: "⚠️" },
    revenge_free_streak:    { bg: "#FFFBEB", border: "#D9770633", icon: "🎯" },
  };
  const style = typeColors[milestone.type] || { bg: "#F8FAFC", border: "#E2E8F033", icon: "📌" };
  return (
    <div style={{
      padding: "12px 14px",
      borderRadius: 10,
      background: style.bg,
      border: `1px solid ${style.border}`,
      display: "flex",
      gap: 10,
    }}>
      <span style={{ fontSize: 18, flexShrink: 0, lineHeight: 1.4 }}>{milestone.icon || style.icon}</span>
      <div>
        <div style={{ fontSize: 12, fontWeight: 800, color: C.primary, marginBottom: 3 }}>{milestone.title}</div>
        {milestone.key && (
          <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, marginBottom: 4 }}>{milestone.key}</div>
        )}
        <div style={{ fontSize: 11, color: "#334155", lineHeight: 1.5 }}>{milestone.description}</div>
      </div>
    </div>
  );
}

// ── Main content ───────────────────────────────────────────────────────────────

function PsychologyTimelineContent() {
  const router  = useRouter();
  const mounted = true;
  const [period, setPeriod]   = useState("weekly");
  const [days,   setDays]     = useState("");

  useEffect(() => {
    if (!hasValidAuthToken()) router.replace("/login");
  }, [router]);

  const { data, isLoading } = useQuery({
    queryKey: ["psychologyTimeline", period, days],
    queryFn:  ({ signal }) => getPsychologyTimeline("Forex", period, days, signal),
    ...TRADE_QUERY_FRESHNESS_OPTIONS,
    enabled: mounted,
  });

  const loading   = isLoading || !mounted;
  const insufficient = data?.insufficient;
  const buckets   = data?.buckets || [];
  const trends    = data?.trends  || {};
  const milestones = data?.milestones || [];
  const stats     = data?.stats   || {};
  const timelineInterpretation = buildTimelineInterpretation({ buckets, trends, stats });

  // Prepare chart data
  const chartData = buckets.map(b => {
    const topTag  = Object.entries(b.emotions?.tagCosts || {})
      .filter(([, v]) => v.isNeg)
      .sort(([, a], [, b2]) => a.netPnL - b2.netPnL)[0];
    return {
      key:      b.key,
      psych:    b.psychologyScore,
      aware:    b.selfAwarenessScore,
      disc:     b.disciplineScore,
      net:      b.net,
      trades:   b.tradeCount,
      avgMood:  b.emotions?.avgMood ?? null,
      topTag:   topTag?.[0] ?? null,
    };
  });

  const PERIODS = [
    { value: "daily",   label: "Daily" },
    { value: "weekly",  label: "Weekly" },
    { value: "monthly", label: "Monthly" },
  ];
  const DAYS_OPTIONS = [
    { value: "",    label: "All time" },
    { value: "30",  label: "30 days" },
    { value: "90",  label: "90 days" },
    { value: "180", label: "6 months" },
    { value: "365", label: "1 year" },
  ];

  if (!mounted) return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#F4F2EE" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: 18, height: 18, border: "2.5px solid #E2E8F0", borderTopColor: C.psych, borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto" }} />
      </div>
    </main>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#F4F2EE", fontFamily: "'Plus Jakarta Sans',sans-serif", color: C.primary, position: "relative" }}>
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <CandlestickBackground canvasId="timeline-bg-canvas" />

      <div style={{ position: "relative", zIndex: 10 }}>
        <PageHeader />

        <main style={{ maxWidth: 1100, width: "100%", margin: "0 auto", padding: "28px 20px", boxSizing: "border-box" }}>

          {/* ── Header ─────────────────────────────────────────────── */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                <Link href="/dashboard" style={{ fontSize: 11, color: C.muted, textDecoration: "none", fontWeight: 600 }}>← Dashboard</Link>
              </div>
              <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0, letterSpacing: "-0.02em" }}>Psychology Timeline</h1>
              <p style={{ fontSize: 11, color: C.muted, margin: "4px 0 0", fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.04em" }}>
                How your mindset, discipline, and self-awareness evolve over time
              </p>
            </div>

            {/* ── Filters ─────────────────────────────────── */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {/* Period */}
              <div style={{ display: "flex", background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 8, overflow: "hidden" }}>
                {PERIODS.map(p => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setPeriod(p.value)}
                    style={{
                      padding: "6px 12px",
                      fontSize: 11,
                      fontWeight: 700,
                      border: "none",
                      borderRight: "1px solid #E2E8F0",
                      cursor: "pointer",
                      background: period === p.value ? C.psych : "transparent",
                      color: period === p.value ? "#FFFFFF" : C.muted,
                      fontFamily: "inherit",
                      transition: "all 0.15s",
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              {/* Days */}
              <select
                value={days}
                onChange={e => setDays(e.target.value)}
                style={{
                  padding: "6px 10px",
                  fontSize: 11,
                  fontWeight: 700,
                  border: "1px solid #E2E8F0",
                  borderRadius: 8,
                  background: "#FFFFFF",
                  color: C.primary,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {DAYS_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* ── Insufficient state ──────────────────────────────────── */}
          {!loading && insufficient && (
            <div style={{
              background: "#FFFFFF",
              borderRadius: 16,
              border: "1px solid #E2E8F0",
              padding: "48px 32px",
              textAlign: "center",
            }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: C.primary, marginBottom: 8 }}>
                {data?.reason === "no_trades" ? "No Trading History Yet" : "Not Enough Data"}
              </div>
              <div style={{ fontSize: 13, color: C.muted, maxWidth: 340, margin: "0 auto", lineHeight: 1.6 }}>
                {data?.message || "Start logging trades with emotional tags and trade quality ratings to build your psychology timeline."}
              </div>
              <Link href="/add-trade" style={{
                display: "inline-block",
                marginTop: 20,
                padding: "10px 20px",
                background: C.psych,
                color: "#FFFFFF",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 700,
                textDecoration: "none",
              }}>
                Log a Trade
              </Link>
            </div>
          )}

          {(loading || (!insufficient && buckets.length > 0)) && (
            <>
              {/* ── Trend indicators row ─────────────────────────────── */}
              <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
                {loading ? (
                  [1, 2, 3].map(i => <div key={i} style={{ width: 100, height: 80, background: "#FFFFFF", borderRadius: 12, border: "1px solid #E2E8F0" }} />)
                ) : (
                  <>
                    <TrendBadge trend={trends.psychology}    label="Psychology" />
                    <TrendBadge trend={trends.selfAwareness} label="Self-Awareness" />
                    <TrendBadge trend={trends.discipline}    label="Discipline" />

                    {/* Stats summary */}
                    {stats.avgPsychologyScore !== null && (
                      <div style={{ flex: 1, minWidth: 200, background: "#FFFFFF", borderRadius: 12, border: "1px solid #E2E8F0", padding: "10px 16px", display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
                        {[
                          { label: "Avg Psychology",  value: stats.avgPsychologyScore,    suffix: "/100", color: scoreColor(stats.avgPsychologyScore) },
                          { label: "Best Score",      value: stats.bestPsychologyScore,   suffix: "",     color: "#059669" },
                          { label: "Worst Score",     value: stats.worstPsychologyScore,  suffix: "",     color: "#DC2626" },
                          { label: "Periods",         value: stats.totalBuckets,          suffix: "",     color: C.psych },
                        ].map((s, i) => (
                          <div key={i} style={{ textAlign: "center" }}>
                            <div style={{ fontSize: 18, fontWeight: 900, color: s.color, fontFamily: "'JetBrains Mono',monospace", lineHeight: 1 }}>
                              {s.value ?? "—"}{s.suffix}
                            </div>
                            <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, marginTop: 3, letterSpacing: "0.04em" }}>{s.label}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* ── AI Summary ───────────────────────────────────────── */}
              <div style={{ background: "#FFFFFF", borderRadius: 16, border: "1px solid #E2E8F0", padding: "16px 20px", marginBottom: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 16 }}>🤖</span>
                  <div style={{ fontSize: 13, fontWeight: 800, color: C.primary }}>Psychology Coach Summary</div>
                  <div style={{ background: "#EFF6FF", color: "#2563EB", fontSize: 9, fontWeight: 800, padding: "2px 7px", borderRadius: 999, letterSpacing: "0.05em" }}>AI</div>
                </div>
                {loading ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <Skel h={12} w="100%" />
                    <Skel h={12} w="85%" />
                    <Skel h={12} w="92%" />
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: "#334155", lineHeight: 1.7, borderLeft: `3px solid ${C.psych}`, paddingLeft: 12 }}>
                    {data?.aiSummary}
                  </div>
                )}
              </div>

              <div style={{ background: "#FFFFFF", borderRadius: 16, border: "1px solid #E2E8F0", padding: "18px 20px", marginBottom: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: C.primary, marginBottom: 4 }}>Timeline Interpretation</div>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 14 }}>What your psychology trend means and what to focus on next</div>
                {loading ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10 }}>
                    {[1, 2, 3, 4].map(i => <Skel key={i} h={86} r={10} />)}
                  </div>
                ) : (
                  <InterpretationGrid items={timelineInterpretation} accent={C.psych} />
                )}
              </div>

              {/* ── Psychology Score Chart ────────────────────────────── */}
              <div style={{ background: "#FFFFFF", borderRadius: 16, border: "1px solid #E2E8F0", padding: "20px", marginBottom: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: C.primary, marginBottom: 4 }}>Psychology Score Over Time</div>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 16 }}>Emotional health per {period} period — healthy emotional state = higher score</div>
                {loading ? (
                  <Skel h={200} r={8} />
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <ComposedChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                      <XAxis dataKey="key" tick={{ fontSize: 9, fill: C.muted }} interval="preserveStartEnd" />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: C.muted }} width={28} />
                      <Tooltip content={<ChartTooltip />} />
                      <ReferenceLine y={70} stroke="#059669" strokeDasharray="4 4" strokeOpacity={0.5} />
                      <ReferenceLine y={45} stroke="#D97706" strokeDasharray="4 4" strokeOpacity={0.4} />
                      <Bar dataKey="net" name="Net P&L" fill="#E2E8F0" opacity={0.5} radius={[2, 2, 0, 0]}
                        stroke="none"
                      />
                      <Line
                        type="monotone"
                        dataKey="psych"
                        name="Psychology"
                        stroke={C.psych}
                        strokeWidth={2.5}
                        dot={{ r: 3, fill: C.psych }}
                        activeDot={{ r: 5 }}
                        connectNulls
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
                {!loading && (
                  <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 10, color: C.muted }}>
                    <span style={{ color: "#059669" }}>— ≥70 Healthy</span>
                    <span style={{ color: "#D97706" }}>— ≥45 Average</span>
                    <span style={{ color: "#DC2626" }}>— &lt;45 Costly</span>
                  </div>
                )}
              </div>

              {/* ── Multi-metric Chart ────────────────────────────────── */}
              <div style={{ background: "#FFFFFF", borderRadius: 16, border: "1px solid #E2E8F0", padding: "20px", marginBottom: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: C.primary, marginBottom: 4 }}>Self-Awareness & Discipline</div>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 16 }}>Track how accurately you rate yourself (self-awareness) and follow your rules (discipline)</div>
                {loading ? (
                  <Skel h={200} r={8} />
                ) : (
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                      <XAxis dataKey="key" tick={{ fontSize: 9, fill: C.muted }} interval="preserveStartEnd" />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: C.muted }} width={28} />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                      <Line
                        type="monotone"
                        dataKey="aware"
                        name="Self-Awareness"
                        stroke={C.aware}
                        strokeWidth={2}
                        dot={{ r: 3, fill: C.aware }}
                        connectNulls
                      />
                      <Line
                        type="monotone"
                        dataKey="disc"
                        name="Discipline"
                        stroke={C.disc}
                        strokeWidth={2}
                        dot={{ r: 3, fill: C.disc }}
                        connectNulls
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* ── P&L Bar Chart ─────────────────────────────────────── */}
              <div style={{ background: "#FFFFFF", borderRadius: 16, border: "1px solid #E2E8F0", padding: "20px", marginBottom: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: C.primary, marginBottom: 4 }}>P&L Per Period</div>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 16 }}>Net profit/loss per {period} with trade count</div>
                {loading ? (
                  <Skel h={180} r={8} />
                ) : (
                  <ResponsiveContainer width="100%" height={180}>
                    <ComposedChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                      <XAxis dataKey="key" tick={{ fontSize: 9, fill: C.muted }} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 9, fill: C.muted }} width={36} />
                      <Tooltip content={<ChartTooltip />} />
                      <ReferenceLine y={0} stroke="#E2E8F0" />
                      <Bar
                        dataKey="net"
                        name="Net P&L"
                        radius={[3, 3, 0, 0]}
                        fill={C.pnlPos}
                        label={false}
                      >
                        {chartData.map((entry, i) => (
                          <rect
                            key={i}
                            fill={entry.net >= 0 ? C.pnlPos : C.pnlNeg}
                          />
                        ))}
                      </Bar>
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* ── Two-column: Milestones + Mood ─────────────────────── */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>

                {/* Milestones */}
                <div style={{ background: "#FFFFFF", borderRadius: 16, border: "1px solid #E2E8F0", padding: "20px" }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: C.primary, marginBottom: 4 }}>Milestones</div>
                  <div style={{ fontSize: 11, color: C.muted, marginBottom: 14 }}>Key moments in your psychology journey</div>
                  {loading ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {[1, 2].map(i => <Skel key={i} h={64} r={10} />)}
                    </div>
                  ) : milestones.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "24px 0", color: C.muted, fontSize: 12 }}>
                      <div style={{ fontSize: 28, marginBottom: 8 }}>🎯</div>
                      Keep trading consistently — milestones will appear as you build your history.
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 320, overflowY: "auto" }}>
                      {milestones.map((m, i) => <MilestoneItem key={i} milestone={m} />)}
                    </div>
                  )}
                </div>

                {/* Average Mood Chart */}
                <div style={{ background: "#FFFFFF", borderRadius: 16, border: "1px solid #E2E8F0", padding: "20px" }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: C.primary, marginBottom: 4 }}>Average Mood</div>
                  <div style={{ fontSize: 11, color: C.muted, marginBottom: 14 }}>Mood score (1=Stressed → 5=Peak) per period</div>
                  {loading ? (
                    <Skel h={200} r={8} />
                  ) : chartData.some(d => d.avgMood !== null) ? (
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                        <XAxis dataKey="key" tick={{ fontSize: 9, fill: C.muted }} interval="preserveStartEnd" />
                        <YAxis domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} tick={{ fontSize: 9, fill: C.muted }} width={20} />
                        <Tooltip content={<ChartTooltip />} />
                        <ReferenceLine y={3} stroke="#94A3B8" strokeDasharray="4 4" strokeOpacity={0.5} />
                        <Line
                          type="monotone"
                          dataKey="avgMood"
                          name="Avg Mood"
                          stroke="#F59E0B"
                          strokeWidth={2}
                          dot={{ r: 3, fill: "#F59E0B" }}
                          connectNulls
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div style={{ textAlign: "center", padding: "32px 0", color: C.muted, fontSize: 12 }}>
                      Log trades with mood ratings to see this chart.
                    </div>
                  )}
                </div>
              </div>

              {/* ── Trade count per period ─────────────────────────────── */}
              <div style={{ background: "#FFFFFF", borderRadius: 16, border: "1px solid #E2E8F0", padding: "20px", marginBottom: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: C.primary, marginBottom: 4 }}>Trade Activity</div>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 16 }}>Number of trades per {period}</div>
                {loading ? <Skel h={120} r={8} /> : (
                  <ResponsiveContainer width="100%" height={120}>
                    <ComposedChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                      <XAxis dataKey="key" tick={{ fontSize: 9, fill: C.muted }} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 9, fill: C.muted }} width={24} allowDecimals={false} />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="trades" name="Trades" fill={`${C.psych}44`} stroke={C.psych} strokeWidth={1} radius={[2, 2, 0, 0]} />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </div>
            </>
          )}

        </main>
      </div>

      <style jsx global>{`
        @keyframes shimmer {
          0%   { background-position: -200% 0; }
          100% { background-position:  200% 0; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @media (max-width: 768px) {
          main { padding: 16px !important; }
        }
        @media (max-width: 640px) {
          div[style*="grid-template-columns: 1fr 1fr"] {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}

export default function PsychologyTimelinePage() {
  return (
    <ErrorBoundary fallback={<div style={{ padding: "2rem", textAlign: "center" }}>Psychology Timeline failed to load. Please refresh.</div>}>
      <Suspense><PsychologyTimelineContent /></Suspense>
    </ErrorBoundary>
  );
}
