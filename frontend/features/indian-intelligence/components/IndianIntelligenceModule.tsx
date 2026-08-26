"use client";

import { Suspense, type ComponentType } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BrainCircuit,
  CheckCircle2,
  Fingerprint,
  Lightbulb,
  Search,
  ShieldAlert,
  Sparkles,
  Target,
} from "lucide-react";
import ErrorBoundary from "@/components/ErrorBoundary";
import CandlestickBackground from "@/features/shared/components/CandlestickBackground";
import PageHeader from "@/features/shared/components/PageHeader";
import TickerTape from "@/features/shared/components/TickerTape";
import { Skeleton } from "@/features/shared";
import {
  type IndianInsight,
  type IndianInstrumentType,
  type IndianIntelligenceSummary,
} from "../api/indianIntelligenceApi";
import AICoachFeedWidget from "@/features/ai-coach/components/AICoachFeedWidget";
import { useIndianIntelligence } from "../hooks/useIndianIntelligence";
import { type IndianIntelligenceModuleSlug } from "../modules";
import { useState } from "react";

const IndianCandlestickBackground = CandlestickBackground as unknown as ComponentType<{ canvasId?: string }>;
const LoadingSkeleton = Skeleton as unknown as ComponentType<{
  width?: string | number;
  height?: string | number;
  variant?: "text" | "circle" | "rect";
}>;

type ModuleConfig = {
  title: string;
  eyebrow: string;
  description: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  accent: string;
};

const MODULE_CONFIG: Record<IndianIntelligenceModuleSlug, ModuleConfig> = {
  "trading-dna": {
    title: "Trading DNA",
    eyebrow: "Behavioral fingerprint",
    description: "The repeatable conditions, habits, and execution choices shaping your Indian-market results.",
    icon: Fingerprint,
    accent: "#6941C6",
  },
  patterns: {
    title: "Pattern Detection",
    eyebrow: "Repeatable edge",
    description: "Evidence-backed combinations that are working across your Indian equity and options trades.",
    icon: Search,
    accent: "#B77900",
  },
  "risk-patterns": {
    title: "Risk Patterns",
    eyebrow: "Loss prevention",
    description: "Repeated conditions connected to losses, with a practical guardrail for the next trade.",
    icon: ShieldAlert,
    accent: "#D13B3B",
  },
  "psychology-cost": {
    title: "Psychology Cost",
    eyebrow: "Behavioral P&L",
    description: "The measured rupee impact of impulsive entries, emotional states, and discipline gaps.",
    icon: BrainCircuit,
    accent: "#C43232",
  },
  "self-awareness": {
    title: "Self Awareness",
    eyebrow: "Review calibration",
    description: "A clear view of data quality, plan adherence, and whether your process is improving.",
    icon: Target,
    accent: "#2563EB",
  },
  "ai-coach": {
    title: "Coach Feed",
    eyebrow: "Next best action",
    description: "One prioritized coaching cue selected from your own Indian-market trading evidence.",
    icon: Sparkles,
    accent: "#008A5B",
  },
};

const FILTERS: Array<{ value: IndianInstrumentType; label: string }> = [
  { value: "ALL", label: "All Indian" },
  { value: "OPTION", label: "Options" },
  { value: "EQUITY", label: "Equity" },
];

function inr(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
    signDisplay: "exceptZero",
  }).format(value || 0);
}

function moduleInsights(module: IndianIntelligenceModuleSlug, data: IndianIntelligenceSummary) {
  switch (module) {
    // The DNA view is the whole fingerprint — what works and what does not —
    // ranked by the engine's priority. Pattern Detection stays edge-only, so
    // the two modules never render the same list.
    case "trading-dna":
      return [...data.strengths, ...data.leaks].sort((a, b) => b.priority - a.priority);
    case "patterns":
      return data.strengths;
    case "risk-patterns":
      return data.leaks;
    case "psychology-cost": {
      const psychologyLeaks = data.leaks.filter((item) => item.theme === "mindset" || item.theme === "discipline");
      return psychologyLeaks.length ? psychologyLeaks : data.leaks;
    }
    case "ai-coach":
      return data.doNow ? [data.doNow] : [];
    default:
      return [];
  }
}

// Absolute amount for prose ("recover the ₹13,085"); `inr` adds a +/- sign.
function inrAbs(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Math.abs(value || 0));
}

// The widget keys its badge colours off these exact strings.
const COACH_CATEGORY: Record<string, string> = {
  discipline: "Discipline",
  mindset: "Psychology",
  timing: "Pattern",
  setup: "TradingDNA",
};

function priorityBand(score: number) {
  return score >= 60 ? "high" : score >= 40 ? "medium" : "low";
}

// Maps the Indian intelligence summary onto the shape AICoachFeedWidget wants,
// so the coach page runs the same engine as every other Indian module instead
// of the analytics coachFeed, which reports gross P&L and ranks differently.
function toIndianCoachFeed(data: IndianIntelligenceSummary) {
  const ranked = [...data.leaks, ...data.strengths].sort((a, b) => b.priority - a.priority);
  const ordered = data.doNow
    ? [data.doNow, ...ranked.filter((item) => item.id !== data.doNow!.id)]
    : ranked;

  const insights = ordered.map((item) => {
    const negative = item.category === "leak";
    return {
      id: item.id,
      category: COACH_CATEGORY[item.theme] || "Pattern",
      type: negative ? "negative" : "positive",
      priority: priorityBand(item.priority),
      title: item.title,
      insight: item.evidence,
      evidence: `${item.sampleSize} trades · Win rate: ${item.stats.winRate}% · Net P&L: ${inr(item.stats.netPnl)} · ${item.confidence.label}`,
      recommendation: item.action,
      whyItMatters: negative
        ? `This condition appears in ${item.sampleSize} of your ${data.sample.totalTrades} tracked trades, so the cost repeats instead of being a one-off.`
        : `This holds across ${item.sampleSize} trades rather than a lucky run, which is what makes it worth protecting.`,
      expectedOutcome: negative
        ? `Removing it should recover most of the ${inrAbs(item.stats.netPnl)} currently tied to this condition.`
        : `Keeping it mandatory should hold the ${inrAbs(item.stats.netPnl)} it has produced so far.`,
    };
  });

  return {
    insights,
    stats: {
      negative: insights.filter((i) => i.type === "negative").length,
      positive: insights.filter((i) => i.type === "positive").length,
    },
    generatedAt: data.generatedAt,
    insufficient: insights.length === 0,
  };
}

// Same component Forex renders at /analytics/ai-coach — Ask Coach, Show
// Details, per-card dismiss and the down/up counters all come for free.
function IndianCoachFeedWidget({ data }: { data: IndianIntelligenceSummary }) {
  return (
    <section className="coach-widget-host">
      <AICoachFeedWidget feed={toIndianCoachFeed(data)} loading={false} currency="₹" market="Indian_Market" delay={0.1} />
    </section>
  );
}

function InsightCard({ insight, accent, index }: { insight: IndianInsight; accent: string; index: number }) {
  return (
    <article className="insight-card">
      <div className="insight-rank" style={{ color: accent, background: `${accent}12` }}>{String(index + 1).padStart(2, "0")}</div>
      <div className="insight-copy">
        <div className="insight-tags">
          <span>{insight.theme}</span>
          <span>{insight.confidence.label}</span>
        </div>
        <h3>{insight.title}</h3>
        <p>{insight.evidence}</p>
        <div className="insight-action"><Lightbulb size={15} /> {insight.action}</div>
      </div>
      <div className="insight-stats" aria-label="Pattern statistics">
        <strong style={{ color: insight.category === "leak" ? "#C43232" : "#008A5B" }}>{inr(insight.stats.netPnl)}</strong>
        <span>{insight.stats.winRate}% win rate</span>
        <span>{insight.sampleSize} trades</span>
      </div>
    </article>
  );
}

function EmptyEvidence({ data, accent }: { data: IndianIntelligenceSummary; accent: string }) {
  const tradesNeeded = Math.max(0, 5 - data.sample.totalTrades);
  return (
    <div className="empty-state">
      <div className="empty-icon" style={{ color: accent, background: `${accent}10` }}><Search size={25} /></div>
      <h3>No reliable pattern yet</h3>
      <p>
        {tradesNeeded > 0
          ? `Log ${tradesNeeded} more complete ${tradesNeeded === 1 ? "trade" : "trades"} to reach the first evidence threshold.`
          : "There is enough trade history, but no stable positive or negative pattern meets the evidence threshold yet."}
      </p>
      <Link href="/indian-market/add-trade" className="primary-link">Log an Indian trade</Link>
    </div>
  );
}

// Mirrors the structure the Forex Self Awareness section uses: hard numbers in
// stat tiles, then a plain-language interpretation grid. Bars alone tell the
// trader a percentage but never what to do about it.
function StatTile({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="stat-tile">
      <span className="stat-label">{label}</span>
      <strong style={{ color }}>{value}</strong>
      <span className="stat-sub">{sub}</span>
    </div>
  );
}

function InterpretationGrid({ items, accent }: { items: Array<{ label: string; text: string }>; accent: string }) {
  return (
    <div className="interpretation-grid">
      {items.map((item) => (
        <div key={item.label} style={{ borderColor: `${accent}24`, background: `${accent}08` }}>
          <div className="interpretation-label" style={{ color: accent }}>{item.label}</div>
          <p>{item.text}</p>
        </div>
      ))}
    </div>
  );
}

function buildAwarenessInterpretation(data: IndianIntelligenceSummary) {
  const ACCENT = "#2563EB";
  const adherence = data.progress.planAdherence;
  const pnl = data.progress.netPnl;
  const compared = data.progress.comparedTrades;
  const planned = data.strengths.find((i) => i.key === "Planned entries");
  const unplanned = data.leaks.find((i) => i.key === "Emotional or impulsive entries");
  const topLeak = data.leaks[0];
  const gaps = Object.entries(data.dataQuality.coverage)
    .filter(([, v]) => v.percentage < 100)
    .sort(([, a], [, b]) => a.percentage - b.percentage);
  const worst = gaps[0];
  const pct = adherence.currentPct;

  const meaning = pct == null
    ? `Plan adherence is still forming. Log a few more entries with an entry basis so the last ${compared.recent} trades can be compared against the ${compared.previous} before them.`
    : `${Math.round((pct / 100) * compared.recent)} of your last ${compared.recent} entries came from a plan (${pct}%), against ${adherence.previousPct == null ? "no prior block yet" : `${adherence.previousPct}% in the ${compared.previous} before them`}.`;

  const why = planned && unplanned
    ? `This is the split that decides your P&L: planned entries are ${inr(planned.stats.netPnl)} across ${planned.stats.sampleSize} trades at ${planned.stats.winRate}% win rate, while unplanned ones are ${inr(unplanned.stats.netPnl)} across ${unplanned.stats.sampleSize} at ${unplanned.stats.winRate}%.`
    : "Accurate self-review lets you fix the right thing instead of abandoning a working strategy after one bad outcome.";

  const focus = worst
    ? `Journal coverage is ${data.dataQuality.overallPercentage}%. The one gap is ${worst[0].replace(/([A-Z])/g, " $1").toLowerCase().trim()}, filled on ${worst[1].count} of ${data.sample.totalTrades} trades — completing it lets the engine test that dimension for a pattern.`
    : topLeak
      ? topLeak.action
      : `All journal fields are complete across ${data.sample.totalTrades} trades. Keep logging to move past ${data.confidence.label.toLowerCase()}.`;

  const suppressed = data.dataQuality.suppressedSignals.length;
  const milestone = pct != null && pct >= 90
    ? `Hold ${pct}% adherence. ${suppressed > 0 ? `${suppressed} more signals unlock once each reaches five trades.` : "Evidence is stacking up across every dimension."}`
    : `Aim for 90% planned entries${pct != null ? ` from ${pct}%` : ""}. ${suppressed > 0 ? `${suppressed} signals are still below the five-trade threshold and cannot be reported yet.` : ""}`;

  return {
    accent: ACCENT,
    tiles: [
      { label: "PLAN ADHERENCE", value: pct == null ? "—" : `${pct}%`, sub: `last ${compared.recent} vs prior ${compared.previous} trades`, color: ACCENT },
      { label: "PROCESS CHANGE", value: adherence.changePct == null ? "—" : `${adherence.changePct >= 0 ? "+" : ""}${adherence.changePct}%`, sub: "planned-entry rate vs prior block", color: (adherence.changePct ?? 0) < 0 ? "#C43232" : "#008A5B" },
      { label: "P&L TREND", value: pnl.change == null ? "—" : inr(pnl.change), sub: "net vs the prior block", color: (pnl.change ?? 0) < 0 ? "#C43232" : "#008A5B" },
      { label: "JOURNAL COVERAGE", value: `${data.dataQuality.overallPercentage}%`, sub: `${Object.keys(data.dataQuality.coverage).length} fields tracked`, color: ACCENT },
    ],
    interpretation: [
      { label: "What This Means", text: meaning },
      { label: "Why It Matters", text: why },
      { label: "Next Improvement Focus", text: focus },
      { label: "Target Milestone", text: milestone },
    ],
  };
}

function SelfAwarenessPanel({ data }: { data: IndianIntelligenceSummary }) {
  // Every field, worst-covered first. Sorting the other way and slicing to six
  // did the opposite of what this panel is for: the fully-complete fields
  // crowded out the incomplete ones, so the only gap was always the row that
  // got cut - six 100% bars sitting under a 95.3% header.
  const coverage = Object.entries(data.dataQuality.coverage)
    .sort(([, a], [, b]) => a.percentage - b.percentage);
  const gaps = coverage.filter(([, value]) => value.percentage < 100);
  const { accent, tiles, interpretation } = buildAwarenessInterpretation(data);

  return (
    <>
      <section className="module-panel" style={{ borderTopColor: accent }}>
        <div className="panel-heading">
          <div>
            <span className="micro-label">REVIEW CALIBRATION</span>
            <h2>Is your process actually improving?</h2>
          </div>
          <span className="engine-badge"><CheckCircle2 size={14} /> Indian engine</span>
        </div>
        <div className="stat-row">
          {tiles.map((t) => <StatTile key={t.label} {...t} />)}
        </div>
        <InterpretationGrid items={interpretation} accent={accent} />
      </section>

      <section className="coverage-panel">
        <div className="panel-heading">
          <div>
            <span className="micro-label">DATA QUALITY</span>
            <h2>Journal completeness</h2>
          </div>
          <strong className="coverage-total" style={{ color: accent }}>{data.dataQuality.overallPercentage}%</strong>
        </div>
        <div className="coverage-columns">
          {coverage.map(([field, value]) => (
            <div className={`coverage-row ${value.percentage < 100 ? "gap" : ""}`} key={field}>
              <span>{field.replace(/([A-Z])/g, " $1")}</span>
              <div><i style={{ width: `${value.percentage}%` }} /></div>
              <strong>{value.percentage}%</strong>
            </div>
          ))}
        </div>
        <p className="awareness-note">
          {gaps.length === 0
            ? `All ${coverage.length} journal fields are complete across every tracked trade.`
            : `${gaps.length} of ${coverage.length} fields ${gaps.length === 1 ? "is" : "are"} incomplete: ${gaps
                .map(([field, value]) => `${field.replace(/([A-Z])/g, " $1").toLowerCase().trim()} (${value.count}/${data.sample.totalTrades})`)
                .join(", ")}. Each completed field is one more dimension the engine can test for a pattern.`}
        </p>
      </section>
    </>
  );
}

function IntelligenceWorkspace({ module }: { module: IndianIntelligenceModuleSlug }) {
  const [instrumentType, setInstrumentType] = useState<IndianInstrumentType>("ALL");
  const query = useIndianIntelligence(instrumentType);
  const config = MODULE_CONFIG[module];
  const Icon = config.icon;
  const data = query.data;
  const insights = data ? moduleInsights(module, data) : [];

  return (
    <div className="indian-intelligence-page">
      <IndianCandlestickBackground canvasId={`indian-intelligence-${module}-bg`} />
      <div className="page-layer">
        <PageHeader showMarketSwitcher />
        <TickerTape />
        <main className="workspace">
          <Link href="/indian-market/intelligence" className="back-link"><ArrowLeft size={15} /> Intelligence Hub</Link>
          <header className="module-header">
            <div className="module-title-row">
              <div className="module-icon" style={{ color: config.accent, background: `${config.accent}10`, borderColor: `${config.accent}28` }}><Icon size={24} strokeWidth={2} /></div>
              <div>
                <div className="eyebrow" style={{ color: config.accent }}>{config.eyebrow}</div>
                <h1>{config.title}</h1>
                <p>{config.description}</p>
              </div>
            </div>
            <div className="filters" role="group" aria-label="Indian instrument type">
              {FILTERS.map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  className={instrumentType === filter.value ? "active" : ""}
                  onClick={() => setInstrumentType(filter.value)}
                  aria-pressed={instrumentType === filter.value}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </header>

          {query.isPending ? (
            <div className="loading-grid" aria-label="Loading intelligence">
              <LoadingSkeleton width="100%" height="116px" variant="rect" />
              <LoadingSkeleton width="100%" height="250px" variant="rect" />
              <LoadingSkeleton width="100%" height="170px" variant="rect" />
            </div>
          ) : query.isError || !data ? (
            <div className="error-state" role="alert">
              <ShieldAlert size={28} />
              <h2>Indian intelligence could not be loaded</h2>
              <p>{query.error instanceof Error ? query.error.message : "Please try again."}</p>
              <button type="button" onClick={() => query.refetch()}>Try again</button>
            </div>
          ) : (
            <>
              <section className="evidence-strip" aria-label="Evidence status">
                <div><span>DATASET</span><strong>{data.sample.totalTrades} trades</strong></div>
                <div><span>CONFIDENCE</span><strong>{data.confidence.label}</strong></div>
                <div><span>JOURNAL COVERAGE</span><strong>{data.dataQuality.overallPercentage}%</strong></div>
                <div><span>TRACKED NET P&amp;L</span><strong className={data.sample.netPnl < 0 ? "negative" : "positive"}>{inr(data.sample.netPnl)}</strong></div>
              </section>

              {module === "ai-coach" ? (
                <IndianCoachFeedWidget data={data} />
              ) : module === "self-awareness" ? (
                <SelfAwarenessPanel data={data} />
              ) : (
                <section className="module-panel" style={{ borderTopColor: config.accent }}>
                  <div className="panel-heading">
                    <div>
                      <span className="micro-label">EVIDENCE FROM YOUR JOURNAL</span>
                      <h2>{module === "risk-patterns" || module === "psychology-cost" ? "What is costing you" : "What the data is showing"}</h2>
                    </div>
                    <span className="engine-badge"><CheckCircle2 size={14} /> Indian engine</span>
                  </div>
                  {insights.length ? (
                    <div className="insight-list">{insights.map((insight, index) => <InsightCard key={insight.id} insight={insight} accent={config.accent} index={index} />)}</div>
                  ) : <EmptyEvidence data={data} accent={config.accent} />}
                </section>
              )}

              {(module === "risk-patterns" || module === "psychology-cost") && data.guardrails.length > 0 && (
                <section className="guardrails">
                  <div className="panel-heading"><div><span className="micro-label">EXECUTION RULES</span><h2>Guardrails for the next trade</h2></div></div>
                  <div className="guardrail-grid">
                    {data.guardrails.map((guardrail, index) => (
                      <article key={guardrail.id}><span>{index + 1}</span><div><h3>{guardrail.title}</h3><p>{guardrail.action}</p></div></article>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </main>
      </div>
      <style jsx global>{`
        .indian-intelligence-page{min-height:100vh;background:#f5f3ef;color:#111c27;font-family:'Plus Jakarta Sans',sans-serif;position:relative}.page-layer{position:relative;z-index:2}.workspace{width:min(1160px,calc(100% - 40px));margin:0 auto;padding:24px 0 52px}.back-link{display:inline-flex;align-items:center;gap:6px;color:#64748b;text-decoration:none;font-size:12px;font-weight:700;margin-bottom:16px}.back-link:hover{color:#008a5b}.module-header{background:#fff;border:1px solid #dbe3ea;border-radius:16px;padding:22px 24px;display:flex;justify-content:space-between;gap:24px;align-items:center;box-shadow:0 4px 18px rgba(15,25,35,.045)}.module-title-row{display:flex;gap:15px;align-items:flex-start}.module-icon{width:48px;height:48px;flex:0 0 48px;border:1px solid;border-radius:12px;display:grid;place-items:center}.eyebrow,.micro-label{font-size:10px;line-height:1.4;font-weight:900;letter-spacing:.09em;text-transform:uppercase}.module-header h1{font-size:25px;line-height:1.2;margin:3px 0 5px;letter-spacing:-.025em}.module-header p{font-size:12px;line-height:1.6;color:#64748b;margin:0;max-width:650px}.filters{display:flex;border:1px solid #dbe3ea;border-radius:10px;padding:3px;background:#f8fafc;flex:0 0 auto}.filters button{border:0;background:transparent;color:#64748b;border-radius:7px;padding:8px 12px;font-family:inherit;font-size:11px;font-weight:800;cursor:pointer}.filters button.active{background:#0b9365;color:#fff;box-shadow:0 1px 4px rgba(11,147,101,.25)}.evidence-strip{display:grid;grid-template-columns:repeat(4,1fr);margin:14px 0;background:#101c28;border-radius:14px;padding:16px 20px;color:#fff}.evidence-strip>div{padding:0 18px;border-right:1px solid rgba(255,255,255,.12)}.evidence-strip>div:first-child{padding-left:0}.evidence-strip>div:last-child{border:0}.evidence-strip span{display:block;color:#8fa2b5;font-size:9px;font-weight:800;letter-spacing:.08em;margin-bottom:5px}.evidence-strip strong{font-size:14px}.positive{color:#34d399}.negative{color:#fb7185}.module-panel,.guardrails,.focus-card,.coverage-card{background:#fff;border:1px solid #dbe3ea;border-radius:16px;box-shadow:0 4px 18px rgba(15,25,35,.04)}.module-panel{border-top:3px solid;padding:22px 24px}.panel-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:15px;margin-bottom:16px}.panel-heading h2{font-size:17px;margin:4px 0 0}.micro-label{color:#94a3b8}.engine-badge{display:inline-flex;align-items:center;gap:5px;background:#ecfdf5;color:#087a55;border:1px solid #c9f1df;border-radius:999px;padding:6px 9px;font-size:10px;font-weight:800}.insight-list{display:grid;gap:10px}.insight-card{display:grid;grid-template-columns:auto 1fr auto;gap:14px;border:1px solid #e2e8f0;border-radius:12px;padding:15px;align-items:start}.insight-rank{width:34px;height:34px;border-radius:9px;display:grid;place-items:center;font-size:11px;font-weight:900}.insight-tags{display:flex;gap:6px;margin-bottom:5px}.insight-tags span{background:#f1f5f9;color:#64748b;border-radius:999px;padding:3px 7px;font-size:9px;font-weight:800;text-transform:uppercase}.insight-copy h3{font-size:14px;margin:0 0 5px}.insight-copy p,.focus-card p,.guardrail-grid p{font-size:11.5px;line-height:1.55;color:#64748b;margin:0}.insight-action{display:flex;align-items:flex-start;gap:6px;color:#263848;font-size:11px;font-weight:750;margin-top:9px}.insight-stats{text-align:right;min-width:105px;display:grid;gap:3px}.insight-stats strong{font-size:15px}.insight-stats span{font-size:9px;color:#94a3b8}.empty-state{text-align:center;padding:40px 20px}.empty-icon{width:52px;height:52px;border-radius:14px;display:grid;place-items:center;margin:0 auto 12px}.empty-state h3{font-size:15px;margin:0 0 6px}.empty-state p{font-size:12px;color:#7a8ba0;max-width:520px;margin:0 auto 16px;line-height:1.55}.primary-link,.error-state button{display:inline-block;border:0;border-radius:9px;background:#0b9365;color:#fff;text-decoration:none;padding:9px 13px;font-size:11px;font-weight:800;cursor:pointer}.guardrails{padding:20px 24px;margin-top:14px}.coach-widget-host{margin-bottom:14px}.coach-widget-host>div{margin-bottom:0!important}.guardrail-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.guardrail-grid article{display:flex;gap:10px;background:#fff8f8;border:1px solid #fee2e2;border-radius:11px;padding:13px}.guardrail-grid article>span{width:25px;height:25px;display:grid;place-items:center;flex:0 0 25px;background:#d13b3b;color:#fff;border-radius:7px;font-size:10px;font-weight:900}.guardrail-grid h3{font-size:12px;margin:1px 0 5px}.awareness-layout{display:grid;grid-template-columns:.85fr 1.15fr;gap:14px}.stat-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:4px}.stat-tile{border:1px solid #e2e8f0;border-radius:11px;padding:12px 14px;display:grid;gap:3px}.stat-label{font-size:9px;font-weight:900;letter-spacing:.09em;color:#94a3b8}.stat-tile strong{font-size:19px;font-family:'JetBrains Mono',monospace}.stat-sub{font-size:10px;color:#94a3b8;line-height:1.45}.interpretation-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;margin-top:14px}.interpretation-grid>div{border:1px solid;border-radius:10px;padding:12px 14px}.interpretation-label{font-size:9px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;margin-bottom:6px}.interpretation-grid p{font-size:11.5px;line-height:1.65;color:#334155;margin:0}.coverage-panel{background:#fff;border:1px solid #dbe3ea;border-radius:16px;box-shadow:0 4px 18px rgba(15,25,35,.04);padding:20px 24px;margin-top:14px}.coverage-total{font-size:19px;font-family:'JetBrains Mono',monospace}.coverage-columns{display:grid;grid-template-columns:1fr 1fr;gap:2px 28px}.focus-card,.coverage-card{padding:22px}.focus-card h3{font-size:19px;margin:7px 0}.trend-row{display:flex;align-items:center;gap:7px;color:#087a55;margin-top:14px;font-size:12px}.coverage-heading{display:flex;justify-content:space-between;align-items:center;margin-bottom:13px}.coverage-heading h3{font-size:14px;margin:0}.coverage-heading strong{color:#2563eb}.coverage-row{display:grid;grid-template-columns:110px 1fr 38px;gap:8px;align-items:center;margin:8px 0;font-size:10px;color:#64748b;text-transform:capitalize}.coverage-row>div{height:5px;background:#e9eef3;border-radius:999px;overflow:hidden}.coverage-row i{height:100%;display:block;background:#2563eb;border-radius:999px}.coverage-row strong{text-align:right;color:#34485a}.coverage-row.gap i{background:#d97706}.coverage-row.gap strong{color:#b45309}.awareness-note{margin:14px 0 0;padding-top:12px;border-top:1px solid #eef2f6;font-size:10.5px;line-height:1.6;color:#7a8ba0;text-transform:none}.trend-row.down{color:#c43232}.loading-grid{display:grid;gap:14px;margin-top:14px}.error-state{text-align:center;background:#fff;border:1px solid #fecaca;border-radius:16px;padding:42px 20px;margin-top:14px;color:#b42318}.error-state h2{font-size:17px;margin:10px 0 5px}.error-state p{font-size:12px;color:#64748b}.error-state button{margin-top:8px}.skeleton{border-radius:14px!important}
        @media(max-width:760px){.workspace{width:min(100% - 24px,1160px);padding-top:16px}.module-header{align-items:stretch;flex-direction:column;padding:18px}.filters{width:100%;box-sizing:border-box}.filters button{flex:1}.evidence-strip{grid-template-columns:1fr 1fr;gap:14px}.evidence-strip>div,.evidence-strip>div:first-child{border:0;padding:0}.module-panel,.guardrails{padding:18px}.insight-card,.insight-stats{grid-column:2;text-align:left;display:flex;gap:10px;align-items:center}.guardrail-grid,.awareness-layout,.coverage-columns{grid-template-columns:1fr}.module-title-row{gap:11px}.module-header h1{font-size:21px}}
      `}</style>
    </div>
  );
}

export default function IndianIntelligenceModule({ module }: { module: IndianIntelligenceModuleSlug }) {
  return (
    <ErrorBoundary fallback={<div style={{ padding: "2rem", textAlign: "center" }}>Indian Intelligence failed to load. Please refresh.</div>}>
      <Suspense fallback={<div style={{ padding: "2rem", textAlign: "center" }}>Loading Indian Intelligence…</div>}>
        <IntelligenceWorkspace module={module} />
      </Suspense>
    </ErrorBoundary>
  );
}
