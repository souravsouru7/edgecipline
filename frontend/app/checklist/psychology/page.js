"use client";

import { Suspense, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft, BarChart3, Brain, ChevronRight, Crown, Flame, HeartCrack, OctagonX,
  RotateCcw, ShieldAlert, Shuffle, Timer, TrendingUp, Zap,
} from "lucide-react";
import PageHeader from "@/features/shared/components/PageHeader";
import { useTheme } from "@/utils/theme";
import { useSystemBars } from "@/features/shared/hooks/useSystemBars";
import { PSYCHOLOGY_PATTERNS, findPattern } from "@/features/checklist/data/psychologyPatterns";

const ICONS = { Zap, ShieldAlert, Flame, Crown, BarChart3, OctagonX, Brain, HeartCrack, Timer, Shuffle };

function PatternIcon({ name, size = 20 }) {
  const Icon = ICONS[name] || Brain;
  return <Icon size={size} aria-hidden="true" />;
}

function Steps({ items, tone }) {
  return (
    <ol className={`ec-psy__steps ec-psy__steps--${tone}`}>
      {items.map((text, i) => (
        <li key={i} className="ec-psy__step">
          <span className="ec-psy__num" aria-hidden="true">{i + 1}</span>
          <span>{text}</span>
        </li>
      ))}
    </ol>
  );
}

function Detail({ pattern, onOpen }) {
  return (
    <div className="ec-psy__detail">
      <section className="ec-psy__hero">
        <span className="ec-psy__hero-icon"><PatternIcon name={pattern.icon} size={26} /></span>
        <div style={{ minWidth: 0 }}>
          <p className="ec-dash__eyebrow">Pattern {String(pattern.id).padStart(2, "0")} · {pattern.tag}</p>
          <h1 className="ec-psy__title">{pattern.title}</h1>
          <p className="ec-psy__desc">{pattern.desc}</p>
        </div>
      </section>

      <p className="ec-psy__question">Do you recognise this in your last few trades?</p>

      <div className="ec-psy__paths">
        <section className="ec-psy__path ec-psy__path--bad" aria-label="If ignored">
          <h2 className="ec-psy__path-title">If ignored</h2>
          <p className="ec-psy__path-sub">What keeps happening</p>
          <Steps items={pattern.symptoms} tone="bad" />
          <div className="ec-psy__outcome">
            <RotateCcw size={18} aria-hidden="true" />
            <div>
              <strong>The cycle repeats</strong>
              <span>The same mistake keeps costing you, and the account slowly bleeds.</span>
            </div>
          </div>
        </section>
        <section className="ec-psy__path ec-psy__path--good" aria-label="If fixed">
          <h2 className="ec-psy__path-title">If fixed</h2>
          <p className="ec-psy__path-sub">What to do instead</p>
          <Steps items={pattern.solutions} tone="good" />
          <div className="ec-psy__outcome">
            <TrendingUp size={18} aria-hidden="true" />
            <div>
              <strong>Your edge builds</strong>
              <span>Discipline compounds, and consistency becomes your edge.</span>
            </div>
          </div>
        </section>
      </div>

      <section className="ec-psy__others" aria-label="Other patterns">
        <h2 className="ec-dash__eyebrow">Other patterns</h2>
        <div className="ec-psy__chips">
          {PSYCHOLOGY_PATTERNS.filter((p) => p.id !== pattern.id).map((p) => (
            <button key={p.id} type="button" className="ec-psy__chip ec-focusable" onClick={() => onOpen(p.id)}>
              <PatternIcon name={p.icon} size={15} />
              {p.title}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function Grid({ onOpen }) {
  return (
    <>
      <div className="ec-psy__intro">
        <h1 className="ec-psy__title">Trading psychology</h1>
        <p className="ec-psy__desc">
          Pick the pattern you&apos;re fighting. Each one shows what happens if you ignore it, and the steps that fix it.
        </p>
      </div>
      <div className="ec-psy__grid">
        {PSYCHOLOGY_PATTERNS.map((p) => (
          <button key={p.id} type="button" className="ec-psy__card ec-focusable" onClick={() => onOpen(p.id)}>
            <span className="ec-psy__card-icon"><PatternIcon name={p.icon} /></span>
            <span className="ec-psy__card-body">
              <span className="ec-psy__card-title">{p.title}</span>
              <span className="ec-psy__card-desc">{p.desc}</span>
            </span>
            <ChevronRight size={18} className="ec-psy__card-chev" aria-hidden="true" />
          </button>
        ))}
      </div>
    </>
  );
}

function PsychologyContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { theme } = useTheme();
  useSystemBars(theme);
  // ?p=<id> keeps the open pattern in the URL: the back gesture returns to
  // the grid and a pattern can be linked to directly.
  const pattern = findPattern(searchParams?.get("p"));

  const open = useCallback((id) => {
    router.push(`/checklist/psychology?p=${id}`);
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }, [router]);

  return (
    <div className="ec-app ec-home">
      <PageHeader themed title="Psychology guide" showMarketSwitcher={false} />
      <main className="ec-page ec-psy">
        {pattern ? (
          <button type="button" className="ec-psy__back ec-focusable" onClick={() => router.push("/checklist/psychology")}>
            <ArrowLeft size={16} aria-hidden="true" /> All patterns
          </button>
        ) : (
          <Link href="/checklist" className="ec-psy__back ec-focusable">
            <ArrowLeft size={16} aria-hidden="true" /> Checklist
          </Link>
        )}
        {pattern ? <Detail pattern={pattern} onOpen={open} /> : <Grid onOpen={open} />}
      </main>
    </div>
  );
}

export default function TradingPsychologyPage() {
  return <Suspense><PsychologyContent /></Suspense>;
}
