"use client";

import { Button } from "@/features/shared/components/ui";

// Step labels come straight from the backend funnel so their wording and
// order can be tuned server-side without redeploying the frontend.
export default function OnboardingShell({
  funnel,
  title,
  subtitle,
  primaryLabel,
  primaryDisabled,
  primaryLoading,
  onPrimary,
  secondaryLabel,
  onSecondary,
  skipLabel,
  onSkip,
  children,
}) {
  return (
    <div className="ec-app ec-onb">
      <header className="ec-onb__top">
        <div className="ec-auth__brand">
          <img src="/logo.png" alt="" width={28} height={28} />
          <span>Edgecipline</span>
        </div>
        {skipLabel && (
          <Button variant="ghost" size="sm" onClick={onSkip}>
            {skipLabel}
          </Button>
        )}
      </header>

      <Progress funnel={funnel} />

      <main className="ec-onb__main">
        <section className="ec-card ec-card--pad ec-onb__card">
          <h1 className="ec-auth__title">{title}</h1>
          {subtitle && <p className="ec-auth__sub">{subtitle}</p>}

          <div className="ec-onb__body">{children}</div>

          <div className="ec-onb__actions">
            {secondaryLabel && (
              <Button variant="secondary" onClick={onSecondary}>
                {secondaryLabel}
              </Button>
            )}
            {/* The label stays put while loading and a spinner appears beside
                it, so the button doesn't resize mid-tap. */}
            <Button
              className="ec-onb__primary"
              onClick={onPrimary}
              disabled={primaryDisabled}
              loading={primaryLoading}
              aria-busy={primaryLoading || undefined}
            >
              {primaryLabel}
            </Button>
          </div>
        </section>
      </main>
    </div>
  );
}

function Progress({ funnel }) {
  const steps = funnel?.steps || [];
  if (steps.length === 0) return null;
  const done = steps.filter((s) => s.completed).length;
  const currentIndex = Math.min(done, steps.length - 1);
  const current = steps.find((s) => s.key === funnel?.nextStepKey) || steps[currentIndex];
  const position = Math.max(steps.indexOf(current), 0) + 1;

  return (
    <div className="ec-onb__progress">
      <div className="ec-onb__progress-label">
        <span>Step {position} of {steps.length}</span>
        <span className="ec-onb__progress-step">{current?.label}</span>
      </div>
      <ol className="ec-onb__bars" aria-label={`Setup progress: ${done} of ${steps.length} done`}>
        {steps.map((step) => (
          <li
            key={step.key}
            className={`ec-onb__bar${step.completed ? " is-done" : ""}${step === current ? " is-current" : ""}`}
            aria-label={`${step.label}${step.completed ? ", done" : step === current ? ", current step" : ""}`}
          />
        ))}
      </ol>
    </div>
  );
}
