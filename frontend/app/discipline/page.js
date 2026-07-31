"use client";

import { Suspense, useState, useEffect, useMemo } from "react";
import ErrorBoundary from "@/components/ErrorBoundary";
import CandlestickBackground from "@/features/shared/components/CandlestickBackground";
import PageHeader from "@/features/shared/components/PageHeader";
import PageBackNav from "@/features/shared/components/PageBackNav";
import { useQuery } from "@tanstack/react-query";
import { getDisciplineAnalytics } from "@/services/analyticsApi";
import { hasValidAuthToken } from "@/utils/auth";
import { TRADE_QUERY_FRESHNESS_OPTIONS } from "@/utils/queryInvalidation";
import { ruleSample, LOW_RULE_SAMPLE, pickWeakestRule, pickStrongestRule } from "@/utils/disciplineRules";
import { useRouter } from "next/navigation";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, LineChart, Line,
} from "recharts";

// Matches backend MIN_INSIGHT_TRADES in disciplineAnalytics.js
const MIN_SAMPLE_TRADES = 3;

// ── Palette ────────────────────────────────────────────────────────────────────

const C = {
  primary: "#0F172A",
  green:   "#0D9E6E",
  red:     "#DC2626",
  amber:   "#D97706",
  blue:    "#2563EB",
  muted:   "#94A3B8",
  bg:      "#F8FAFC",
  card:    "#FFFFFF",
  border:  "#E2E8F0",
};

// ── Helpers ────────────────────────────────────────────────────────────────────

const fmt = (n, cur = "$") => {
  const v = parseFloat(n || 0);
  const sym = cur === "₹" ? "₹" : "$";
  const abs = Math.abs(v);
  const s = abs >= 1000 ? `${sym}${(abs / 1000).toFixed(1)}K` : `${sym}${abs.toFixed(0)}`;
  return v >= 0 ? `+${s}` : `-${s}`;
};

const scoreGrade = (n) => {
  if (n == null) return { label: "No data", color: C.muted };
  if (n >= 80)  return { label: "Excellent", color: C.green };
  if (n >= 65)  return { label: "Good", color: C.green };
  if (n >= 50)  return { label: "Average", color: C.amber };
  return         { label: "Needs work", color: C.red };
};

const barColor = (pct) => pct >= 75 ? C.green : pct >= 50 ? C.amber : C.red;

function InterpretationGrid({ items, accent = C.blue }) {
  const visible = (items || []).filter(Boolean);
  if (!visible.length) return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10 }}>
      {visible.map((item) => (
        <div key={item.label} style={{ borderRadius: 12, border: `1px solid ${accent}24`, background: `${accent}08`, padding: "12px 14px" }}>
          <div style={{ fontSize: 9, fontWeight: 900, color: accent, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>{item.label}</div>
          <div style={{ fontSize: 12, color: "#334155", lineHeight: 1.65 }}>{item.text}</div>
        </div>
      ))}
    </div>
  );
}

function buildDisciplineInterpretation({ rules, topByCost, compliance, stats }) {
  const strongest = pickStrongestRule(rules);
  const weakest = pickWeakestRule(rules);
  const expensive = topByCost?.[0];
  const score = compliance?.compliancePct;
  return [
    {
      label: "Strongest Discipline Habit",
      text: strongest
        ? `You follow "${strongest.label}" ${strongest.compliancePct}% of the time (${strongest.timesFollowed || 0} of ${ruleSample(strongest)} logged). This is the rule currently most embedded in your process.`
        : "Edgecipline will identify your strongest rule once enough setup-rule history is logged.",
    },
    {
      label: "Weakest Discipline Habit",
      text: weakest
        ? `"${weakest.label}" is your weakest tracked rule at ${weakest.compliancePct}% follow rate (${weakest.timesFollowed || 0} of ${ruleSample(weakest)} logged).` +
          (ruleSample(weakest) < LOW_RULE_SAMPLE
            ? " That is a small sample, so treat it as a flag to watch rather than a verdict."
            : " This is where discipline can improve fastest.")
        : "Add checklist and setup-rule data to reveal which rule breaks most often.",
    },
    {
      label: "Most Expensive Rule Violation",
      text: expensive
        ? `Breaking "${expensive.label}" has cost roughly ${fmt(-Math.abs(expensive.costOfBreaking || 0), stats?.currency || "$")} across the tracked sample.`
        : "Once rule violations connect to P&L, this section will show the behavior costing the most money.",
    },
    {
      label: "Next Discipline Goal",
      text: score != null
        ? `Move your rule follow rate from ${score}% toward ${Math.min(100, Math.max(80, Math.ceil(score / 5) * 5 + 5))}%. The expected outcome is fewer low-quality trades and more consistent setup selection.`
        : "Start by logging setup rules on each trade. The first milestone is 10 trades with rule data.",
    },
  ];
}

// ── Skeleton ───────────────────────────────────────────────────────────────────

function Skel({ h = 16, w = "100%", r = 8 }) {
  return <div style={{ height: h, width: w, borderRadius: r, background: "#E2E8F0", animation: "pulse 1.4s ease infinite" }} />;
}

function LoadingSkeleton() {
  return (
    <div style={{ padding: "0 16px 40px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ background: C.card, borderRadius: 20, padding: 24, display: "flex", flexDirection: "column", gap: 12, border: `1px solid ${C.border}` }}>
        <Skel h={12} w="30%" />
        <Skel h={64} />
        <Skel h={14} w="60%" />
      </div>
      {[1, 2, 3].map(i => (
        <div key={i} style={{ background: C.card, borderRadius: 16, padding: 18, display: "flex", flexDirection: "column", gap: 10, border: `1px solid ${C.border}` }}>
          <Skel h={11} w="40%" />
          <Skel h={44} />
        </div>
      ))}
    </div>
  );
}

// ── Chart tooltip ──────────────────────────────────────────────────────────────

function Tip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#0F172A", borderRadius: 10, padding: "9px 13px", fontSize: 11, color: "#E2E8F0", boxShadow: "0 8px 20px rgba(0,0,0,0.3)" }}>
      <div style={{ fontWeight: 800, color: "#FFF", marginBottom: 5 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 14, marginBottom: 2 }}>
          <span style={{ color: p.color || "#94A3B8" }}>{p.name}</span>
          <span style={{ fontWeight: 700, color: "#FFF" }}>{p.value ?? "—"}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main content ───────────────────────────────────────────────────────────────

function DisciplineContent() {
  const router = useRouter();
  const mounted = true;
  const [days, setDays]       = useState("");
  const [period, setPeriod]   = useState("monthly");
  const market = "Forex";

  useEffect(() => {
    if (!hasValidAuthToken()) router.replace("/login");
  }, [router]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["discipline", market, period, days],
    queryFn: ({ signal }) => getDisciplineAnalytics(market, period, days, "", signal),
    enabled: mounted,
    ...TRADE_QUERY_FRESHNESS_OPTIONS,
  });

  // These three memos MUST stay above the early returns below. They used to sit
  // after them, so the loading render bailed out first and the next render ran
  // three extra hooks — React error #310 ("rendered more hooks than during the
  // previous render"), which crashed the page on every cold navigation.
  // They read through `data?.` so they are safe before the query resolves.
  const timelineData = useMemo(
    () => (data?.timeline?.buckets || []).map(b => ({
      key: b.key,
      "Follow rate": b.compliancePct ?? null,
      "Win rate": b.winRate ?? null,
    })),
    [data?.timeline?.buckets]
  );

  const rulesForChart = useMemo(
    () => [...(data?.ruleAnalytics || [])]
      .sort((a, b) => (a.compliancePct ?? 0) - (b.compliancePct ?? 0))
      .slice(0, 10),
    [data?.ruleAnalytics]
  );

  const setupsForChart = useMemo(
    () => (data?.setupPerformance || []).filter(s => s.trades >= 2).slice(0, 6),
    [data?.setupPerformance]
  );

  if (!mounted || isLoading) return <LoadingSkeleton />;

  if (error) return (
    <div style={{ padding: 32, textAlign: "center" }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: C.red }}>Could not load data</div>
      <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{error.message}</div>
    </div>
  );

  if (!data || data.insufficient) return (
    <div style={{ padding: "40px 24px", textAlign: "center" }}>
      <div style={{ fontSize: 44, marginBottom: 14 }}>📋</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: C.primary, marginBottom: 8 }}>Not enough data yet</div>
      <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.7, maxWidth: 300, margin: "0 auto" }}>
        {data?.message || "Log at least 10 trades with setup rules to see discipline analytics."}
      </div>
    </div>
  );

  const cur          = data.stats?.currency || "$";
  const compliance   = data.compliance || {};
  const overview     = data.overview || {};
  const rules        = data.ruleAnalytics || [];
  const topByCost    = data.ruleCostAnalytics?.topByCost || [];
  const insights     = (data.coachInsights || []).slice(0, 4);
  const dna          = data.dnaIntegration || {};
  const stats        = data.stats || {};
  // Same source as the interpretation card above, so both name the same rule
  const strongestRule = pickStrongestRule(rules);
  const weakestRule   = pickWeakestRule(rules);
  const disciplineInterpretation = buildDisciplineInterpretation({ rules, topByCost, compliance, stats });

  const score = compliance.compliancePct;
  const { label: grade, color: gradeColor } = scoreGrade(score);

  const trendMap = { improving: { arrow: "↑", color: C.green, text: "Improving" }, declining: { arrow: "↓", color: C.red, text: "Declining" }, stable: { arrow: "→", color: C.muted, text: "Stable" } };
  const trend = trendMap[overview.trend] || trendMap.stable;

  return (
    <div style={{ padding: "0 16px 60px", display: "flex", flexDirection: "column", gap: 14 }}>

      {/* ── Filters ─────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {[["", "All time"], ["30", "30 days"], ["90", "90 days"], ["180", "6 months"], ["365", "1 year"]].map(([val, lbl]) => (
          <button key={val} onClick={() => setDays(val)} style={{
            padding: "6px 14px", borderRadius: 14, fontSize: 11, fontWeight: 700, cursor: "pointer",
            background: days === val ? C.blue : "#F1F5F9",
            color: days === val ? "#FFF" : "#64748B",
            border: "none",
          }}>{lbl}</button>
        ))}
        <div style={{ flex: 1 }} />
        {["monthly", "weekly", "daily"].map(p => (
          <button key={p} onClick={() => setPeriod(p)} style={{
            padding: "6px 12px", borderRadius: 14, fontSize: 11, fontWeight: 700, cursor: "pointer",
            background: period === p ? "#6366F1" : "#F1F5F9",
            color: period === p ? "#FFF" : "#64748B",
            border: "none",
          }}>{p[0].toUpperCase() + p.slice(1)}</button>
        ))}
      </div>

      {/* ── Hero: Your score ─────────────────────────────────────────────────── */}
      <div style={{
        background: C.card, borderRadius: 20, border: `1px solid ${C.border}`,
        padding: "22px 20px", boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: "0.06em", marginBottom: 10 }}>
          AM I FOLLOWING MY PROCESS?
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", gap: 12, marginBottom: 14 }}>
          <div style={{ fontSize: 56, fontWeight: 900, color: gradeColor, lineHeight: 1 }}>
            {score != null ? `${score}%` : "—"}
          </div>
          <div style={{ paddingBottom: 6 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: gradeColor }}>{grade}</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>rule follow rate</div>
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ height: 10, background: "#E2E8F0", borderRadius: 6, overflow: "hidden", marginBottom: 16 }}>
          <div style={{
            width: `${Math.min(100, score ?? 0)}%`, height: "100%",
            background: `linear-gradient(90deg, ${gradeColor}, ${gradeColor}aa)`,
            borderRadius: 6, transition: "width 0.8s ease",
          }} />
        </div>

        {/* Stats row */}
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: C.primary }}>{stats.totalTrades ?? 0}</div>
            <div style={{ fontSize: 10, color: C.muted }}>total trades</div>
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: C.primary }}>{stats.tradesWithRules ?? 0}</div>
            <div style={{ fontSize: 10, color: C.muted }}>with rules</div>
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: C.primary }}>{stats.uniqueRules ?? 0}</div>
            <div style={{ fontSize: 10, color: C.muted }}>rules tracked</div>
          </div>
          <div style={{ marginLeft: "auto", textAlign: "right" }}>
            <div style={{ fontSize: 18, fontWeight: 900, color: trend.color }}>{trend.arrow}</div>
            <div style={{ fontSize: 10, color: C.muted }}>{trend.text}</div>
          </div>
        </div>
      </div>

      {/* ── What's costing you money ─────────────────────────────────────────── */}
      <div style={{ background: C.card, borderRadius: 16, border: `1px solid ${C.border}`, padding: "18px 16px" }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: C.primary, marginBottom: 4 }}>
          Discipline Interpretation
        </div>
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 14 }}>
          What your rule-following behavior means and what to improve next
        </div>
        <InterpretationGrid items={disciplineInterpretation} accent={C.blue} />
      </div>

      {topByCost.length > 0 && (
        <div style={{ background: C.card, borderRadius: 16, border: `1px solid ${C.border}`, padding: "18px 16px" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.primary, marginBottom: 4 }}>
            Rules costing you money
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 14 }}>
            What you lose each time you skip these rules
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {topByCost.slice(0, 5).map((r, i) => {
              const cost = parseFloat(r.costOfBreaking || 0);
              const hasDiff = r.timesFollowed > 0 && r.pnlDifference !== null && r.pnlDifference !== undefined;
              const diff = hasDiff ? parseFloat(r.pnlDifference) : 0;
              return (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "12px 14px", borderRadius: 12,
                  background: i === 0 ? "#FEF2F2" : "#FAFAFA",
                  border: `1px solid ${i === 0 ? "#DC262622" : C.border}`,
                }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                    background: i === 0 ? "#FEE2E2" : "#F1F5F9",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, fontWeight: 800, color: i === 0 ? C.red : C.muted,
                  }}>{i + 1}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.primary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {r.label}
                    </div>
                    <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>
                      Broken {r.timesBroken} times
                      {hasDiff && diff !== 0 && <> · <span style={{ color: diff >= 0 ? C.green : C.red, fontWeight: 700 }}>{fmt(diff, cur)}/trade when followed</span></>}
                    </div>
                  </div>
                  {cost > 0 && (
                    <div style={{ fontSize: 14, fontWeight: 900, color: C.red, flexShrink: 0, fontFamily: "'JetBrains Mono',monospace" }}>
                      -{fmt(cost, cur).slice(1)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Your rules at a glance ───────────────────────────────────────────── */}
      {rulesForChart.length > 0 && (
        <div style={{ background: C.card, borderRadius: 16, border: `1px solid ${C.border}`, padding: "18px 16px" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.primary, marginBottom: 4 }}>Your rules</div>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 16 }}>
            How often you follow each rule — worst first
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {rulesForChart.map((r, i) => {
              const pct = r.compliancePct ?? 0;
              const col = barColor(pct);
              return (
                <div key={i}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: C.primary, flex: 1, paddingRight: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.label}
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 800, color: col, flexShrink: 0 }}>{pct}%</span>
                  </div>
                  <div style={{ height: 7, background: "#E2E8F0", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: col, borderRadius: 4, transition: "width 0.6s ease" }} />
                  </div>
                  <div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>
                    Followed {r.timesFollowed}× · Skipped {r.timesBroken}×
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Over time chart ──────────────────────────────────────────────────── */}
      {timelineData.length >= 2 && (
        <div style={{ background: C.card, borderRadius: 16, border: `1px solid ${C.border}`, padding: "18px 16px" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.primary, marginBottom: 4 }}>Is your discipline improving?</div>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 14 }}>
            Rule follow rate and win rate over time
          </div>
          <div style={{ height: 160 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={timelineData}>
                <CartesianGrid stroke="#F1F5F9" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="key" tick={{ fontSize: 9, fill: C.muted }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: C.muted }} width={28} axisLine={false} tickLine={false} />
                <Tooltip content={<Tip />} />
                <ReferenceLine y={70} stroke="#CBD5E1" strokeDasharray="4 4" label={{ value: "70%", position: "right", fontSize: 9, fill: C.muted }} />
                <Line type="monotone" dataKey="Follow rate" stroke={C.green} strokeWidth={2.5} dot={false} connectNulls />
                <Line type="monotone" dataKey="Win rate" stroke={C.blue} strokeWidth={2} dot={false} strokeDasharray="5 3" connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 16, height: 3, background: C.green, borderRadius: 2 }} />
              <span style={{ fontSize: 10, color: C.muted }}>Follow rate</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 16, height: 3, background: C.blue, borderRadius: 2, opacity: 0.7 }} />
              <span style={{ fontSize: 10, color: C.muted }}>Win rate</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Which setups do you follow best ─────────────────────────────────── */}
      {setupsForChart.length > 0 && (
        <div style={{ background: C.card, borderRadius: 16, border: `1px solid ${C.border}`, padding: "18px 16px" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.primary, marginBottom: 4 }}>Setup performance ranking</div>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 14 }}>
            Ranked by net P&amp;L — green is profitable, red is losing
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {setupsForChart.map((s, i) => {
              // Rank alone does not earn the badge: the top setup is still a
              // losing one when every setup loses money.
              const isBest  = s.setupName === data.bestSetup?.setupName  && s.netPnL > 0;
              const isWorst = s.setupName === data.worstSetup?.setupName && s.netPnL < 0;
              return (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "12px 14px", borderRadius: 12,
                  background: isBest ? "#F0FDF4" : isWorst ? "#FEF2F2" : "#FAFAFA",
                  border: `1px solid ${isBest ? "#0D9E6E22" : isWorst ? "#DC262622" : C.border}`,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.primary }}>{s.setupName || "Unspecified"}</span>
                      {isBest  && <span style={{ fontSize: 9, fontWeight: 800, color: C.green,  background: "#DCFCE7", borderRadius: 4, padding: "1px 5px" }}>BEST</span>}
                      {isWorst && <span style={{ fontSize: 9, fontWeight: 800, color: C.red,    background: "#FEE2E2", borderRadius: 4, padding: "1px 5px" }}>WEAKEST</span>}
                    </div>
                    <div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>
                      {s.trades} trades · {s.winRate}% win rate
                      {s.avgDisciplineScore != null && ` · ${s.avgDisciplineScore}% discipline`}
                    </div>
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 900, color: s.netPnL >= 0 ? C.green : C.red, flexShrink: 0, fontFamily: "'JetBrains Mono',monospace" }}>
                    {fmt(s.netPnL, cur)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Setup score impact ───────────────────────────────────────────────── */}
      {Array.isArray(data.psychologyCorrelation?.bySetupRange) && data.psychologyCorrelation.bySetupRange.length > 0 && (
        <div style={{ background: C.card, borderRadius: 16, border: `1px solid ${C.border}`, padding: "18px 16px" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.primary, marginBottom: 4 }}>
            Does setup quality affect your results?
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 14 }}>
            Average P&L by setup score range
            {data.psychologyCorrelation.optimalThreshold != null && (
              <span style={{ color: C.blue, fontWeight: 700 }}>
                {" "}— aim for {data.psychologyCorrelation.optimalThreshold}+
              </span>
            )}
          </div>
          <div style={{ height: 130 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.psychologyCorrelation.bySetupRange.map(r => ({ name: `${r.range} (n=${r.count})`, pnl: r.avgPnL ?? 0, wr: r.winRate ?? 0, count: r.count }))}>
                <CartesianGrid stroke="#F1F5F9" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 8, fill: C.muted }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: C.muted }} width={36} axisLine={false} tickLine={false} />
                <Tooltip content={<Tip />} />
                <ReferenceLine y={0} stroke="#CBD5E1" />
                <Bar dataKey="pnl" name="Avg P&L" radius={[4, 4, 0, 0]}>
                  {data.psychologyCorrelation.bySetupRange.map((r, i) => (
                    <rect key={i} fill={(r.avgPnL ?? 0) >= 0 ? C.green : C.red} fillOpacity={r.count < MIN_SAMPLE_TRADES ? 0.35 : 1} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {data.psychologyCorrelation.bySetupRange.some(r => r.count < MIN_SAMPLE_TRADES) && (
            <div style={{ fontSize: 10, color: C.muted, marginTop: 8 }}>
              Faded bars are based on fewer than {MIN_SAMPLE_TRADES} trades — not enough data to draw a conclusion yet.
            </div>
          )}
        </div>
      )}
      

      {/* ── Key takeaways ────────────────────────────────────────────────────── */}
      {(dna.mostValuableRule || strongestRule || weakestRule) && (
        <div style={{ background: C.card, borderRadius: 16, border: `1px solid ${C.border}`, padding: "18px 16px" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.primary, marginBottom: 14 }}>Key takeaways</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {dna.mostValuableRule && (
              <div style={{ padding: "12px 14px", borderRadius: 12, background: "#F5F3FF", border: "1px solid #7C3AED22" }}>
                <div style={{ fontSize: 10, color: "#7C3AED", fontWeight: 800, marginBottom: 4 }}>MOST VALUABLE RULE</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.primary, marginBottom: 3 }}>{dna.mostValuableRule.label}</div>
                <div style={{ fontSize: 11, color: C.muted }}>
                  Following this rule gives you{" "}
                  <strong style={{ color: C.green }}>{fmt(dna.mostValuableRule.pnlDifference, cur)}/trade</strong>{" "}
                  more than when you skip it.
                </div>
              </div>
            )}
            {strongestRule && (
              <div style={{ padding: "12px 14px", borderRadius: 12, background: "#F0FDF4", border: "1px solid #0D9E6E22" }}>
                <div style={{ fontSize: 10, color: C.green, fontWeight: 800, marginBottom: 4 }}>MOST CONSISTENT RULE</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.primary, marginBottom: 3 }}>{strongestRule.label}</div>
                <div style={{ fontSize: 11, color: C.muted }}>
                  You follow this {strongestRule.compliancePct}% of the time ({strongestRule.timesFollowed || 0} of {ruleSample(strongestRule)} logged) — your strongest habit.
                </div>
              </div>
            )}
            {weakestRule && weakestRule.label !== strongestRule?.label && (
              <div style={{ padding: "12px 14px", borderRadius: 12, background: "#FEF2F2", border: "1px solid #DC262622" }}>
                <div style={{ fontSize: 10, color: C.red, fontWeight: 800, marginBottom: 4 }}>MOST SKIPPED RULE</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.primary, marginBottom: 3 }}>{weakestRule.label}</div>
                <div style={{ fontSize: 11, color: C.muted }}>
                  You follow this {weakestRule.compliancePct}% of the time ({weakestRule.timesFollowed || 0} of {ruleSample(weakestRule)} logged)
                  {ruleSample(weakestRule) < LOW_RULE_SAMPLE
                    ? " — still a small sample, so keep tracking it."
                    : " — your biggest blind spot."}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Coach advice ─────────────────────────────────────────────────────── */}
      {insights.length > 0 && (
        <div style={{ background: C.card, borderRadius: 16, border: `1px solid ${C.border}`, padding: "18px 16px" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.primary, marginBottom: 4 }}>What to do next</div>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 14 }}>Personalised actions based on your data</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {insights.map((ins, i) => {
              const isGood = ins.type === "positive";
              const borderCol = isGood ? "#0D9E6E22" : "#DC262622";
              const bg        = isGood ? "#F0FDF4"   : ins.type === "negative" ? "#FEF2F2" : "#F8FAFC";
              const dot       = isGood ? C.green     : ins.type === "negative" ? C.red     : C.muted;
              return (
                <div key={i} style={{ padding: "14px", borderRadius: 12, background: bg, border: `1px solid ${borderCol}` }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 6 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: dot, flexShrink: 0, marginTop: 3 }} />
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.primary, lineHeight: 1.4 }}>{ins.title}</div>
                  </div>
                  <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.6, marginBottom: ins.recommendation ? 8 : 0, paddingLeft: 16 }}>
                    {ins.insight}
                  </div>
                  {ins.recommendation && (
                    <div style={{ marginLeft: 16, fontSize: 11, color: C.blue, fontWeight: 600, padding: "7px 10px", background: "#EFF6FF", borderRadius: 8, lineHeight: 1.5 }}>
                      → {ins.recommendation}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ textAlign: "center", fontSize: 10, color: C.muted, paddingTop: 4 }}>
        {stats.totalTrades} trades · {stats.uniqueRules} rules · {stats.uniqueSetups} setups
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function DisciplinePage() {
  return (
    <ErrorBoundary>
      <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "'Inter',sans-serif" }}>
        <style>{`
          @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
          * { box-sizing: border-box; }
          button { transition: opacity 0.15s; }
          button:active { opacity: 0.7; }
        `}</style>
        <CandlestickBackground />
        <PageHeader />
        <div style={{ padding: "18px 16px 0" }}>
          <PageBackNav title="Discipline" subtitle="Are you following your process?" accent={C.blue} />
        </div>
        <Suspense fallback={<LoadingSkeleton />}>
          <DisciplineContent />
        </Suspense>
      </div>
    </ErrorBoundary>
  );
}
