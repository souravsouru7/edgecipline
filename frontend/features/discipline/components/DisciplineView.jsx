"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, ArrowRight, ClipboardList } from "lucide-react";
import PageHeader from "@/features/shared/components/PageHeader";
import { Card, CardHeader, SegmentedControl, EmptyState, ErrorState, Placeholder, Button } from "@/features/shared/components/ui";
import LazyRecharts from "@/features/shared/components/charts/LazyRecharts";
import { getDisciplineAnalytics } from "@/services/analyticsApi";
import { hasValidAuthToken } from "@/utils/auth";
import { TRADE_QUERY_FRESHNESS_OPTIONS } from "@/utils/queryInvalidation";
import { ruleSample, LOW_RULE_SAMPLE, pickWeakestRule, pickStrongestRule } from "@/utils/disciplineRules";

// One discipline screen for both markets. The two pages used to be
// near-identical copies that drifted apart (only Forex had the
// interpretation card, only Indian deferred the query a frame).

// Matches backend MIN_INSIGHT_TRADES in disciplineAnalytics.js
const MIN_SAMPLE_TRADES = 3;

const C = {
  green: "var(--ec-profit, #0D9E6E)",
  red: "var(--ec-loss, #DC2626)",
  amber: "var(--ec-warning, #D97706)",
  blue: "var(--ec-info, #3B82F6)",
  muted: "var(--ec-text-3, #94A3B8)",
  grid: "var(--ec-border, #F1F5F9)",
  ref: "var(--ec-border-strong, #CBD5E1)",
};

const RANGES = [
  { value: "", label: "All time" },
  { value: "30", label: "30d" },
  { value: "90", label: "90d" },
  { value: "180", label: "6m" },
  { value: "365", label: "1y" },
];
const PERIODS = [
  { value: "monthly", label: "Monthly" },
  { value: "weekly", label: "Weekly" },
  { value: "daily", label: "Daily" },
];

const MARKET = {
  Forex: { currency: "$", back: "/intelligence", addTrade: "/add-trade", setups: "/setups" },
  Indian_Market: { currency: "₹", back: "/indian-market/intelligence", addTrade: "/indian-market/add-trade", setups: "/indian-market/setups" },
};

export const fmtMoney = (n, cur = "$") => {
  const v = parseFloat(n || 0);
  const sym = cur === "₹" ? "₹" : "$";
  const abs = Math.abs(v);
  const s = abs >= 1000 ? `${sym}${(abs / 1000).toFixed(1)}K` : `${sym}${abs.toFixed(0)}`;
  return v >= 0 ? `+${s}` : `-${s}`;
};

export const scoreGrade = (n) => {
  if (n == null) return { label: "No data", tone: "muted" };
  if (n >= 80) return { label: "Excellent", tone: "good" };
  if (n >= 65) return { label: "Good", tone: "good" };
  if (n >= 50) return { label: "Average", tone: "warn" };
  return { label: "Needs work", tone: "bad" };
};

const toneOf = (pct) => (pct >= 75 ? "good" : pct >= 50 ? "warn" : "bad");

function buildInterpretation({ rules, topByCost, compliance, cur }) {
  const strongest = pickStrongestRule(rules);
  const weakest = pickWeakestRule(rules);
  const expensive = topByCost?.[0];
  const score = compliance?.compliancePct;
  return [
    {
      label: "Strongest habit",
      text: strongest
        ? `You follow "${strongest.label}" ${strongest.compliancePct}% of the time (${strongest.timesFollowed || 0} of ${ruleSample(strongest)} logged). This is the rule most embedded in your process.`
        : "Your strongest rule shows up once enough setup-rule history is logged.",
    },
    {
      label: "Weakest habit",
      text: weakest
        ? `"${weakest.label}" is your weakest tracked rule at ${weakest.compliancePct}% (${weakest.timesFollowed || 0} of ${ruleSample(weakest)} logged).` +
          (ruleSample(weakest) < LOW_RULE_SAMPLE
            ? " That is a small sample, so treat it as a flag to watch rather than a verdict."
            : " This is where discipline can improve fastest.")
        : "Add checklist and setup-rule data to reveal which rule breaks most often.",
    },
    {
      label: "Most expensive slip",
      text: expensive
        ? `Breaking "${expensive.label}" has cost roughly ${fmtMoney(-Math.abs(expensive.costOfBreaking || 0), cur)} across the tracked sample.`
        : "Once rule breaks connect to P&L, this shows the behaviour costing the most money.",
    },
    {
      label: "Next goal",
      text: score != null
        ? `Move your follow rate from ${score}% toward ${Math.min(100, Math.max(80, Math.ceil(score / 5) * 5 + 5))}%. Expect fewer low-quality trades and steadier setup selection.`
        : "Start by logging setup rules on each trade. The first milestone is 10 trades with rule data.",
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
          <strong>{p.value ?? "—"}</strong>
        </div>
      ))}
    </div>
  );
}

function LoadingView() {
  return (
    <div className="ec-disc__stack" aria-busy="true">
      <Placeholder height={180} radius={16} />
      <Placeholder height={140} radius={16} />
      <Placeholder height={220} radius={16} />
    </div>
  );
}

function Body({ market }) {
  const meta = MARKET[market] || MARKET.Forex;
  const router = useRouter();
  const [days, setDays] = useState("");
  const [period, setPeriod] = useState("monthly");

  useEffect(() => {
    if (!hasValidAuthToken()) router.replace("/login");
  }, [router]);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["discipline", market, period, days],
    queryFn: ({ signal }) => getDisciplineAnalytics(market, period, days, "", signal),
    ...TRADE_QUERY_FRESHNESS_OPTIONS,
  });

  // Hooks stay above every early return (React #310 otherwise).
  const timelineData = useMemo(
    () => (data?.timeline?.buckets || []).map((b) => ({ key: b.key, "Follow rate": b.compliancePct ?? null, "Win rate": b.winRate ?? null })),
    [data?.timeline?.buckets]
  );
  const rulesForChart = useMemo(
    () => [...(data?.ruleAnalytics || [])].sort((a, b) => (a.compliancePct ?? 0) - (b.compliancePct ?? 0)).slice(0, 10),
    [data?.ruleAnalytics]
  );
  const setupsForChart = useMemo(
    () => (data?.setupPerformance || []).filter((s) => s.trades >= 2).slice(0, 6),
    [data?.setupPerformance]
  );

  const filters = (
    <div className="ec-disc__filters">
      <SegmentedControl label="Date range" value={days} onChange={setDays} options={RANGES} />
      <SegmentedControl label="Group by" value={period} onChange={setPeriod} options={PERIODS} />
    </div>
  );

  if (isLoading) return <>{filters}<LoadingView /></>;

  if (error) {
    return (
      <>
        {filters}
        <Card><ErrorState title="Couldn't load discipline" body={error.message || "Check your connection and try again."} onRetry={() => refetch()} /></Card>
      </>
    );
  }

  if (!data || data.insufficient) {
    return (
      <>
        {filters}
        <Card>
          <EmptyState
            icon={<ClipboardList size={22} />}
            title="Not enough data yet"
            body={data?.message || "Log at least 10 trades with setup rules to see discipline analytics."}
            action={
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                <Button as={Link} href={meta.addTrade}>Log a trade</Button>
                <Button as={Link} href={meta.setups} variant="secondary">Set up rules</Button>
              </div>
            }
          />
        </Card>
      </>
    );
  }

  // Indian is always rupees (the old page hard-coded it); Forex trusts the server.
  const cur = market === "Indian_Market" ? "₹" : data.stats?.currency || meta.currency;
  const compliance = data.compliance || {};
  const overview = data.overview || {};
  const rules = data.ruleAnalytics || [];
  const topByCost = data.ruleCostAnalytics?.topByCost || [];
  const insights = (data.coachInsights || []).slice(0, 4);
  const dna = data.dnaIntegration || {};
  const stats = data.stats || {};
  const strongestRule = pickStrongestRule(rules);
  const weakestRule = pickWeakestRule(rules);
  const interpretation = buildInterpretation({ rules, topByCost, compliance, cur });

  const score = compliance.compliancePct;
  const grade = scoreGrade(score);
  const trendMap = {
    improving: { icon: <TrendingUp size={16} />, tone: "good", text: "Improving" },
    declining: { icon: <TrendingDown size={16} />, tone: "bad", text: "Declining" },
    stable: { icon: <ArrowRight size={16} />, tone: "muted", text: "Stable" },
  };
  const trend = trendMap[overview.trend] || trendMap.stable;
  const ranges = Array.isArray(data.psychologyCorrelation?.bySetupRange) ? data.psychologyCorrelation.bySetupRange : [];

  return (
    <>
      {filters}
      <div className="ec-disc__stack" style={{ opacity: isFetching ? 0.7 : 1, transition: "opacity .2s" }}>
        {/* Score */}
        <Card>
          <div className="ec-disc__eyebrow">Am I following my process?</div>
          <div className="ec-disc__score">
            <span className={`ec-disc__big ec-tone--${grade.tone}`}>{score != null ? `${score}%` : "—"}</span>
            <span>
              <span className={`ec-disc__grade ec-tone--${grade.tone}`}>{grade.label}</span>
              <span className="ec-disc__muted">rule follow rate</span>
            </span>
          </div>
          <div className="ec-disc__bar ec-disc__bar--lg" role="progressbar" aria-valuenow={score ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label="Rule follow rate">
            <span className={`ec-bg--${grade.tone}`} style={{ width: `${Math.min(100, Math.max(0, score ?? 0))}%` }} />
          </div>
          <div className="ec-disc__stats">
            <div><strong>{stats.totalTrades ?? 0}</strong><span>total trades</span></div>
            <div><strong>{stats.tradesWithRules ?? 0}</strong><span>with rules</span></div>
            <div><strong>{stats.uniqueRules ?? 0}</strong><span>rules tracked</span></div>
            <div className={`ec-disc__trend ec-tone--${trend.tone}`}>{trend.icon}<span>{trend.text}</span></div>
          </div>
        </Card>

        <Card>
          <CardHeader title="What it means" subtitle="Your rule-following, in plain words" />
          <div className="ec-disc__grid">
            {interpretation.map((item) => (
              <div key={item.label} className="ec-disc__tile">
                <div className="ec-disc__tile-label">{item.label}</div>
                <div className="ec-disc__tile-text">{item.text}</div>
              </div>
            ))}
          </div>
        </Card>

        {topByCost.length > 0 && (
          <Card>
            <CardHeader title="Rules costing you money" subtitle="What you lose each time you skip these" />
            <div className="ec-disc__list">
              {topByCost.slice(0, 5).map((r, i) => {
                const cost = parseFloat(r.costOfBreaking || 0);
                const hasDiff = r.timesFollowed > 0 && r.pnlDifference !== null && r.pnlDifference !== undefined;
                const diff = hasDiff ? parseFloat(r.pnlDifference) : 0;
                return (
                  <div key={r.label || i} className={`ec-disc__row${i === 0 ? " ec-disc__row--bad" : ""}`}>
                    <span className="ec-disc__rank">{i + 1}</span>
                    <div className="ec-disc__row-main">
                      <div className="ec-disc__row-title">{r.label}</div>
                      <div className="ec-disc__row-meta">
                        Broken {r.timesBroken} times
                        {hasDiff && diff !== 0 && (
                          <> · <span className={diff >= 0 ? "ec-tone--good" : "ec-tone--bad"}>{fmtMoney(diff, cur)}/trade when followed</span></>
                        )}
                      </div>
                    </div>
                    {cost > 0 && <span className="ec-disc__amount ec-tone--bad">-{fmtMoney(cost, cur).slice(1)}</span>}
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {rulesForChart.length > 0 && (
          <Card>
            <CardHeader title="Your rules" subtitle="How often you follow each rule, worst first" />
            <div className="ec-disc__rules">
              {rulesForChart.map((r, i) => {
                const pct = r.compliancePct ?? 0;
                const tone = toneOf(pct);
                return (
                  <div key={r.label || i}>
                    <div className="ec-disc__rule-head">
                      <span className="ec-disc__row-title">{r.label}</span>
                      <strong className={`ec-tone--${tone}`}>{pct}%</strong>
                    </div>
                    <div className="ec-disc__bar"><span className={`ec-bg--${tone}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></div>
                    <div className="ec-disc__row-meta">Followed {r.timesFollowed}× · Skipped {r.timesBroken}×</div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {timelineData.length >= 2 && (
          <Card>
            <CardHeader title="Is your discipline improving?" subtitle="Rule follow rate and win rate over time" />
            <div style={{ height: 180 }}>
              <LazyRecharts>{(R) => (
                <R.ResponsiveContainer width="100%" height="100%">
                  <R.LineChart data={timelineData}>
                    <R.CartesianGrid stroke={C.grid} strokeDasharray="3 3" vertical={false} />
                    <R.XAxis dataKey="key" tick={{ fontSize: 11, fill: C.muted }} axisLine={false} tickLine={false} />
                    <R.YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: C.muted }} width={28} axisLine={false} tickLine={false} />
                    <R.Tooltip content={<ChartTip />} />
                    <R.ReferenceLine y={70} stroke={C.ref} strokeDasharray="4 4" />
                    <R.Line type="monotone" dataKey="Follow rate" stroke={C.green} strokeWidth={2.5} dot={false} connectNulls />
                    <R.Line type="monotone" dataKey="Win rate" stroke={C.blue} strokeWidth={2} dot={false} strokeDasharray="5 3" connectNulls />
                  </R.LineChart>
                </R.ResponsiveContainer>
              )}</LazyRecharts>
            </div>
            <div className="ec-disc__legend">
              <span><i style={{ background: C.green }} />Follow rate</span>
              <span><i style={{ background: C.blue }} />Win rate</span>
              <span><i className="ec-disc__legend-dash" />70% target</span>
            </div>
          </Card>
        )}

        {setupsForChart.length > 0 && (
          <Card>
            <CardHeader title="Setup ranking" subtitle="By net P&L. Green is profitable, red is losing." />
            <div className="ec-disc__list">
              {setupsForChart.map((s, i) => {
                // Rank alone does not earn the badge: the top setup is still a
                // losing one when every setup loses money.
                const isBest = s.setupName === data.bestSetup?.setupName && s.netPnL > 0;
                const isWorst = s.setupName === data.worstSetup?.setupName && s.netPnL < 0;
                return (
                  <div key={s.setupName || i} className={`ec-disc__row${isBest ? " ec-disc__row--good" : isWorst ? " ec-disc__row--bad" : ""}`}>
                    <div className="ec-disc__row-main">
                      <div className="ec-disc__row-title">
                        {s.setupName || "Unspecified"}
                        {isBest && <span className="ec-disc__chip ec-disc__chip--good">Best</span>}
                        {isWorst && <span className="ec-disc__chip ec-disc__chip--bad">Weakest</span>}
                      </div>
                      <div className="ec-disc__row-meta">
                        {s.trades} trades · {s.winRate}% win rate
                        {s.avgDisciplineScore != null && ` · ${s.avgDisciplineScore}% discipline`}
                      </div>
                    </div>
                    <span className={`ec-disc__amount ${s.netPnL >= 0 ? "ec-tone--good" : "ec-tone--bad"}`}>{fmtMoney(s.netPnL, cur)}</span>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {ranges.length > 0 && (
          <Card>
            <CardHeader
              title="Does setup quality affect results?"
              subtitle={
                <>
                  Average P&L by setup score
                  {data.psychologyCorrelation.optimalThreshold != null && (
                    <strong className="ec-tone--info"> · aim for {data.psychologyCorrelation.optimalThreshold}+</strong>
                  )}
                </>
              }
            />
            <div style={{ height: 150 }}>
              <LazyRecharts>{(R) => (
                <R.ResponsiveContainer width="100%" height="100%">
                  <R.BarChart data={ranges.map((r) => ({ name: `${r.range} (n=${r.count})`, pnl: r.avgPnL ?? 0, count: r.count }))}>
                    <R.CartesianGrid stroke={C.grid} strokeDasharray="3 3" vertical={false} />
                    <R.XAxis dataKey="name" tick={{ fontSize: 11, fill: C.muted }} axisLine={false} tickLine={false} />
                    <R.YAxis tick={{ fontSize: 11, fill: C.muted }} width={40} axisLine={false} tickLine={false} />
                    <R.Tooltip content={<ChartTip />} cursor={{ fill: "var(--ec-surface-2)" }} />
                    <R.ReferenceLine y={0} stroke={C.ref} />
                    <R.Bar dataKey="pnl" name="Avg P&L" radius={[4, 4, 0, 0]}>
                      {ranges.map((r, i) => (
                        <R.Cell key={i} fill={(r.avgPnL ?? 0) >= 0 ? C.green : C.red} fillOpacity={r.count < MIN_SAMPLE_TRADES ? 0.35 : 1} />
                      ))}
                    </R.Bar>
                  </R.BarChart>
                </R.ResponsiveContainer>
              )}</LazyRecharts>
            </div>
            {ranges.some((r) => r.count < MIN_SAMPLE_TRADES) && (
              <p className="ec-disc__note">Faded bars have fewer than {MIN_SAMPLE_TRADES} trades, too few to draw a conclusion yet.</p>
            )}
          </Card>
        )}

        {(dna.mostValuableRule || strongestRule || weakestRule) && (
          <Card>
            <CardHeader title="Key takeaways" />
            <div className="ec-disc__list">
              {dna.mostValuableRule && (
                <div className="ec-disc__take ec-disc__take--info">
                  <div className="ec-disc__tile-label">Most valuable rule</div>
                  <div className="ec-disc__row-title">{dna.mostValuableRule.label}</div>
                  <div className="ec-disc__row-meta">
                    Following it gives you <strong className="ec-tone--good">{fmtMoney(dna.mostValuableRule.pnlDifference, cur)}/trade</strong> more than skipping it.
                  </div>
                </div>
              )}
              {strongestRule && (
                <div className="ec-disc__take ec-disc__take--good">
                  <div className="ec-disc__tile-label">Most consistent rule</div>
                  <div className="ec-disc__row-title">{strongestRule.label}</div>
                  <div className="ec-disc__row-meta">
                    You follow it {strongestRule.compliancePct}% of the time ({strongestRule.timesFollowed || 0} of {ruleSample(strongestRule)} logged), your strongest habit.
                  </div>
                </div>
              )}
              {weakestRule && weakestRule.label !== strongestRule?.label && (
                <div className="ec-disc__take ec-disc__take--bad">
                  <div className="ec-disc__tile-label">Most skipped rule</div>
                  <div className="ec-disc__row-title">{weakestRule.label}</div>
                  <div className="ec-disc__row-meta">
                    You follow it {weakestRule.compliancePct}% of the time ({weakestRule.timesFollowed || 0} of {ruleSample(weakestRule)} logged)
                    {ruleSample(weakestRule) < LOW_RULE_SAMPLE ? ", still a small sample, so keep tracking it." : ", your biggest blind spot."}
                  </div>
                </div>
              )}
            </div>
          </Card>
        )}

        {insights.length > 0 && (
          <Card>
            <CardHeader title="What to do next" subtitle="Actions based on your data" />
            <div className="ec-disc__list">
              {insights.map((ins, i) => {
                const tone = ins.type === "positive" ? "good" : ins.type === "negative" ? "bad" : "muted";
                return (
                  <div key={i} className={`ec-disc__take ec-disc__take--${tone}`}>
                    <div className="ec-disc__row-title">{ins.title}</div>
                    <div className="ec-disc__tile-text">{ins.insight}</div>
                    {ins.recommendation && <div className="ec-disc__rec">→ {ins.recommendation}</div>}
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        <p className="ec-disc__foot">
          {stats.totalTrades ?? 0} trades · {stats.uniqueRules ?? 0} rules · {stats.uniqueSetups ?? 0} setups
        </p>
      </div>
    </>
  );
}

export default function DisciplineView({ market = "Forex" }) {
  const meta = MARKET[market] || MARKET.Forex;
  return (
    <div className="ec-app ec-home">
      <PageHeader themed showMarketSwitcher title="Discipline" />
      <main className="ec-page ec-disc">
        <div className="ec-log__head">
          <div style={{ minWidth: 0 }}>
            <h1 className="ec-log__title">Discipline</h1>
            <p className="ec-log__sub">
              {market === "Indian_Market" ? "Indian market · " : ""}Are you following your process?
            </p>
          </div>
          <Link href={meta.back} className="ec-psy__back ec-focusable" style={{ marginBottom: 0 }}>Insights</Link>
        </div>
        <Body market={market} />
      </main>
    </div>
  );
}
