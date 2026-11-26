"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Brain, Lock, Plus, Target } from "lucide-react";
import PageHeader from "@/features/shared/components/PageHeader";
import { Button, Card, CardHeader, EmptyState, ErrorState, Placeholder } from "@/features/shared/components/ui";
import { useMindProgressPage } from "@/features/mind-progress/hooks/useMindProgress";
import { enqueueCelebrations } from "@/features/mind-progress/rewardBus";
import { DeltaChip, LevelBar, ReasonList, TargetPips, UnlockDots } from "@/features/mind-progress/components/MindBits";
import TargetPicker from "@/features/mind-progress/components/TargetPicker";
import MindInfoButton from "@/features/mind-progress/components/MindHowItWorks";
import { MIND_COMPONENTS } from "@/features/mind-progress/mindComponents";
import { MARKETS, useMarket } from "@/context/MarketContext";

const COMPONENTS = MIND_COMPONENTS;

const UNLOCK_HINT = {
  emotional: "Tag emotions on 3+ trades",
  discipline: "Use your checklist or answer 'followed plan?'",
  recovery: "Needs 2 losing trades with a follow-up",
  selfAwareness: "Rate 3+ trades Great / Average / Poor",
  journaling: "Journal a trade or reflection",
};

// "2026-11-26" → "Thu, 26 Nov" (day keys are calendar days, so format in UTC).
function formatDay(dayKey) {
  const [y, m, d] = String(dayKey || "").split("-").map(Number);
  if (!y || !m || !d) return dayKey;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

/** 30-day line. Plain SVG: tiny, theme-aware through currentColor/tokens. */
function ScoreChart({ series, startingScore, personalBest }) {
  const W = 320;
  const H = 120;
  const pad = 8;
  const pts = useMemo(() => {
    if (!series?.length) return [];
    const n = series.length;
    return series.map((p, i) => ({
      x: n === 1 ? W / 2 : pad + (i * (W - 2 * pad)) / (n - 1),
      y: H - pad - (p.score / 100) * (H - 2 * pad),
      ...p,
    }));
  }, [series]);
  if (pts.length < 2) {
    return <p className="ec-mind__chart-empty">Your graph starts drawing after a couple more journal days 📈</p>;
  }
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1].x.toFixed(1)},${H - pad} L${pts[0].x.toFixed(1)},${H - pad} Z`;
  const last = pts[pts.length - 1];
  const levelLines = [30, 50, 70, 85, 95];
  return (
    <figure className="ec-mind__chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Mind Score over the last ${pts.length} journal days, now ${last.score}`} preserveAspectRatio="none">
        {levelLines.map((v) => {
          const y = H - pad - (v / 100) * (H - 2 * pad);
          return <line key={v} x1={0} x2={W} y1={y} y2={y} className="ec-mind__chart-grid" />;
        })}
        <path d={area} className="ec-mind__chart-area" />
        <path d={line} className="ec-mind__chart-line" vectorEffect="non-scaling-stroke" />
        <circle cx={last.x} cy={last.y} r={4} className="ec-mind__chart-dot" />
      </svg>
      <figcaption className="ec-mind__chart-legend">
        {startingScore != null && <span>Started <strong>{startingScore}</strong></span>}
        {personalBest != null && <span>Best <strong>{personalBest}</strong></span>}
        <span>Now <strong>{last.score}</strong></span>
      </figcaption>
    </figure>
  );
}

export default function MindProgressPage() {
  const { currentMarket } = useMarket();
  const tradeEntryHref = currentMarket === MARKETS.INDIAN_MARKET ? "/indian-market/add-trade" : "/add-trade";
  const { data, isLoading, error, refetch } = useMindProgressPage();
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (data?.celebrations?.length) enqueueCelebrations(data.celebrations);
  }, [data?.celebrations]);

  useEffect(() => {
    if (data?.status !== "calibrating") return undefined;
    const t = setTimeout(() => refetch(), 4000);
    return () => clearTimeout(t);
  }, [data?.status, refetch]);

  let body;
  if (isLoading) {
    body = (
      <div className="ec-disc__stack" aria-busy="true">
        <Placeholder height={220} radius={16} />
        <Placeholder height={160} radius={16} />
        <Placeholder height={200} radius={16} />
      </div>
    );
  } else if (error) {
    body = <Card><ErrorState title="Couldn't load your Mind Score" onRetry={() => refetch()} /></Card>;
  } else if (!data || data.status === "disabled") {
    body = <Card><EmptyState icon={<Brain size={22} />} title="Mind Score isn't available right now" body="Check back soon." /></Card>;
  } else if (data.status === "calibrating") {
    body = <Card><EmptyState icon={<Brain size={22} />} title="Building your Mind Score…" body="Reading your journal. This takes a few seconds." /></Card>;
  } else if (data.status === "locked") {
    body = (
      <Card>
        <div className="ec-mind__locked ec-mind__locked--page">
          <div className="ec-mind__locked-emoji" aria-hidden="true">🧠</div>
          <UnlockDots have={data.journaledDays} need={data.unlockDays} />
          <h2 className="ec-mind__locked-title">{data.lockedLine}</h2>
          <p className="ec-mind__locked-sub">
            Your Mind Score tracks the trader you&apos;re becoming: calm after losses, discipline, honesty with yourself.
            It never looks at P&amp;L, so every honest journal day counts.
          </p>
          <Button as={Link} href={tradeEntryHref} icon={<Plus size={16} />}>Journal a trade</Button>
        </div>
      </Card>
    );
  } else {
    const stale = data.status === "stale";
    const target = data.target;
    body = (
      <div className="ec-disc__stack">
        <Card className="ec-mind ec-mind--hero">
          <div className="ec-mind__hero">
            <div className="ec-mind__score-block">
              <div className="ec-mind__score-row">
                <span className="ec-mind__score ec-mind__score--xl">{data.score}</span>
                <DeltaChip delta={data.delta} held={stale || data.delta === 0} />
              </div>
              <LevelBar level={data.level} />
            </div>
            <div className="ec-mind__story">
              {stale ? <p className="ec-mind__headline">{data.staleLine}</p> : data.headline && <p className="ec-mind__headline">{data.headline}</p>}
              {!stale && <ReasonList reasons={data.reasons} />}
              {data.insight && <blockquote className="ec-mind__insight">💬 {data.insight}</blockquote>}
            </div>
          </div>
          <ScoreChart series={data.series} startingScore={data.startingScore} personalBest={data.personalBest} />
        </Card>

        <Card>
          <CardHeader title="Levels" subtitle="Climb by journaling honestly and staying calm" />
          <ol className="ec-mind__ladder">
            {(data.levels || []).map((l) => {
              const current = data.level?.level === l.level;
              return (
                <li key={l.level} className={`${l.reached ? "is-reached" : ""} ${current ? "is-current" : ""}`}>
                  <span className="ec-mind__ladder-emoji" aria-hidden="true">{l.reached ? l.emoji : "🔒"}</span>
                  <span className="ec-mind__ladder-name">Lv {l.level} · {l.name}</span>
                  <span className="ec-mind__ladder-min">{l.min}+</span>
                  {current && <span className="ec-mind__ladder-you">You</span>}
                </li>
              );
            })}
          </ol>
        </Card>

        <Card>
          <CardHeader title="What your score is made of" subtitle="Psychology only, never P&L" />
          <ul className="ec-mind__components">
            {COMPONENTS.map((c) => {
              const value = data.components?.[c.key];
              const locked = value == null;
              return (
                <li key={c.key} className={locked ? "is-locked" : ""}>
                  <div className="ec-mind__comp-row">
                    <span className="ec-mind__comp-label"><span aria-hidden="true">{c.emoji}</span> {c.label} <span className="ec-mind__comp-weight">{c.weight}%</span></span>
                    <span className="ec-mind__comp-value">{locked ? <Lock size={13} aria-label="locked" /> : Math.round(value)}</span>
                  </div>
                  <div className="ec-mind__bar ec-mind__bar--thin" aria-hidden="true"><span style={{ width: `${locked ? 0 : Math.round(value)}%` }} /></div>
                  <p className="ec-mind__comp-what">{locked ? `🔓 ${UNLOCK_HINT[c.key]}` : c.what}</p>
                </li>
              );
            })}
          </ul>
        </Card>

        {data.trend?.length > 0 && (
          <Card>
            <CardHeader title="This week vs last" />
            <ul className="ec-mind__trend">
              {data.trend.map((t, i) => (
                <li key={`${t.type}-${i}`} className={t.sign < 0 ? "is-down" : "is-up"}>{t.text}</li>
              ))}
            </ul>
          </Card>
        )}

        <Card>
          <CardHeader
            title="Weekly focus"
            action={<Button size="sm" variant="secondary" icon={<Target size={15} />} onClick={() => setPickerOpen(true)}>{target ? "Change" : "Pick one"}</Button>}
          />
          {target ? (
            <div className="ec-mind__focus-detail">
              <p className="ec-mind__focus-label">{target.label}</p>
              <TargetPips target={target} />
              <p className="ec-mind__focus-count">{target.cleanDays} of {target.goal} clean days · ends {formatDay(target.endDay)}</p>
            </div>
          ) : (
            <p className="ec-mind__muted">No focus this week. Pick one built from your own trades and earn a Mind Win when you hit it 🎯</p>
          )}
          {data.targetHistory?.length > 0 && (
            <ul className="ec-mind__history">
              {data.targetHistory.map((t) => (
                <li key={t.id}>
                  <span>{t.status === "completed" ? "🎯" : t.status === "expired" ? "⏳" : "✖️"} {t.label}</span>
                  <span>{t.cleanDays}/{t.goal}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Mind Wins" subtitle={`${data.wins?.length || 0} earned`} />
          <ul className="ec-mind__wins">
            {(data.wins || []).map((w) => (
              <li key={w.id} className="is-earned">
                <strong>{w.title}</strong>
                <span>{w.body}</span>
              </li>
            ))}
            {(data.lockedWins || []).map((w) => (
              <li key={w.key} className="is-locked">
                <strong>🔒 ???</strong>
                <span>{w.hint}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    );
  }

  return (
    <div className="ec-app ec-home">
      <PageHeader themed showMarketSwitcher title="Mind Score" />
      <main className="ec-page ec-disc">
        <div className="ec-log__head">
          <div style={{ minWidth: 0 }}>
            <h1 className="ec-log__title ec-mind__page-title">Mind Score <MindInfoButton /></h1>
            <p className="ec-log__sub">The trader you&apos;re becoming, from your own journal. Compared only with yourself.</p>
          </div>
        </div>
        {body}
      </main>
      <TargetPicker open={pickerOpen} onClose={() => setPickerOpen(false)} current={data?.target || null} />
    </div>
  );
}
