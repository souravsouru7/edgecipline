"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, ArrowRight, Sparkles, LineChart as LineIcon, Brain, Search, Trophy, AlertTriangle, Target, Pin } from "lucide-react";
import ErrorBoundary from "@/components/ErrorBoundary";
import PageHeader from "@/features/shared/components/PageHeader";
import { Button, Card, CardHeader, EmptyState, ErrorState, Placeholder, SegmentedControl, Select } from "@/features/shared/components/ui";
import LazyRecharts from "@/features/shared/components/charts/LazyRecharts";
import { getPsychologyTimeline } from "@/services/analyticsApi";
import { hasValidAuthToken } from "@/utils/auth";
import { TRADE_QUERY_FRESHNESS_OPTIONS } from "@/utils/queryInvalidation";
import { MARKETS, useMarket } from "@/context/MarketContext";

// Series colours stay distinct in both themes; neutrals follow the theme.
const C = {
  psych: "#8B6CF6",
  aware: "#4C8DF6",
  disc: "var(--ec-profit, #0D9E6E)",
  pos: "var(--ec-profit, #0D9E6E)",
  neg: "var(--ec-loss, #DC2626)",
  warn: "var(--ec-warning, #D97706)",
  mood: "#E0A030",
  muted: "var(--ec-text-3, #94A3B8)",
  grid: "var(--ec-border, #F1F5F9)",
  ref: "var(--ec-border-strong, #CBD5E1)",
};

const PERIODS = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];
const DAYS_OPTIONS = [
  { value: "", label: "All time" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "180", label: "Last 6 months" },
  { value: "365", label: "Last year" },
];

const TREND = {
  improving: { icon: <TrendingUp size={18} />, tone: "good", text: "Improving" },
  declining: { icon: <TrendingDown size={18} />, tone: "bad", text: "Declining" },
  stable: { icon: <ArrowRight size={18} />, tone: "muted", text: "Stable" },
};

const MILESTONE = {
  psychology_threshold: { icon: Brain, tone: "info" },
  self_awareness_threshold: { icon: Search, tone: "info" },
  best_psychology: { icon: Trophy, tone: "good" },
  worst_psychology: { icon: AlertTriangle, tone: "bad" },
  revenge_free_streak: { icon: Target, tone: "warn" },
};

function scoreTone(n) {
  if (n === null || n === undefined) return "muted";
  if (n >= 70) return "good";
  if (n >= 45) return "warn";
  return "bad";
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
      label: "Growth summary",
      text: delta == null
        ? `Your timeline has ${buckets.length} ${buckets.length === 1 ? "period" : "periods"} so far. It gets clearer with every week you log.`
        // Name both periods. The coach summary quotes an average of the last
        // three, so an unlabelled "latest period" number reads as a contradiction.
        : `In ${latest?.key ?? "the latest period"} your psychology score is ${latestPsych}/100, ${improving ? "up" : declining ? "down" : "flat"} ${Math.abs(delta)} points from ${first?.key ?? "the first tracked period"}.`,
    },
    {
      label: "What's improving",
      text: trends?.psychology === "improving" || trends?.selfAwareness === "improving" || trends?.discipline === "improving"
        ? `Improving: ${[
            trends?.psychology === "improving" ? "psychology" : null,
            trends?.selfAwareness === "improving" ? "self-awareness" : null,
            trends?.discipline === "improving" ? "discipline" : null,
          ].filter(Boolean).join(", ")}. These are the habits to keep repeating.`
        : "No clear upward trend yet. Keep logging emotions, trade quality and rule adherence so real growth stands out from noise.",
    },
    {
      label: "Still to work on",
      text: trends?.psychology === "declining" || trends?.selfAwareness === "declining" || trends?.discipline === "declining"
        ? `The weak signal right now is ${focus}. Work on that before adding strategy complexity.`
        : "The main opportunity is consistency: fill in the same review fields on every trade so progress is easy to measure.",
    },
    {
      label: "Current focus",
      text: (() => {
        const n = stats?.totalBuckets || buckets.length;
        return `Next review cycle, focus on ${focus}. Expect a calmer baseline and fewer preventable mistakes across ${n} tracked ${n === 1 ? "period" : "periods"}.`;
      })(),
    },
  ];
}

function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="ec-chart-tip">
      <div className="ec-chart-tip__title">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="ec-chart-tip__row">
          <span style={{ color: p.color }}>{p.name}</span>
          <strong>{p.value !== null && p.value !== undefined ? p.value : "—"}</strong>
        </div>
      ))}
    </div>
  );
}

function ChartCard({ title, subtitle, height, loading, children, footer }) {
  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} />
      {loading ? <Placeholder height={height} radius={10} /> : <div style={{ height }}>{children}</div>}
      {!loading && footer}
    </Card>
  );
}

const axis = { tick: { fontSize: 11, fill: C.muted }, axisLine: false, tickLine: false };

function PsychologyTimelineContent() {
  const router = useRouter();
  const { currentMarket } = useMarket();
  const [period, setPeriod] = useState("weekly");
  const [days, setDays] = useState("");
  const addTradeHref = currentMarket === MARKETS.INDIAN_MARKET ? "/indian-market/add-trade" : "/add-trade";

  useEffect(() => {
    if (!hasValidAuthToken()) router.replace("/login");
  }, [router]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["psychologyTimeline", currentMarket, period, days],
    queryFn: ({ signal }) => getPsychologyTimeline(currentMarket, period, days, signal),
    ...TRADE_QUERY_FRESHNESS_OPTIONS,
  });

  const loading = isLoading;
  const insufficient = data?.insufficient;
  const buckets = data?.buckets || [];
  const trends = data?.trends || {};
  const milestones = data?.milestones || [];
  const stats = data?.stats || {};
  const interpretation = buildTimelineInterpretation({ buckets, trends, stats }) || [];

  const chartData = buckets.map((b) => ({
    key: b.key,
    psych: b.psychologyScore,
    aware: b.selfAwarenessScore,
    disc: b.disciplineScore,
    net: b.net,
    trades: b.tradeCount,
    avgMood: b.emotions?.avgMood ?? null,
  }));

  let body;
  if (!loading && error) {
    body = <Card><ErrorState title="Couldn't load your timeline" onRetry={() => refetch()} /></Card>;
  } else if (!loading && (insufficient || buckets.length === 0)) {
    body = (
      <Card>
        <EmptyState
          icon={<LineIcon size={22} />}
          title={data?.reason === "no_trades" ? "No trading history yet" : "Not enough data yet"}
          body={data?.message || "Log trades with emotion tags and quality ratings to build your psychology timeline."}
          action={<Button as={Link} href={addTradeHref}>Log a trade</Button>}
        />
      </Card>
    );
  } else {
    body = (
      <div className="ec-disc__stack">
        <div className="ec-ptl__trends">
          {loading ? (
            [1, 2, 3, 4].map((i) => <Placeholder key={i} height={92} radius={14} />)
          ) : (
            <>
              {[["Psychology", trends.psychology], ["Self-awareness", trends.selfAwareness], ["Discipline", trends.discipline]].map(([label, t]) => {
                const tr = TREND[t] || TREND.stable;
                return (
                  <div key={label} className="ec-ptl__trend">
                    <span className={`ec-tone--${tr.tone}`}>{tr.icon}</span>
                    <span className="ec-ptl__trend-label">{label}</span>
                    <strong className={`ec-tone--${tr.tone}`}>{tr.text}</strong>
                  </div>
                );
              })}
              {stats.avgPsychologyScore != null && (
                <div className="ec-ptl__stats">
                  {[
                    { label: "Average", value: stats.avgPsychologyScore, tone: scoreTone(stats.avgPsychologyScore), suffix: "/100" },
                    { label: "Best", value: stats.bestPsychologyScore, tone: "good" },
                    { label: "Worst", value: stats.worstPsychologyScore, tone: "bad" },
                    { label: "Periods", value: stats.totalBuckets, tone: "muted" },
                  ].map((s) => (
                    <div key={s.label}>
                      <strong className={`ec-tone--${s.tone}`}>{s.value ?? "—"}{s.value != null ? s.suffix || "" : ""}</strong>
                      <span>{s.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <Card>
          <div className="ec-ptl__ai-head">
            <Sparkles size={16} aria-hidden="true" />
            <h2 className="ec-card__title">Coach summary</h2>
          </div>
          {loading ? (
            <div className="ec-disc__stack" style={{ gap: 6 }}>
              <Placeholder height={12} /><Placeholder height={12} width="85%" /><Placeholder height={12} width="92%" />
            </div>
          ) : (
            <p className="ec-ptl__ai">{data?.aiSummary || "Your coach summary appears once a few periods are logged."}</p>
          )}
        </Card>

        <Card>
          <CardHeader title="What it means" subtitle="Your psychology trend in plain words" />
          {loading ? (
            <div className="ec-disc__grid">{[1, 2, 3, 4].map((i) => <Placeholder key={i} height={86} radius={10} />)}</div>
          ) : (
            <div className="ec-disc__grid">
              {interpretation.map((item) => (
                <div key={item.label} className="ec-disc__tile">
                  <div className="ec-disc__tile-label">{item.label}</div>
                  <div className="ec-disc__tile-text">{item.text}</div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <ChartCard
          title="Psychology score"
          subtitle={`Emotional health per ${{ daily: "day", weekly: "week", monthly: "month" }[period] || "period"}. Higher is healthier.`}
          height={220}
          loading={loading}
          footer={
            <div className="ec-disc__legend">
              <span><i style={{ background: C.psych }} />Psychology</span>
              <span><i style={{ background: C.pos }} />70+ healthy</span>
              <span><i style={{ background: C.warn }} />45+ average</span>
              <span><i style={{ background: C.neg }} />Under 45 costly</span>
            </div>
          }
        >
          <LazyRecharts>{(R) => (
            <R.ResponsiveContainer width="100%" height="100%">
              <R.ComposedChart data={chartData}>
                <R.CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
                <R.XAxis dataKey="key" {...axis} interval="preserveStartEnd" />
                {/* Score and P&L are different units, so they need separate
                    axes. Sharing one let P&L widen the 0-100 domain and
                    flattened the score line. */}
                <R.YAxis yAxisId="score" domain={[0, 100]} allowDataOverflow {...axis} width={28} />
                <R.YAxis yAxisId="pnl" hide domain={["dataMin", "dataMax"]} />
                <R.Tooltip content={<ChartTip />} cursor={{ fill: "var(--ec-surface-2)" }} />
                <R.ReferenceLine yAxisId="score" y={70} stroke={C.pos} strokeDasharray="4 4" strokeOpacity={0.5} />
                <R.ReferenceLine yAxisId="score" y={45} stroke={C.warn} strokeDasharray="4 4" strokeOpacity={0.4} />
                <R.Bar yAxisId="pnl" dataKey="net" name="Net P&L" fill={C.ref} opacity={0.35} radius={[2, 2, 0, 0]} />
                <R.Line yAxisId="score" type="monotone" dataKey="psych" name="Psychology" stroke={C.psych} strokeWidth={2.5} dot={{ r: 3, fill: C.psych }} activeDot={{ r: 5 }} connectNulls />
              </R.ComposedChart>
            </R.ResponsiveContainer>
          )}</LazyRecharts>
        </ChartCard>

        <ChartCard
          title="Self-awareness and discipline"
          subtitle="How accurately you rate yourself, and how well you follow your rules"
          height={200}
          loading={loading}
          footer={
            <div className="ec-disc__legend">
              <span><i style={{ background: C.aware }} />Self-awareness</span>
              <span><i style={{ background: C.disc }} />Discipline</span>
            </div>
          }
        >
          <LazyRecharts>{(R) => (
            <R.ResponsiveContainer width="100%" height="100%">
              <R.LineChart data={chartData}>
                <R.CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
                <R.XAxis dataKey="key" {...axis} interval="preserveStartEnd" />
                <R.YAxis domain={[0, 100]} {...axis} width={28} />
                <R.Tooltip content={<ChartTip />} />
                <R.Line type="monotone" dataKey="aware" name="Self-awareness" stroke={C.aware} strokeWidth={2} dot={{ r: 3, fill: C.aware }} connectNulls />
                <R.Line type="monotone" dataKey="disc" name="Discipline" stroke={C.disc} strokeWidth={2} dot={{ r: 3, fill: C.disc }} connectNulls />
              </R.LineChart>
            </R.ResponsiveContainer>
          )}</LazyRecharts>
        </ChartCard>

        <ChartCard title="P&L per period" subtitle="Net profit or loss for each period" height={180} loading={loading}>
          <LazyRecharts>{(R) => (
            <R.ResponsiveContainer width="100%" height="100%">
              <R.BarChart data={chartData}>
                <R.CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
                <R.XAxis dataKey="key" {...axis} interval="preserveStartEnd" />
                <R.YAxis {...axis} width={44} />
                <R.Tooltip content={<ChartTip />} cursor={{ fill: "var(--ec-surface-2)" }} />
                <R.ReferenceLine y={0} stroke={C.ref} />
                <R.Bar dataKey="net" name="Net P&L" radius={[3, 3, 0, 0]}>
                  {chartData.map((entry, i) => <R.Cell key={i} fill={(entry.net ?? 0) >= 0 ? C.pos : C.neg} />)}
                </R.Bar>
              </R.BarChart>
            </R.ResponsiveContainer>
          )}</LazyRecharts>
        </ChartCard>

        <div className="ec-ptl__two">
          <Card>
            <CardHeader title="Milestones" subtitle="Key moments in your psychology journey" />
            {loading ? (
              <div className="ec-disc__stack" style={{ gap: 10 }}><Placeholder height={64} radius={10} /><Placeholder height={64} radius={10} /></div>
            ) : milestones.length === 0 ? (
              <p className="ec-disc__note" style={{ textAlign: "center", padding: "20px 0" }}>Keep trading consistently. Milestones appear as your history grows.</p>
            ) : (
              <div className="ec-ptl__milestones">
                {milestones.map((m, i) => {
                  const meta = MILESTONE[m.type] || { icon: Pin, tone: "muted" };
                  const Icon = meta.icon;
                  return (
                    <div key={`${m.type}-${m.key}-${i}`} className={`ec-disc__take ec-disc__take--${meta.tone}`} style={{ display: "flex", gap: 10 }}>
                      <span className={`ec-tone--${meta.tone}`} style={{ flexShrink: 0, marginTop: 1 }}><Icon size={16} aria-hidden="true" /></span>
                      <div style={{ minWidth: 0 }}>
                        <div className="ec-disc__row-title">{m.title}</div>
                        {m.key && <div className="ec-disc__row-meta">{m.key}</div>}
                        {m.description && <div className="ec-disc__tile-text" style={{ marginTop: 4 }}>{m.description}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <ChartCard title="Average mood" subtitle="1 = stressed, 5 = peak" height={200} loading={loading}>
            {chartData.some((d) => d.avgMood !== null) ? (
              <LazyRecharts>{(R) => (
                <R.ResponsiveContainer width="100%" height="100%">
                  <R.LineChart data={chartData}>
                    <R.CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
                    <R.XAxis dataKey="key" {...axis} interval="preserveStartEnd" />
                    <R.YAxis domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} {...axis} width={20} />
                    <R.Tooltip content={<ChartTip />} />
                    <R.ReferenceLine y={3} stroke={C.ref} strokeDasharray="4 4" />
                    <R.Line type="monotone" dataKey="avgMood" name="Avg mood" stroke={C.mood} strokeWidth={2} dot={{ r: 3, fill: C.mood }} connectNulls />
                  </R.LineChart>
                </R.ResponsiveContainer>
              )}</LazyRecharts>
            ) : (
              <div className="ec-chart-empty" style={{ height: "100%" }}>Log trades with a mood rating to see this chart.</div>
            )}
          </ChartCard>
        </div>

        <ChartCard title="Trade activity" subtitle="Number of trades per period" height={130} loading={loading}>
          <LazyRecharts>{(R) => (
            <R.ResponsiveContainer width="100%" height="100%">
              <R.BarChart data={chartData}>
                <R.CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
                <R.XAxis dataKey="key" {...axis} interval="preserveStartEnd" />
                <R.YAxis {...axis} width={24} allowDecimals={false} />
                <R.Tooltip content={<ChartTip />} cursor={{ fill: "var(--ec-surface-2)" }} />
                <R.Bar dataKey="trades" name="Trades" fill={C.psych} fillOpacity={0.35} stroke={C.psych} strokeWidth={1} radius={[2, 2, 0, 0]} />
              </R.BarChart>
            </R.ResponsiveContainer>
          )}</LazyRecharts>
        </ChartCard>
      </div>
    );
  }

  return (
    <div className="ec-app ec-home">
      <PageHeader themed showMarketSwitcher title="Psychology timeline" />
      <main className="ec-page ec-disc">
        <div className="ec-log__head">
          <div style={{ minWidth: 0 }}>
            <h1 className="ec-log__title">Psychology timeline</h1>
            <p className="ec-log__sub">How your mindset, discipline and self-awareness change over time.</p>
          </div>
        </div>
        <div className="ec-disc__filters">
          <SegmentedControl label="Group by" value={period} onChange={setPeriod} options={PERIODS} />
          <Select aria-label="Date range" value={days} onChange={(e) => setDays(e.target.value)} style={{ width: "auto", minWidth: 150 }}>
            {DAYS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </div>
        {body}
      </main>
    </div>
  );
}

export default function PsychologyTimelinePage() {
  return (
    <ErrorBoundary fallback={<div style={{ padding: "2rem", textAlign: "center" }}>Psychology timeline failed to load. Please refresh.</div>}>
      <Suspense><PsychologyTimelineContent /></Suspense>
    </ErrorBoundary>
  );
}
