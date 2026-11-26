"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Brain, ChevronRight, Target } from "lucide-react";
import { Button, Card, Placeholder } from "@/features/shared/components/ui";
import { useMindCard } from "@/features/mind-progress/hooks/useMindProgress";
import { enqueueCelebrations } from "@/features/mind-progress/rewardBus";
import { DeltaChip, LevelBar, ReasonList, TargetPips, UnlockDots } from "@/features/mind-progress/components/MindBits";
import TargetPicker from "@/features/mind-progress/components/TargetPicker";
import MindInfoButton from "@/features/mind-progress/components/MindHowItWorks";

/**
 * Dashboard Mind Score card. Every sentence on it is rendered server-side from
 * this trader's own journal (headline, reasons, focus, AI line). States:
 * calibrating (first build), locked (< 3 journal days), active, stale (14+
 * days away — the score held, no "you dropped" message). Any error hides the
 * card: the dashboard never breaks because of it.
 */
export default function MindScoreCard({ onLogTrade }) {
  const { data, isLoading, error, refetch } = useMindCard();
  const [pickerOpen, setPickerOpen] = useState(false);

  // Unseen level-ups / wins (e.g. earned by the morning job) pop once here.
  useEffect(() => {
    if (data?.celebrations?.length) enqueueCelebrations(data.celebrations);
  }, [data?.celebrations]);

  // First ever view kicks a background build; check back shortly.
  useEffect(() => {
    if (data?.status !== "calibrating") return undefined;
    const t = setTimeout(() => refetch(), 4000);
    return () => clearTimeout(t);
  }, [data?.status, refetch]);

  if (isLoading) return <Placeholder height={150} radius={20} />;
  if (error || !data || data.status === "disabled" || data.status === "unavailable") return null;

  const header = (
    <div className="ec-mind__head">
      <span className="ec-mind__title-wrap">
        <span className="ec-mind__title"><Brain size={16} aria-hidden="true" /> Mind Score</span>
        <MindInfoButton />
      </span>
      <Link href="/progress" className="ec-dash__link ec-mind__more">
        See progress <ChevronRight size={14} aria-hidden="true" />
      </Link>
    </div>
  );

  if (data.status === "calibrating") {
    return (
      <Card className="ec-mind">
        {header}
        <p className="ec-mind__locked-line">Reading your journal to build your Mind Score… 🧠</p>
        <Placeholder height={14} width="60%" />
      </Card>
    );
  }

  if (data.status === "locked") {
    return (
      <Card className="ec-mind ec-mind--locked">
        {header}
        <div className="ec-mind__locked">
          <UnlockDots have={data.journaledDays} need={data.unlockDays} />
          <p className="ec-mind__locked-line">{data.lockedLine}</p>
          <p className="ec-mind__locked-sub">
            A score for your trading mind: calm after losses, discipline, honest journaling. Not P&amp;L.
            It counts days, not trades: one journaled day per date.
          </p>
          {onLogTrade && !data.journaledToday && (
            <Button size="sm" variant="secondary" onClick={onLogTrade}>Journal today</Button>
          )}
        </div>
      </Card>
    );
  }

  const stale = data.status === "stale";
  const target = data.target;

  return (
    <Card className="ec-mind">
      {header}
      <div className="ec-mind__grid">
        <div className="ec-mind__score-block">
          <div className="ec-mind__score-row">
            <span className="ec-mind__score" aria-label={`Mind Score ${data.score}`}>{data.score}</span>
            <DeltaChip delta={data.delta} held={stale || data.delta === 0} />
          </div>
          <LevelBar level={data.level} />
          {data.startingScore != null && data.startingScore !== data.score && (
            <p className="ec-mind__journey">Started at {data.startingScore} · Best {data.personalBest}</p>
          )}
        </div>

        <div className="ec-mind__story">
          {stale ? (
            <p className="ec-mind__headline">{data.staleLine}</p>
          ) : (
            data.headline && <p className="ec-mind__headline">{data.headline}</p>
          )}
          {!stale && data.reasons?.length > 0 && (
            <>
              <p className="ec-mind__why">Why {data.delta >= 0 ? `+${data.delta}` : `−${Math.abs(data.delta)}`} today</p>
              <ReasonList reasons={data.reasons} />
            </>
          )}
          {data.earlyRead && data.earlyReadHint && (
            <p className="ec-mind__hint">🔓 {data.earlyReadHint}</p>
          )}
          {data.insight && <blockquote className="ec-mind__insight">💬 {data.insight}</blockquote>}
        </div>

        <div className="ec-mind__focus">
          {target ? (
            <button type="button" className="ec-mind__target ec-focusable" onClick={() => setPickerOpen(true)}>
              <span className="ec-mind__target-label"><Target size={14} aria-hidden="true" /> {target.label}</span>
              <TargetPips target={target} />
              <span className="ec-mind__target-count">{target.cleanDays}/{target.goal} clean days</span>
            </button>
          ) : (
            <Button size="sm" variant="secondary" icon={<Target size={15} />} onClick={() => setPickerOpen(true)}>
              Pick a weekly focus
            </Button>
          )}
        </div>
      </div>
      <TargetPicker open={pickerOpen} onClose={() => setPickerOpen(false)} current={target} />
    </Card>
  );
}
