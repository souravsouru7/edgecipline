"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import ErrorBoundary from "@/components/ErrorBoundary";
import CandlestickBackground from "@/features/shared/components/CandlestickBackground";
import PageHeader from "@/features/shared/components/PageHeader";
import TickerTape from "@/features/shared/components/TickerTape";
import { Skeleton } from "@/features/shared";
import { useAnalytics } from "@/features/analytics/hooks/useAnalytics";
import { MARKETS, useMarket } from "@/context/MarketContext";

const C = {
  bull: "#0D9E6E",
  bear: "#D63B3B",
  gold: "#B8860B",
  purple: "#8B5CF6",
  blue: "#2563EB",
  primary: "#0F1923",
  muted: "#94A3B8",
  border: "#E2E8F0",
};

function moneyText(value, currencySymbol = "$") {
  const v = parseFloat(value || 0);
  return `${v >= 0 ? "+" : "-"}${currencySymbol}${Math.abs(v).toFixed(2)}`;
}

function ModuleLink({ href, title, eyebrow, summary, action, accent }) {
  return (
    <Link
      href={href}
      style={{
        display: "block",
        textDecoration: "none",
        background: "#FFFFFF",
        border: `1px solid ${C.border}`,
        borderLeft: `4px solid ${accent}`,
        borderRadius: 12,
        padding: "14px 16px",
        boxShadow: "0 2px 10px rgba(15,25,35,0.04)",
      }}
    >
      <div style={{ fontSize: 9, fontWeight: 900, color: accent, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>{eyebrow}</div>
      <div style={{ fontSize: 14, fontWeight: 900, color: C.primary, marginBottom: 5 }}>{title}</div>
      <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.6, marginBottom: 10 }}>{summary}</div>
      <div style={{ fontSize: 11, fontWeight: 800, color: accent }}>{action}</div>
    </Link>
  );
}

function IntelligenceGroup({ title, subtitle, children }) {
  return (
    <section style={{ marginBottom: 18 }}>
      <div style={{ marginBottom: 10 }}>
        <h2 style={{ fontSize: 16, fontWeight: 900, color: C.primary, margin: 0 }}>{title}</h2>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>{subtitle}</div>
      </div>
      <div className="intel-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
        {children}
      </div>
    </section>
  );
}

function UnlockPreview({ title, needed, unlocks, accent }) {
  return (
    <div style={{ background: `${accent}08`, border: `1px dashed ${accent}55`, borderRadius: 12, padding: "14px 16px" }}>
      <div style={{ fontSize: 12, fontWeight: 900, color: C.primary, marginBottom: 5 }}>{title}</div>
      <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.6 }}>{needed}</div>
      <div style={{ fontSize: 11, color: accent, fontWeight: 800, marginTop: 8 }}>{unlocks}</div>
    </div>
  );
}

function IntelligenceContent() {
  const { loading, data } = useAnalytics();
  const { currentMarket } = useMarket();
  const pathname = usePathname();
  const isIndianMarket = pathname?.startsWith("/indian-market") || currentMarket === MARKETS.INDIAN_MARKET;
  const currencySymbol = isIndianMarket ? "\u20B9" : "$";
  // Every other link on this page routes off `isIndianMarket`, which trusts the
  // pathname first. The `?market=` links must use the same answer: MarketContext
  // syncs `currentMarket` from the pathname in an effect, so on a fresh load of
  // /indian-market/intelligence it is still "Forex" for the first render \u2014 and a
  // click in that window sent the user to the Forex weekly report.
  const linkedMarket = isIndianMarket ? MARKETS.INDIAN_MARKET : currentMarket;
  const indianIntelligenceTargets = {
    "/analytics/trading-dna": "/indian-market/intelligence/trading-dna",
    "/analytics/patterns": "/indian-market/intelligence/patterns",
    "/analytics/psychology-cost": "/indian-market/intelligence/psychology-cost",
    "/analytics/self-awareness": "/indian-market/intelligence/self-awareness",
    "/analytics/ai-coach": "/indian-market/intelligence/ai-coach",
  };
  const analyticsPath = (forexPath, indianTarget = indianIntelligenceTargets[forexPath]) =>
    isIndianMarket ? (indianTarget || "/indian-market/intelligence") : forexPath;
  const summary = data?.summary;
  const tradingDNA = data?.tradingDNA;
  const psychologyCost = data?.psychologyCost;
  const patterns = data?.patterns;
  const selfAwareness = data?.selfAwareness;
  const psychology = data?.psychology;
  const coachFeed = data?.coachFeed;
  const totalTrades = summary?.totalTrades || 0;
  const bestPattern = patterns?.summary?.topPositivePattern;
  const riskPattern = patterns?.summary?.topNegativePattern;
  // psychologyCost has never returned `costliestMistake` / `costliestEmotion`;
  // the real fields live under behavioralDNA.
  const topLeak =
    psychologyCost?.topLeaks?.[0] ||
    psychologyCost?.behavioralDNA?.mostExpensiveMistake ||
    psychologyCost?.behavioralDNA?.mostExpensiveEmotion;
  const identity = tradingDNA?.dnaSummary?.tradingIdentity;
  const latestCoach = coachFeed?.insights?.[0];

  return (
    <div style={{ minHeight: "100vh", background: "#F4F2EE", fontFamily: "'Plus Jakarta Sans',sans-serif", color: C.primary, position: "relative" }}>
      <CandlestickBackground canvasId="intelligence-bg-canvas" />
      <div style={{ position: "relative", zIndex: 10 }}>
        <PageHeader showMarketSwitcher />
        <TickerTape />
        <main style={{ maxWidth: 1180, width: "100%", margin: "0 auto", padding: "28px 24px 44px", boxSizing: "border-box" }}>
          <div style={{ marginBottom: 24 }}>
            <h1 style={{ fontSize: 24, fontWeight: 900, margin: 0, letterSpacing: "-0.02em" }}>Intelligence Hub</h1>
            <p style={{ fontSize: 12, color: C.muted, margin: "6px 0 0", maxWidth: 680, lineHeight: 1.6 }}>
              A guide to the Edgecipline psychology operating system: what makes money, what costs money, what to improve, and how you are evolving.
            </p>
          </div>

          {loading && !summary ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
              {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} width="100%" height="150px" variant="rect" />)}
            </div>
          ) : (
            <>
              <div style={{ background: "#FFFFFF", border: `1px solid ${C.border}`, borderRadius: 14, padding: "16px 18px", marginBottom: 22 }}>
                <div style={{ fontSize: 11, fontWeight: 900, color: C.purple, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Data to action loop</div>
                <div className="intel-loop" style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
                  {["Data", "Analytics", "Insight", "Action", "Improvement"].map((step, i) => (
                    <div key={step} style={{ borderRadius: 10, background: i >= 2 ? "#F5F3FF" : "#F8FAFC", border: `1px solid ${i >= 2 ? "#8B5CF633" : C.border}`, padding: "10px 12px", textAlign: "center" }}>
                      <div style={{ fontSize: 11, fontWeight: 900, color: i >= 2 ? C.purple : C.primary }}>{step}</div>
                    </div>
                  ))}
                </div>
              </div>

              <IntelligenceGroup title="What Makes Me Money?" subtitle="Find repeatable strengths and conditions worth prioritizing.">
                {tradingDNA && !tradingDNA.insufficient ? (
                  <ModuleLink
                    href={analyticsPath("/analytics/trading-dna")}
                    eyebrow="Trading DNA Engine"
                    title="Your Trading Identity"
                    summary={identity || "Your behavioral fingerprint is forming from sessions, instruments, emotions, and setup quality."}
                    action="Open Trading DNA ->"
                    accent={C.purple}
                  />
                ) : (
                  <UnlockPreview title="Trading DNA locked" needed={`You have ${totalTrades} logged trades. Add more trades with setup, session, emotion, and review data.`} unlocks="Unlocks your repeatable edge fingerprint." accent={C.purple} />
                )}
                <ModuleLink
                  href={analyticsPath("/analytics/patterns")}
                  eyebrow="Best Patterns"
                  title={bestPattern ? "Best Repeatable Pattern" : "Pattern Detection Engine"}
                  summary={bestPattern ? `${bestPattern.description} is showing ${bestPattern.winRate}% win rate across ${bestPattern.count} trades.` : "Find repeated conditions that produce better win rate, cleaner entries, and stronger P&L."}
                  action="Open Pattern Detection ->"
                  accent={C.gold}
                />
              </IntelligenceGroup>

              <IntelligenceGroup title="What Costs Me Money?" subtitle="Find leaks, risk patterns, and emotional triggers that reduce performance.">
                <ModuleLink
                  href={analyticsPath("/analytics/psychology-cost")}
                  eyebrow="Psychology Cost Calculator"
                  title={topLeak ? `Biggest Leak: ${topLeak.name || topLeak.type}` : "Behavioral P&L Cost"}
                  summary={topLeak ? `This behavior is associated with ${moneyText(topLeak.cost ?? topLeak.netPnL ?? topLeak.profit, currencySymbol)} in the tracked sample.` : "Quantifies how emotions, confidence, and review gaps affect your P&L."}
                  action="Open Psychology Cost ->"
                  accent={C.bear}
                />
                <ModuleLink
                  href={analyticsPath("/analytics/patterns", "/indian-market/intelligence/risk-patterns")}
                  eyebrow="Risk Patterns"
                  title={riskPattern ? "Highest Risk Pattern" : "Risk Pattern Detection"}
                  summary={riskPattern ? `${riskPattern.description} is showing ${riskPattern.winRate}% win rate. Add a guardrail before this trigger repeats.` : "Detects repeated loss clusters, tilt conditions, and dangerous combinations."}
                  action="Open Risk Patterns ->"
                  accent={C.bear}
                />
              </IntelligenceGroup>

              <IntelligenceGroup title="What Should I Improve?" subtitle="Turn scores into the next concrete behavior to practice.">
                <ModuleLink
                  href={analyticsPath("/analytics/self-awareness")}
                  eyebrow="Self Awareness Engine"
                  title="Review Calibration"
                  summary={selfAwareness && !selfAwareness.insufficient ? `${selfAwareness.matchCount || 0}/${selfAwareness.trackedCount || selfAwareness.totalTrackedTrades || 0} post-trade reviews matched actual quality.` : "Shows whether you judge your trades accurately or change rules after noisy outcomes."}
                  action="Open Self Awareness ->"
                  accent={C.purple}
                />
                <ModuleLink
                  href={isIndianMarket ? "/indian-market/discipline" : "/discipline"}
                  eyebrow="Discipline Analytics"
                  title="Rule Follow-Through"
                  summary={psychology?.scoreBreakdown?.planAdherencePct ? `Current plan adherence is ${parseFloat(psychology.scoreBreakdown.planAdherencePct).toFixed(0)}%. Improve this before adding more strategy complexity.` : "Shows which setup rules you follow, break, and how much violations cost."}
                  action="Open Discipline Analytics ->"
                  accent={C.blue}
                />
              </IntelligenceGroup>

              <IntelligenceGroup title="How Am I Evolving?" subtitle="Review progress across time and coaching cycles.">
                <ModuleLink
                  href={`/psychology-timeline?market=${encodeURIComponent(linkedMarket)}`}
                  eyebrow="Psychology Timeline"
                  title="Mindset Evolution"
                  summary="Tracks psychology score, self-awareness, discipline, mood, milestones, and P&L together over time."
                  action="Open Timeline ->"
                  accent={C.purple}
                />
                <ModuleLink
                  href={`/weekly-reports?market=${encodeURIComponent(linkedMarket)}`}
                  eyebrow="Weekly Reports"
                  title="Review Cycle"
                  summary="Turns the week into a coaching summary with mistakes, improvements, and next-week checklist actions."
                  action="Open Weekly Reports ->"
                  accent={C.bull}
                />
              </IntelligenceGroup>

              <IntelligenceGroup title="What Should I Do Now?" subtitle="The latest coaching cue from your actual trading data.">
                <ModuleLink
                  href={analyticsPath("/analytics/ai-coach")}
                  eyebrow="AI Coach Feed"
                  title={latestCoach?.title || "Personalized Coach Feed"}
                  summary={latestCoach?.action || latestCoach?.insight || "Your coach feed will prioritize specific observations, evidence, actions, and expected outcomes once enough data is available."}
                  action="Open AI Coach Feed ->"
                  accent={C.bull}
                />
                <ModuleLink
                  href="/checklist"
                  eyebrow="Pre-Trade Checklist"
                  title="Convert Insight Into Execution"
                  summary="Run setup rules before taking the next trade so intelligence becomes a real behavior, not just a chart."
                  action="Run Checklist ->"
                  accent={C.gold}
                />
              </IntelligenceGroup>
            </>
          )}
        </main>
      </div>
      <style jsx global>{`
        @media (max-width: 720px) {
          main { padding: 18px 14px 36px !important; }
          .intel-loop { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

export default function IntelligencePage() {
  return (
    <ErrorBoundary fallback={<div style={{ padding: "2rem", textAlign: "center" }}>Intelligence Hub failed to load. Please refresh.</div>}>
      <Suspense>
        <IntelligenceContent />
      </Suspense>
    </ErrorBoundary>
  );
}
