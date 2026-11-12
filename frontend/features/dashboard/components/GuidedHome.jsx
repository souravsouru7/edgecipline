"use client";

import Link from "next/link";
import { BarChart3, Camera, Check, Lock, MessageCircle, PenLine, Sparkles } from "lucide-react";
import { Button } from "@/features/shared/components/ui";
import { useLogTrade } from "@/features/trade/components/LogTradeChooser";

// First-run home for users with no trades. Replaces the dashboard grid until
// the first trade lands, so a new person sees what the app is for and the
// three things to do — not a wall of empty charts.
//
// Steps come from the snapshot's onboarding flags (same ones the onboarding
// flow writes; see GettingStartedCard / onboardingService.FLOW_STEPS).

export function guidedSteps(onboarding = {}, routes) {
  return [
    {
      key: "market",
      title: "Choose your market",
      why: "Forex or Indian F&O. Your journal and analytics are kept separate per market.",
      done: Boolean(onboarding?.marketSelected),
      href: "/onboarding?step=marketSelected", // STEPS in app/onboarding/page.js
      cta: "Choose",
    },
    {
      key: "setup",
      title: "Write down your setup",
      why: "The rules of the trade you want to repeat. Every trade gets checked against them.",
      done: Boolean(onboarding?.setupAdded),
      href: `${routes.setups}?onboarding=1`,
      cta: "Create setup",
    },
    {
      key: "trade",
      title: "Log your first trade",
      why: "Upload a broker screenshot and AI fills in the details. Takes about 30 seconds.",
      done: Boolean(onboarding?.tradeAdded),
      cta: "Log trade",
    },
  ];
}

const UNLOCKS = [
  { Icon: BarChart3, title: "Equity curve & stats", body: "Win rate, average win vs loss, P&L over time." },
  { Icon: Sparkles, title: "Your trading patterns", body: "Strengths, money leaks and what to fix next." },
  { Icon: MessageCircle, title: "AI coach", body: "Ask about your own trades, not generic tips." },
];

export default function GuidedHome({ name, onboarding, routes }) {
  const { open: openLogTrade } = useLogTrade();
  const steps = guidedSteps(onboarding, routes);
  const doneCount = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done) || steps.at(-1);

  return (
    <div className="ec-guide">
      <section className="ec-guide__intro">
        <p className="ec-dash__eyebrow">Getting started</p>
        <h1 className="ec-guide__title">Welcome{name ? `, ${name}` : ""}. Let&apos;s build your edge.</h1>
        <p className="ec-guide__lead">
          Edgecipline is your AI trading coach. Log your trades, and it shows the patterns and habits
          that make or lose you money, then tells you what to work on next.
        </p>
      </section>

      <div className="ec-guide__grid">
        <section className="ec-card ec-guide__steps" aria-label="Setup steps">
          <div className="ec-guide__progress-head">
            <h2 className="ec-card__title">3 steps to your first insight</h2>
            <span className="ec-num ec-guide__count">{doneCount}/3</span>
          </div>
          <div className="ec-guide__bar" role="progressbar" aria-valuemin={0} aria-valuemax={3} aria-valuenow={doneCount}>
            <span style={{ width: `${(doneCount / 3) * 100}%` }} />
          </div>

          <ol className="ec-guide__list">
            {steps.map((s, i) => {
              const isNext = s.key === next.key && !s.done;
              return (
                <li key={s.key} className={`ec-guide__step${s.done ? " is-done" : ""}${isNext ? " is-next" : ""}`}>
                  <span className="ec-guide__num" aria-hidden="true">{s.done ? <Check size={16} strokeWidth={3} /> : i + 1}</span>
                  <div className="ec-guide__body">
                    <h3>{s.title}{s.done && <span className="ec-sr"> (done)</span>}</h3>
                    <p>{s.why}</p>
                    {isNext && (
                      <div className="ec-guide__actions">
                        {s.key === "trade" ? (
                          <>
                            <Button icon={<Camera size={17} />} onClick={openLogTrade}>Upload screenshot</Button>
                            <Button as={Link} href={routes.addTrade} variant="ghost" icon={<PenLine size={16} />}>Enter manually</Button>
                          </>
                        ) : (
                          <Button as={Link} href={s.href}>{s.cta}</Button>
                        )}
                      </div>
                    )}
                  </div>
                  {!isNext && !s.done && (
                    <Link href={s.href || routes.uploadTrade} className="ec-dash__link">{s.cta}</Link>
                  )}
                </li>
              );
            })}
          </ol>
        </section>

        <section className="ec-card ec-guide__unlocks" aria-label="Unlocks after your first trade">
          <h2 className="ec-card__title">Unlocks after your first trade</h2>
          <ul>
            {UNLOCKS.map(({ Icon, title, body }) => (
              <li key={title}>
                <span className="ec-guide__unlock-icon"><Icon size={18} /></span>
                <span>
                  <strong>{title}</strong>
                  <small>{body}</small>
                </span>
                <Lock size={14} className="ec-guide__lock" aria-label="Locked" />
              </li>
            ))}
          </ul>
          <p className="ec-guide__note">No sample data. Everything here is built from your own trades.</p>
        </section>
      </div>
    </div>
  );
}
