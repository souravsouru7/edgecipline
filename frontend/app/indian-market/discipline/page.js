"use client";

import { Suspense, useState, useEffect } from "react";
import ErrorBoundary from "@/components/ErrorBoundary";
import IndianMarketHeader from "@/components/IndianMarketHeader";
import { useQuery } from "@tanstack/react-query";
import { getDisciplineAnalytics } from "@/services/analyticsApi";
import { hasValidAuthToken } from "@/utils/auth";
import { useRouter } from "next/navigation";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, LineChart, Line,
} from "recharts";

const C = {
  primary: "#0F172A",
  green:   "#0D9E6E",
  red:     "#DC2626",
  amber:   "#D97706",
  blue:    "#2563EB",
  muted:   "#94A3B8",
  bg:      "#F0EEE9",
  card:    "#FFFFFF",
  border:  "#E2E8F0",
};

const fmt = (n, cur = "₹") => {
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

function Skel({ h = 16, w = "100%", r = 8 }) {
  return <div style={{ height: h, width: w, borderRadius: r, background: "#E2E8F0", animation: "pulse 1.4s ease infinite" }} />;
}

function LoadingSkeleton() {
  return (
    <div style={{ padding: "0 16px 40px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ background: C.card, borderRadius: 20, padding: 24, display: "flex", flexDirection: "column", gap: 12, border: `1px solid ${C.border}` }}>
        <Skel h={12} w="30%" /><Skel h={64} /><Skel h={14} w="60%" />
      </div>
      {[1,2,3].map(i => (
        <div key={i} style={{ background: C.card, borderRadius: 16, padding: 18, display: "flex", flexDirection: "column", gap: 10, border: `1px solid ${C.border}` }}>
          <Skel h={11} w="40%" /><Skel h={44} />
        </div>
      ))}
    </div>
  );
}

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

function DisciplineContent() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [days, setDays]       = useState("");
  const [period, setPeriod]   = useState("monthly");
  const market = "Indian_Market";

  useEffect(() => {
    setMounted(true);
    if (!hasValidAuthToken()) router.replace("/login");
  }, [router]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["discipline", market, period, days],
    queryFn: ({ signal }) => getDisciplineAnalytics(market, period, days, "", signal),
    enabled: mounted,
    staleTime: 90_000,
  });

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

  const cur       = "₹";
  const compliance = data.compliance || {};
  const overview   = data.overview || {};
  const rules      = data.ruleAnalytics || [];
  const topByCost  = data.ruleCostAnalytics?.topByCost || [];
  const setups     = data.setupPerformance || [];
  const timeline   = data.timeline?.buckets || [];
  const insights   = (data.coachInsights || []).slice(0, 4);
  const dna        = data.dnaIntegration || {};
  const stats      = data.stats || {};

  const score = compliance.compliancePct;
  const { label: grade, color: gradeColor } = scoreGrade(score);
  const trendMap = { improving: { arrow: "↑", color: C.green, text: "Improving" }, declining: { arrow: "↓", color: C.red, text: "Declining" }, stable: { arrow: "→", color: C.muted, text: "Stable" } };
  const trend = trendMap[overview.trend] || trendMap.stable;

  const timelineData = timeline.map(b => ({ key: b.key, "Follow rate": b.compliancePct ?? null, "Win rate": b.winRate ?? null }));
  const rulesForChart = [...rules].sort((a, b) => (a.compliancePct ?? 0) - (b.compliancePct ?? 0)).slice(0, 10);
  const setupsForChart = setups.filter(s => s.trades >= 2).slice(0, 6);

  return (
    <div style={{ padding: "0 16px 60px", display: "flex", flexDirection: "column", gap: 14 }}>

      {/* Filters */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {[["", "All time"], ["30", "30 days"], ["90", "90 days"], ["180", "6 months"], ["365", "1 year"]].map(([val, lbl]) => (
          <button key={val} onClick={() => setDays(val)} style={{
            padding: "6px 14px", borderRadius: 14, fontSize: 11, fontWeight: 700, cursor: "pointer",
            background: days === val ? C.blue : "#F1F5F9", color: days === val ? "#FFF" : "#64748B", border: "none",
          }}>{lbl}</button>
        ))}
        <div style={{ flex: 1 }} />
        {["monthly", "weekly", "daily"].map(p => (
          <button key={p} onClick={() => setPeriod(p)} style={{
            padding: "6px 12px", borderRadius: 14, fontSize: 11, fontWeight: 700, cursor: "pointer",
            background: period === p ? "#6366F1" : "#F1F5F9", color: period === p ? "#FFF" : "#64748B", border: "none",
          }}>{p[0].toUpperCase() + p.slice(1)}</button>
        ))}
      </div>

      {/* Hero */}
      <div style={{ background: C.card, borderRadius: 20, border: `1px solid ${C.border}`, padding: "22px 20px", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: "0.06em", marginBottom: 10 }}>AM I FOLLOWING MY PROCESS?</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 12, marginBottom: 14 }}>
          <div style={{ fontSize: 56, fontWeight: 900, color: gradeColor, lineHeight: 1 }}>{score != null ? `${score}%` : "—"}</div>
          <div style={{ paddingBottom: 6 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: gradeColor }}>{grade}</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>rule follow rate</div>
          </div>
        </div>
        <div style={{ height: 10, background: "#E2E8F0", borderRadius: 6, overflow: "hidden", marginBottom: 16 }}>
          <div style={{ width: `${Math.min(100, score ?? 0)}%`, height: "100%", background: `linear-gradient(90deg,${gradeColor},${gradeColor}aa)`, borderRadius: 6, transition: "width 0.8s ease" }} />
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div><div style={{ fontSize: 18, fontWeight: 800, color: C.primary }}>{stats.totalTrades ?? 0}</div><div style={{ fontSize: 10, color: C.muted }}>total trades</div></div>
          <div><div style={{ fontSize: 18, fontWeight: 800, color: C.primary }}>{stats.tradesWithRules ?? 0}</div><div style={{ fontSize: 10, color: C.muted }}>with rules</div></div>
          <div><div style={{ fontSize: 18, fontWeight: 800, color: C.primary }}>{stats.uniqueRules ?? 0}</div><div style={{ fontSize: 10, color: C.muted }}>rules tracked</div></div>
          <div style={{ marginLeft: "auto", textAlign: "right" }}>
            <div style={{ fontSize: 18, fontWeight: 900, color: trend.color }}>{trend.arrow}</div>
            <div style={{ fontSize: 10, color: C.muted }}>{trend.text}</div>
          </div>
        </div>
      </div>

      {/* Rules costing money */}
      {topByCost.length > 0 && (
        <div style={{ background: C.card, borderRadius: 16, border: `1px solid ${C.border}`, padding: "18px 16px" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.primary, marginBottom: 4 }}>Rules costing you money</div>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 14 }}>What you lose each time you skip these rules</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {topByCost.slice(0, 5).map((r, i) => {
              const cost = parseFloat(r.costOfBreaking || 0);
              const diff = parseFloat(r.pnlDifference || 0);
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 12, background: i === 0 ? "#FEF2F2" : "#FAFAFA", border: `1px solid ${i === 0 ? "#DC262622" : C.border}` }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, background: i === 0 ? "#FEE2E2" : "#F1F5F9", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, color: i === 0 ? C.red : C.muted }}>{i + 1}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.primary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.label}</div>
                    <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>
                      Broken {r.timesBroken} times
                      {diff !== 0 && <> · <span style={{ color: diff >= 0 ? C.green : C.red, fontWeight: 700 }}>{diff >= 0 ? "+" : ""}{fmt(diff, cur)}/trade when followed</span></>}
                    </div>
                  </div>
                  {cost > 0 && <div style={{ fontSize: 14, fontWeight: 900, color: C.red, flexShrink: 0, fontFamily: "'JetBrains Mono',monospace" }}>-{fmt(cost, cur).slice(1)}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Your rules */}
      {rulesForChart.length > 0 && (
        <div style={{ background: C.card, borderRadius: 16, border: `1px solid ${C.border}`, padding: "18px 16px" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.primary, marginBottom: 4 }}>Your rules</div>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 16 }}>How often you follow each rule — worst first</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {rulesForChart.map((r, i) => {
              const pct = r.compliancePct ?? 0;
              const col = barColor(pct);
              return (
                <div key={i}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: C.primary, flex: 1, paddingRight: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
                    <span style={{ fontSize: 11, fontWeight: 800, color: col, flexShrink: 0 }}>{pct}%</span>
                  </div>
                  <div style={{ height: 7, background: "#E2E8F0", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: col, borderRadius: 4, transition: "width 0.6s ease" }} />
                  </div>
                  <div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>Followed {r.timesFollowed}× · Skipped {r.timesBroken}×</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Timeline */}
      {timelineData.length >= 2 && (
        <div style={{ background: C.card, borderRadius: 16, border: `1px solid ${C.border}`, padding: "18px 16px" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.primary, marginBottom: 4 }}>Is your discipline improving?</div>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 14 }}>Rule follow rate and win rate over time</div>
          <div style={{ height: 160 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={timelineData}>
                <CartesianGrid stroke="#F1F5F9" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="key" tick={{ fontSize: 9, fill: C.muted }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: C.muted }} width={28} axisLine={false} tickLine={false} />
                <Tooltip content={<Tip />} />
                <ReferenceLine y={70} stroke="#CBD5E1" strokeDasharray="4 4" />
                <Line type="monotone" dataKey="Follow rate" stroke={C.green} strokeWidth={2.5} dot={false} connectNulls />
                <Line type="monotone" dataKey="Win rate" stroke={C.blue} strokeWidth={2} dot={false} strokeDasharray="5 3" connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}><div style={{ width: 16, height: 3, background: C.green, borderRadius: 2 }} /><span style={{ fontSize: 10, color: C.muted }}>Follow rate</span></div>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}><div style={{ width: 16, height: 3, background: C.blue, borderRadius: 2 }} /><span style={{ fontSize: 10, color: C.muted }}>Win rate</span></div>
          </div>
        </div>
      )}

      {/* Setups */}
      {setupsForChart.length > 0 && (
        <div style={{ background: C.card, borderRadius: 16, border: `1px solid ${C.border}`, padding: "18px 16px" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.primary, marginBottom: 4 }}>Which setups are profitable?</div>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 14 }}>Ranked by net profit</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {setupsForChart.map((s, i) => {
              const isBest  = s.setupName === data.bestSetup?.setupName;
              const isWorst = s.setupName === data.worstSetup?.setupName;
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 12, background: isBest ? "#F0FDF4" : isWorst ? "#FEF2F2" : "#FAFAFA", border: `1px solid ${isBest ? "#0D9E6E22" : isWorst ? "#DC262622" : C.border}` }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.primary }}>{s.setupName || "Unspecified"}</span>
                      {isBest  && <span style={{ fontSize: 9, fontWeight: 800, color: C.green, background: "#DCFCE7", borderRadius: 4, padding: "1px 5px" }}>BEST</span>}
                      {isWorst && <span style={{ fontSize: 9, fontWeight: 800, color: C.red,   background: "#FEE2E2", borderRadius: 4, padding: "1px 5px" }}>WEAKEST</span>}
                    </div>
                    <div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>
                      {s.trades} trades · {s.winRate}% win rate
                      {s.avgDisciplineScore != null && ` · ${s.avgDisciplineScore}% discipline`}
                    </div>
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 900, color: s.netPnL >= 0 ? C.green : C.red, flexShrink: 0, fontFamily: "'JetBrains Mono',monospace" }}>{fmt(s.netPnL, cur)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Setup score chart */}
      {Array.isArray(data.psychologyCorrelation?.bySetupRange) && data.psychologyCorrelation.bySetupRange.length > 0 && (
        <div style={{ background: C.card, borderRadius: 16, border: `1px solid ${C.border}`, padding: "18px 16px" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.primary, marginBottom: 4 }}>Does setup quality affect your results?</div>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 14 }}>
            Average P&L by setup score range
            {data.psychologyCorrelation.optimalThreshold != null && <span style={{ color: C.blue, fontWeight: 700 }}> — aim for {data.psychologyCorrelation.optimalThreshold}+</span>}
          </div>
          <div style={{ height: 130 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.psychologyCorrelation.bySetupRange.map(r => ({ name: r.range, pnl: r.avgPnL ?? 0 }))}>
                <CartesianGrid stroke="#F1F5F9" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 9, fill: C.muted }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: C.muted }} width={36} axisLine={false} tickLine={false} />
                <Tooltip content={<Tip />} />
                <ReferenceLine y={0} stroke="#CBD5E1" />
                <Bar dataKey="pnl" name="Avg P&L" radius={[4,4,0,0]}>
                  {data.psychologyCorrelation.bySetupRange.map((r, i) => <rect key={i} fill={(r.avgPnL ?? 0) >= 0 ? C.green : C.red} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Key takeaways */}
      {(dna.mostValuableRule || dna.strongestRule || dna.weakestRule) && (
        <div style={{ background: C.card, borderRadius: 16, border: `1px solid ${C.border}`, padding: "18px 16px" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.primary, marginBottom: 14 }}>Key takeaways</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {dna.mostValuableRule && (
              <div style={{ padding: "12px 14px", borderRadius: 12, background: "#F5F3FF", border: "1px solid #7C3AED22" }}>
                <div style={{ fontSize: 10, color: "#7C3AED", fontWeight: 800, marginBottom: 4 }}>MOST VALUABLE RULE</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.primary, marginBottom: 3 }}>{dna.mostValuableRule.label}</div>
                <div style={{ fontSize: 11, color: C.muted }}>Following this rule gives you <strong style={{ color: C.green }}>+{fmt(dna.mostValuableRule.pnlDifference, cur)}/trade</strong> more than when you skip it.</div>
              </div>
            )}
            {dna.strongestRule && (
              <div style={{ padding: "12px 14px", borderRadius: 12, background: "#F0FDF4", border: "1px solid #0D9E6E22" }}>
                <div style={{ fontSize: 10, color: C.green, fontWeight: 800, marginBottom: 4 }}>MOST CONSISTENT RULE</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.primary, marginBottom: 3 }}>{dna.strongestRule.label}</div>
                <div style={{ fontSize: 11, color: C.muted }}>You follow this {dna.strongestRule.compliancePct}% of the time — your strongest habit.</div>
              </div>
            )}
            {dna.weakestRule && dna.weakestRule.label !== dna.strongestRule?.label && (
              <div style={{ padding: "12px 14px", borderRadius: 12, background: "#FEF2F2", border: "1px solid #DC262622" }}>
                <div style={{ fontSize: 10, color: C.red, fontWeight: 800, marginBottom: 4 }}>MOST SKIPPED RULE</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.primary, marginBottom: 3 }}>{dna.weakestRule.label}</div>
                <div style={{ fontSize: 11, color: C.muted }}>You only follow this {dna.weakestRule.compliancePct}% of the time — your biggest blind spot.</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Coach advice */}
      {insights.length > 0 && (
        <div style={{ background: C.card, borderRadius: 16, border: `1px solid ${C.border}`, padding: "18px 16px" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.primary, marginBottom: 4 }}>What to do next</div>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 14 }}>Personalised actions based on your data</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {insights.map((ins, i) => {
              const isGood = ins.type === "positive";
              const bg     = isGood ? "#F0FDF4" : ins.type === "negative" ? "#FEF2F2" : "#F8FAFC";
              const dot    = isGood ? C.green   : ins.type === "negative" ? C.red     : C.muted;
              return (
                <div key={i} style={{ padding: "14px", borderRadius: 12, background: bg, border: `1px solid ${dot}22` }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 6 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: dot, flexShrink: 0, marginTop: 3 }} />
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.primary, lineHeight: 1.4 }}>{ins.title}</div>
                  </div>
                  <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.6, marginBottom: ins.recommendation ? 8 : 0, paddingLeft: 16 }}>{ins.insight}</div>
                  {ins.recommendation && (
                    <div style={{ marginLeft: 16, fontSize: 11, color: C.blue, fontWeight: 600, padding: "7px 10px", background: "#EFF6FF", borderRadius: 8, lineHeight: 1.5 }}>→ {ins.recommendation}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ textAlign: "center", fontSize: 10, color: C.muted, paddingTop: 4 }}>
        {stats.totalTrades} trades · {stats.uniqueRules} rules · {stats.uniqueSetups} setups
      </div>
    </div>
  );
}

export default function IndianDisciplinePage() {
  return (
    <ErrorBoundary>
      <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "'Inter',sans-serif" }}>
        <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}*{box-sizing:border-box}button{transition:opacity 0.15s}button:active{opacity:0.7}`}</style>
        <IndianMarketHeader />
        <div style={{ padding: "16px 16px 0" }}>
          <div style={{ fontSize: 20, fontWeight: 900, color: "#0F172A", marginBottom: 2 }}>Discipline</div>
          <div style={{ fontSize: 12, color: "#94A3B8", marginBottom: 16 }}>Are you following your process?</div>
        </div>
        <Suspense fallback={<LoadingSkeleton />}>
          <DisciplineContent />
        </Suspense>
      </div>
    </ErrorBoundary>
  );
}
