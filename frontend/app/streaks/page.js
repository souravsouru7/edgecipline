"use client";

import { useState } from "react";
import { success as hapticSuccess } from "@/utils/haptics";
import Link from "next/link";
import { Flame, Sparkles, CheckCircle2, Plus, Moon } from "lucide-react";
import PageHeader from "@/features/shared/components/PageHeader";
import { Button, Card, CardHeader, EmptyState, ErrorState, Input, Placeholder } from "@/features/shared/components/ui";
import { useStreaks, useMarkNoTradeToday } from "@/features/streaks/hooks/useStreaks";
import StreakCalendar from "@/features/streaks/components/StreakCalendar";
import StreakMilestones from "@/features/streaks/components/StreakMilestones";
import { MARKETS, useMarket } from "@/context/MarketContext";

export default function StreaksPage() {
  const { currentMarket } = useMarket();
  const tradeEntryHref = currentMarket === MARKETS.INDIAN_MARKET ? "/indian-market/add-trade" : "/add-trade";
  const { data, isLoading, error, refetch } = useStreaks(90);
  const markNoTrade = useMarkNoTradeToday();
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");

  let body;
  if (isLoading) {
    body = (
      <div className="ec-disc__stack" aria-busy="true">
        <Placeholder height={170} radius={16} />
        <Placeholder height={110} radius={16} />
        <Placeholder height={190} radius={16} />
      </div>
    );
  } else if (error) {
    body = <Card><ErrorState title="Couldn't load streaks" onRetry={() => refetch?.()} /></Card>;
  } else if (!data) {
    body = (
      <Card>
        <EmptyState
          icon={<Flame size={22} />}
          title="No streaks yet"
          body="Log your first trade to start one."
          action={<Button as={Link} href={tradeEntryHref} icon={<Plus size={16} />}>Log a trade</Button>}
        />
      </Card>
    );
  } else {
    const journal = data.journal || { current: 0, longest: 0, atRisk: false, recoveryAvailable: true };
    const checklist = data.checklist || { current: 0, longest: 0 };
    const rule = data.rule || { current: 0, longest: 0, threshold: 70 };
    const calendar = data.calendar || [];
    const milestones = data.milestones || [];
    const todayCell = calendar.find((c) => c.day === data.todayKey);
    const alreadyLoggedToday = !!todayCell && todayCell.qualifiesJournal;
    const live = journal.current > 0;

    const saveSatOut = () =>
      markNoTrade.mutate(
        { note, market: currentMarket },
        { onSuccess: () => { void hapticSuccess(); setNoteOpen(false); setNote(""); } }
      );

    body = (
      <div className="ec-disc__stack">
        <Card>
          <div className="ec-streak__hero">
            <div className={`ec-streak__count${live ? " is-live" : ""}`} aria-label={`${journal.current} day streak`}>
              {live ? <Flame size={34} aria-hidden="true" /> : <Sparkles size={30} aria-hidden="true" />}
              <span>{journal.current}</span>
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="ec-disc__eyebrow" style={{ marginBottom: 4 }}>Discipline streak</div>
              <h2 className="ec-streak__headline">{headlineFor(journal)}</h2>
              <p className="ec-streak__sub">{subFor(journal, alreadyLoggedToday)}</p>
            </div>
          </div>

          {/* Never punitive: two clear ways to keep today. */}
          {!alreadyLoggedToday && !noteOpen && (
            <div className="ec-streak__actions">
              <Button as={Link} href={tradeEntryHref} icon={<Plus size={16} />}>Log a trade</Button>
              <Button variant="secondary" icon={<Moon size={16} />} onClick={() => setNoteOpen(true)}>
                I sat out today
              </Button>
            </div>
          )}

          {noteOpen && !alreadyLoggedToday && (
            <div className="ec-streak__satout">
              <p className="ec-streak__satout-title">Mark today as “Sat out”. It keeps your streak without trading.</p>
              <Input
                aria-label="Why you sat out (optional)"
                value={note}
                maxLength={280}
                onChange={(e) => setNote(e.target.value.slice(0, 280))}
                placeholder="Optional: why (no setup, high-impact news…)"
              />
              {markNoTrade.isError && (
                <p className="ec-streak__err" role="alert">{"Couldn't save. Try again."}</p>
              )}
              <div className="ec-streak__actions" style={{ marginTop: 10 }}>
                <Button onClick={saveSatOut} loading={markNoTrade.isPending}>Mark sat out</Button>
                <Button variant="ghost" onClick={() => setNoteOpen(false)} disabled={markNoTrade.isPending}>Cancel</Button>
              </div>
            </div>
          )}

          {alreadyLoggedToday && (
            <div className="ec-streak__done" role="status">
              <CheckCircle2 size={16} aria-hidden="true" /> Today is locked in. See you tomorrow.
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Milestones" subtitle="Lit cells are streaks you have already protected" />
          <StreakMilestones milestones={milestones} current={journal.current} longest={journal.longest} />
        </Card>

        <Card>
          <CardHeader title="Last 12 weeks" subtitle="Every cell is a day you showed up, or didn't" />
          <StreakCalendar calendar={calendar} />
        </Card>

        <Card>
          <CardHeader title="Other discipline measures" />
          <div className="ec-disc__grid">
            <Metric
              label="Checklist streak"
              value={checklist.current}
              sub={`Best ${checklist.longest}`}
              hint="Trading days where you ran the pre-trade checklist."
            />
            <Metric
              label="Rule discipline streak"
              value={rule.current}
              sub={`Best ${rule.longest} · threshold ${rule.threshold}%`}
              hint="Trades in a row where your setup score met your threshold."
            />
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="ec-app ec-home">
      <PageHeader themed showMarketSwitcher title="Streaks" />
      <main className="ec-page ec-disc">
        <div className="ec-log__head">
          <div style={{ minWidth: 0 }}>
            <h1 className="ec-log__title">Streaks</h1>
            <p className="ec-log__sub">Show up every trading day. A trade or a “Sat out” both count.</p>
          </div>
        </div>
        {body}
      </main>
    </div>
  );
}

function headlineFor(j) {
  if (j.current >= 30) return "A full month of discipline.";
  if (j.current >= 14) return "Two weeks of consistency.";
  if (j.current >= 7) return "A full week protected.";
  if (j.current >= 3) return "Momentum is building.";
  if (j.current >= 1) return "You're on day one.";
  return "Start a new streak today.";
}

function subFor(j, alreadyLogged) {
  if (alreadyLogged && j.current >= 1) return "You showed up today. The streak rolls on tomorrow.";
  if (j.atRisk && j.current >= 1) {
    return j.recoveryAvailable
      ? "Your streak is safe if you log today. Even a “Sat out” counts."
      : "Log today to keep it alive.";
  }
  if (j.current === 0 && j.longest > 0) return `Your best run was ${j.longest} days. Today is day one of the next one.`;
  return "One trade or one “Sat out” is all today needs.";
}

function Metric({ label, value, sub, hint }) {
  return (
    <div className="ec-disc__tile">
      <div className="ec-disc__tile-label">{label}</div>
      <div className="ec-streak__metric">{value}</div>
      <div className="ec-disc__row-meta">{sub}</div>
      {hint && <div className="ec-disc__tile-text" style={{ marginTop: 6 }}>{hint}</div>}
    </div>
  );
}
