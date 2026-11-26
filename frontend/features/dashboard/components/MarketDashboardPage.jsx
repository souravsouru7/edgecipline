"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";
import {
  ArrowRight, BookOpen, Brain, Check, CheckSquare, FileText, Flame, MessageCircle, Moon, Plus, Sparkles, Target,
} from "lucide-react";
import ErrorBoundary from "@/components/ErrorBoundary";
import PageHeader from "@/features/shared/components/PageHeader";
import MarketContentTransition from "@/features/shared/components/MarketContentTransition";
import FirstLoginWelcome from "@/features/dashboard/components/FirstLoginWelcome";
import GuidedHome from "@/features/dashboard/components/GuidedHome";
import EquityChart from "@/features/dashboard/components/EquityChart";
import ReflectionSheet from "@/features/reflections/components/ReflectionSheet";
import MindScoreCard from "@/features/mind-progress/components/MindScoreCard";
import AICoachFeedWidget from "@/features/ai-coach/components/AICoachFeedWidget";
import { useCoachFeed } from "@/features/dashboard/hooks/useCoachFeed";
import { useDashboard } from "@/features/dashboard/hooks/useDashboard";
import { buildTodaysIntelligence } from "@/features/dashboard/utils/todaysIntelligence";
import { getNextAction } from "@/features/dashboard/utils/nextAction";
import { buildTodayLoop } from "@/features/dashboard/utils/todayLoop";
import { marketRoutes } from "@/features/shared/navigation";
import { useLogTrade } from "@/features/trade/components/LogTradeChooser";
import {
  Badge, Button, Card, CardHeader, ErrorState, Money, Placeholder, StatCard,
} from "@/features/shared/components/ui";
import { MARKETS } from "@/context/MarketContext";
import { useSystemBars } from "@/features/shared/hooks/useSystemBars";
import { useTheme } from "@/utils/theme";

// Home = command center. It answers, in order:
//   1. What do I do now?        → Do-next banner + Today loop
//   2. How am I doing?          → P&L, equity curve, KPIs
//   3. What should I improve?   → Insights + AI coach
// Users with no trades get GuidedHome instead.

function greetingFor(hour) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

const firstName = (full) => (full ? String(full).trim().split(/\s+/)[0] : "");

function formatShort(v) {
  const n = Math.abs(Number(v));
  if (!Number.isFinite(n)) return "—";
  // Whole numbers from 10 up keep "avg win / avg loss" on one line.
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(n >= 10 ? 0 : 2);
}

// ── 1. What do I do now ─────────────────────────────────────────────────────

function DoNext({ next, loading, onLogTrade, onReflect }) {
  if (loading) return <Placeholder height={76} radius={20} />;
  const { action } = next;
  const button =
    action.kind === "link" ? (
      <Button as={Link} href={action.href} icon={<ArrowRight size={17} />}>{next.cta}</Button>
    ) : (
      <Button onClick={action.kind === "reflect" ? onReflect : onLogTrade} icon={<ArrowRight size={17} />}>
        {next.cta}
      </Button>
    );
  return (
    <section className={`ec-next ec-next--${next.tone}`} aria-label="Do next">
      <span className="ec-next__tag">Do next</span>
      <div className="ec-next__text">
        <h2>{next.title}</h2>
        <p>{next.body}</p>
      </div>
      {button}
    </section>
  );
}

const LOOP_ICONS = {
  check: CheckSquare, plus: Plus, moon: Moon, report: FileText, coach: MessageCircle,
  target: Target, sparkles: Sparkles, brain: Brain, journal: BookOpen,
};

// Rows come from buildTodayLoop (features/dashboard/utils/todayLoop.js): each
// one is a feature chosen from the trader's own numbers, with that number as
// the reason.
function TodayLoop({ loop, loading, onLogTrade, onReflect }) {
  const title = loop?.mode === "review" ? "This week's review" : "Today's plan";
  const total = loop?.steps?.length || 3;
  return (
    <Card className="ec-today">
      <CardHeader
        title={title}
        subtitle={loading ? " " : loop?.basis}
        action={!loading && loop?.mode !== "review" && loop?.doneCount > 0
          ? <Badge tone={loop.doneCount === total ? "accent" : undefined}>
              {loop.doneCount === total ? "Day closed" : `${loop.doneCount} of ${total} done`}
            </Badge>
          : null}
      />
      {loading || !loop ? (
        <div style={{ display: "grid", gap: 8 }}><Placeholder height={52} /><Placeholder height={52} /><Placeholder height={52} /></div>
      ) : (
        <ol className="ec-today__list">
          {loop.steps.map((s, i) => {
            const Icon = LOOP_ICONS[s.icon] || CheckSquare;
            const content = (
              <>
                <span className={`ec-today__num${s.done ? " is-done" : ""}`} aria-hidden="true">
                  {s.done ? <Check size={14} strokeWidth={3} /> : i + 1}
                </span>
                <span className="ec-today__text">
                  <span className="ec-today__title">{s.title}{s.done && <span className="ec-sr"> (done)</span>}</span>
                  <span className="ec-today__sub">
                    {s.emph && (
                      <strong className={s.tone ? `ec-today__emph ec-today__emph--${s.tone}` : "ec-today__emph"}>{s.emph}</strong>
                    )}
                    {s.emph && s.sub.trim() ? " · " : ""}
                    {s.sub}
                  </span>
                </span>
                <Icon size={17} className="ec-today__icon" aria-hidden="true" />
              </>
            );
            const { action } = s;
            return (
              <li key={s.key}>
                {action.kind === "link" ? (
                  <Link href={action.href} className="ec-today__row ec-focusable">{content}</Link>
                ) : (
                  <button
                    type="button"
                    onClick={action.kind === "reflect" ? onReflect : onLogTrade}
                    className="ec-today__row ec-focusable"
                  >
                    {content}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

function reportLoopError(error) {
  try {
    Sentry.captureException(error, { tags: { feature: "today_loop" } });
  } catch { /* never let reporting break Home */ }
}

// ── 2. How am I doing ───────────────────────────────────────────────────────

function Performance({ stats, timeline, currency, loading }) {
  const pnlReady = Number(stats?.pnlReadyTrades ?? stats?.totalTrades ?? 0) > 0;
  const netPnl = Number(stats?.netPnL ?? stats?.totalProfit ?? 0);
  return (
    <Card className="ec-perf">
      <div className="ec-perf__head">
        <div>
          <span className="ec-stat__label">Net P&amp;L</span>
          {loading ? (
            <Placeholder width={180} height={40} style={{ marginTop: 6 }} />
          ) : pnlReady ? (
            <Money value={netPnl} currency={currency} signed animate className="ec-perf__value" />
          ) : (
            <span className="ec-perf__value ec-num" style={{ color: "var(--ec-text-3)" }}>—</span>
          )}
          <span className="ec-stat__hint" style={{ display: "block" }}>
            {loading
              ? " "
              : !Number(stats?.totalTrades)
                ? "No trades in this market yet"
                : `${stats.totalTrades} trades${pnlReady ? ` · ${stats?.winRate ?? 0}% win rate` : " · add P&L to see results"}`}
          </span>
        </div>
        <Badge>Equity curve</Badge>
      </div>
      <div className="ec-perf__chart">
        {loading ? <Placeholder height="100%" radius={12} /> : <EquityChart buckets={timeline?.buckets} currency={currency} height="100%" />}
      </div>
    </Card>
  );
}

function Kpis({ stats, streaks, currency, loading }) {
  const show = Number(stats?.pnlReadyTrades ?? stats?.totalTrades ?? 0) > 0;
  const streak = streaks?.journal?.current ?? 0;
  return (
    <div className="ec-kpis ec-stagger">
      <StatCard label="Win rate" loading={loading} animate value={show ? stats?.winRate : "—"} kind={show ? "percent" : undefined}
        hint={show ? `${stats?.winningTrades ?? 0} wins · ${stats?.losingTrades ?? 0} losses` : "Needs closed trades"} />
      <StatCard label="Avg trade" loading={loading} animate value={show ? stats?.avgTrade : "—"} kind={show ? "money" : undefined}
        currency={currency} signed hint="What a typical trade makes" />
      <StatCard label="Avg win / loss" loading={loading}
        value={show ? `${formatShort(stats?.avgWin)} / ${formatShort(stats?.avgLoss)}` : "—"} hint="Wins should be bigger" />
      <StatCard label="Discipline streak" loading={loading} animate value={streak}
        hint={streak === 1 ? "day in a row" : "days in a row"} />
    </div>
  );
}

// ── 3. What should I improve ────────────────────────────────────────────────

function Insights({ intel, routes, loading }) {
  const rows = [
    { label: "Strength", value: intel.strength, tone: "profit" },
    { label: "Biggest leak", value: intel.leak, tone: "loss" },
    { label: "Next focus", value: intel.focus, tone: "warning" },
    { label: "Recommendation", value: intel.recommendation, tone: "neutral" },
  ];
  return (
    <Card>
      <CardHeader title="What to improve" subtitle={intel.sampleLabel}
        action={<Link href={routes.insights} className="ec-dash__link">All insights</Link>} />
      <dl className="ec-insights">
        {rows.map((r) => (
          <div key={r.label} className="ec-insights__item">
            <dt><span className={`ec-dot ec-dot--${r.tone}`} />{r.label}</dt>
            <dd>{loading ? <Placeholder height={14} width="80%" /> : r.value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function Coach({ insight, routes, loading }) {
  return (
    <Card className="ec-coach">
      <CardHeader title="AI coach" subtitle="Based on your trades"
        action={<span className="ec-coach__mark" aria-hidden="true"><Sparkles size={16} /></span>} />
      {loading ? (
        <div style={{ display: "grid", gap: 8 }}><Placeholder height={14} /><Placeholder height={14} width="75%" /></div>
      ) : (
        <blockquote className="ec-coach__quote">{insight}</blockquote>
      )}
      <Button as={Link} href={routes.coach} variant="secondary" size="sm" icon={<ArrowRight size={15} />}>
        Ask a follow-up
      </Button>
    </Card>
  );
}

// Full AI Coach Feed, right on Home (it used to sit behind Intelligence → AI
// Coach Feed, where traders couldn't find it). Waits for the snapshot so it
// never competes with Home's first paint; any failure hides the section.
function CoachFeedSection({ market, enabled }) {
  const isIndian = market === MARKETS.INDIAN_MARKET;
  const { data, isLoading, error } = useCoachFeed(market, { enabled });

  // /dashboard#coach-feed (old AI Coach links and notifications land here).
  useEffect(() => {
    if (isLoading || typeof window === "undefined" || window.location.hash !== "#coach-feed") return;
    const el = document.getElementById("coach-feed");
    if (el) requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [isLoading]);

  if (!enabled || error) return null;
  return (
    <section id="coach-feed" aria-label="AI coach feed" style={{ scrollMarginTop: 80 }}>
      {isLoading ? (
        <Placeholder height={160} radius={20} />
      ) : (
        <AICoachFeedWidget feed={data} loading={false} currency={isIndian ? "₹" : "$"} market={isIndian ? "Indian_Market" : "Forex"} />
      )}
    </section>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

function DashboardContent() {
  const {
    stats, mounted, loading, fetching, loadFailed, retry, statsUnavailable,
    showFirstLogin, closeFirstLogin, onboarding,
    selfAwareness, psychologyCost, tradingDNA, timeline, profile,
    streaks, reflection, currentMarket, marketDay,
  } = useDashboard();
  const { theme } = useTheme();
  useSystemBars(theme);
  const { open: openLogTrade } = useLogTrade();
  const [reflectOpen, setReflectOpen] = useState(false);

  const isIndian = currentMarket === MARKETS.INDIAN_MARKET;
  const routes = marketRoutes(currentMarket);
  const currency = isIndian ? "INR" : "USD";
  const totalTrades = Number(stats?.totalTrades || 0);
  const busy = !mounted || loading;
  const now = new Date();
  const name = firstName(profile?.name);

  const intel = buildTodaysIntelligence({
    tradingDNA, psychologyCost, selfAwareness, totalTrades, currencySymbol: isIndian ? "₹" : "$",
  });
  // `onboarding.tradeAdded` / `tradeCount` are account-wide (both markets);
  // `totalTrades` is this market only. The guided first run is for people
  // with no trades anywhere. Someone who trades the other market gets the
  // normal dashboard, pointed at this market's first trade.
  // A failed analytics step zeroes the summary. Never treat that as "no
  // trades": no guided page, no "first trade in this market" banner.
  const settled = !busy && !loadFailed && !statsUnavailable;
  const hasAnyTrade = Boolean(onboarding?.tradeAdded) || Number(onboarding?.tradeCount || 0) > 0;
  const firstRun = settled && totalTrades === 0 && !hasAnyTrade;
  const marketLabel = isIndian ? "Indian Market" : "Forex";
  const emptyMarket = settled && totalTrades === 0 && hasAnyTrade;
  const next = getNextAction({
    streaks, reflection, now, checklistHref: routes.checklist,
    emptyMarketLabel: emptyMarket ? marketLabel : null,
  });
  // Built only from a settled snapshot; while loading the card shows skeletons.
  const loop = busy ? null : buildTodayLoop({
    market: currentMarket, routes, now, stats, psychologyCost, timeline, selfAwareness, tradingDNA,
    streaks, reflection, onboarding, marketDay,
    unreliable: loadFailed || statsUnavailable,
    onError: reportLoopError,
  });
  const openReflect = () => setReflectOpen(true);
  const streak = streaks?.journal?.current ?? 0;

  return (
    <div className="ec-app ec-home">
      <PageHeader themed showMarketSwitcher title="Home" />

      <MarketContentTransition style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <main className="ec-page">
          {firstRun ? (
            <GuidedHome name={name} onboarding={onboarding} routes={routes} />
          ) : (
            <>
              <header className="ec-home__greet">
                <div>
                  <p className="ec-dash__eyebrow">
                    {now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                  </p>
                  <h1>{greetingFor(now.getHours())}{name ? `, ${name}` : ""}</h1>
                </div>
                {streak > 0 && (
                  <Link href="/streaks" className="ec-home__streak">
                    <Badge tone={streaks?.journal?.atRisk ? "warning" : "accent"} icon={<Flame size={13} />}>
                      {streak}-day streak
                    </Badge>
                  </Link>
                )}
              </header>

              {loadFailed ? (
                <Card>
                  <ErrorState
                    title={`Couldn't load ${marketLabel} data`}
                    body="Check your connection and try again. Your other market is unaffected."
                    onRetry={fetching ? undefined : retry}
                  />
                </Card>
              ) : (
                <div className="ec-home__grid ec-stagger">
                  <div className="ec-area-next">
                    <DoNext next={next} loading={busy} onLogTrade={openLogTrade} onReflect={openReflect} />
                  </div>
                  <div className="ec-area-mind"><MindScoreCard onLogTrade={openLogTrade} /></div>
                  {statsUnavailable ? (
                    <div className="ec-area-perf">
                      <Card>
                        <ErrorState
                          title="Couldn't load your stats right now"
                          body="Your trades are safe. P&L, the equity curve and KPIs will be back in a moment."
                          onRetry={fetching ? undefined : retry}
                        />
                      </Card>
                    </div>
                  ) : (
                    <div className="ec-area-perf"><Performance stats={stats} timeline={timeline} currency={currency} loading={busy} /></div>
                  )}
                  <div className="ec-area-today">
                    <TodayLoop loop={loop} loading={busy} onLogTrade={openLogTrade} onReflect={openReflect} />
                  </div>
                  {!statsUnavailable && (
                    <div className="ec-area-kpis"><Kpis stats={stats} streaks={streaks} currency={currency} loading={busy} /></div>
                  )}
                  <div className="ec-area-insights"><Insights intel={intel} routes={routes} loading={busy} /></div>
                  <div className="ec-area-coach"><Coach insight={intel.coachInsight} routes={routes} loading={busy} /></div>
                  <div className="ec-area-coachfeed"><CoachFeedSection market={currentMarket} enabled={settled} /></div>
                </div>
              )}
            </>
          )}
        </main>
      </MarketContentTransition>

      <ReflectionSheet open={reflectOpen} onClose={() => setReflectOpen(false)} />
      {showFirstLogin && <FirstLoginWelcome onClose={closeFirstLogin} />}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <ErrorBoundary
      fallback={
        <div className="ec-app" style={{ display: "grid", placeItems: "center" }}>
          <ErrorState
            title="The dashboard didn't load"
            body="Something went wrong on our side. Reload to try again."
            action={<Button onClick={() => window.location.reload()}>Reload</Button>}
          />
        </div>
      }
    >
      <Suspense><DashboardContent /></Suspense>
    </ErrorBoundary>
  );
}
