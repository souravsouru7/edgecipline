"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ErrorBoundary from "@/components/ErrorBoundary";
import { useMarket } from "@/context/MarketContext";
import { markOnboardingStep, setPreferredMarket as setPreferredMarketLocal } from "@/services/api";
import OnboardingShell from "@/features/onboarding/components/OnboardingShell";
import WelcomeStep from "@/features/onboarding/components/WelcomeStep";
import MarketStep from "@/features/onboarding/components/MarketStep";
import TradeStep from "@/features/onboarding/components/TradeStep";
import OnboardingError from "@/features/onboarding/components/OnboardingError";
import {
  useCompleteOnboarding,
  useOnboardingState,
  useSelectMarket,
} from "@/features/onboarding/hooks/useOnboarding";

// Step order MUST mirror onboardingService.FLOW_STEPS on the backend so the
// resume logic (server returns the next-incomplete step) and the progress
// trail labels line up exactly.
const STEPS = [
  "welcomeSeen",
  "marketSelected",
  "setupAdded",
  "tradeAdded",
  "journalSeen",
];

function setupRouteForMarket() {
  return "/setups?onboarding=1";
}

function Page() {
  const router = useRouter();
  const search = useSearchParams();
  const stateQuery = useOnboardingState();
  const selectMarket = useSelectMarket();
  const complete = useCompleteOnboarding();
  const { toggleMarket } = useMarket();

  const state = stateQuery.data;
  const funnel = state?.funnel;

  // Resume on the first incomplete step. We allow known `?step=` values to
  // override, and ignore stale links from older onboarding routes.
  const stepParam = search.get("step");
  const requestedStep = STEPS.includes(stepParam) ? stepParam : null;
  const resumeKey = requestedStep || funnel?.nextStepKey || (funnel?.isComplete ? "done" : "welcomeSeen");
  const [activeKey, setActiveKey] = useState(resumeKey);
  useEffect(() => { setActiveKey(resumeKey); }, [resumeKey]);

  const [marketChoice, setMarketChoice] = useState(state?.preferredMarket || null);

  useEffect(() => {
    if (state?.preferredMarket && !marketChoice) setMarketChoice(state.preferredMarket);
  }, [state?.preferredMarket]); // eslint-disable-line react-hooks/exhaustive-deps

  const shouldShortCircuitToDashboard = Boolean(
    state?.isPreActivated &&
    (
      funnel?.isComplete ||
      state?.onboarding?.completedAt ||
      state?.onboarding?.tourCompleted
    )
  );

  // Pre-existing accounts: the server backfilled their funnel from real
  // data (trades / setups / preferredMarket) and flagged them as already
  // activated. Don't make them walk through the wizard — short-circuit to
  // the dashboard. Defence in depth on top of the login-time redirect.
  useEffect(() => {
    if (!shouldShortCircuitToDashboard) return;
    router.replace("/dashboard?onboarded=existing");
  }, [shouldShortCircuitToDashboard]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeKey !== "setupAdded") return;
    router.replace(setupRouteForMarket());
  }, [activeKey, state?.preferredMarket, marketChoice, router]);

  // Final hop — when the funnel is complete, route to the dashboard. The
  // dashboard hides FirstLoginWelcome via the existing welcomeSeen flag.
  useEffect(() => {
    if (activeKey !== "done") return;
    complete.mutate(undefined, {
      onSettled: () => router.replace("/dashboard?onboarded=1"),
    });
  }, [activeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function gotoNext() {
    const idx = STEPS.indexOf(activeKey);
    setActiveKey(STEPS[Math.min(idx + 1, STEPS.length - 1)] || "done");
  }
  function gotoPrev() {
    const idx = STEPS.indexOf(activeKey);
    setActiveKey(STEPS[Math.max(idx - 1, 0)] || "welcomeSeen");
  }

  async function handleSkip() {
    // Skip = mark the user as having seen the welcome and let them into the
    // dashboard. Their getting-started card will still nudge them through the
    // remaining steps.
    try { await markOnboardingStep("welcomeSeen", true); } catch {/* non-blocking */}
    router.replace("/dashboard?onboarding=skipped");
  }

  const isLoadingState = stateQuery.isLoading;

  if (isLoadingState) {
    return <ShellLoading />;
  }

  // Each step gets its own primary action + content. We share the shell so the
  // funnel trail + header chrome stays identical across the flow.

  if (activeKey === "welcomeSeen") {
    return (
      <OnboardingShell
        funnel={funnel}
        title="Welcome to Edgecipline."
        subtitle="Set your market, create a starter setup, import a trade, then let your coach review it. We'll save your progress at every step."
        skipLabel="Skip"
        onSkip={handleSkip}
        primaryLabel="Start"
        onPrimary={async () => {
          try { await markOnboardingStep("welcomeSeen", true); } catch {/* non-blocking */}
          await stateQuery.refetch();
          gotoNext();
        }}
      >
        <WelcomeStep />
      </OnboardingShell>
    );
  }

  if (activeKey === "marketSelected") {
    return (
      <OnboardingShell
        funnel={funnel}
        title="Which market do you trade?"
        subtitle="We'll tailor your setup template and sample demo to your market. Switch later from the top header."
        skipLabel="Skip onboarding"
        onSkip={handleSkip}
        secondaryLabel="← Back"
        onSecondary={gotoPrev}
        primaryLabel={marketChoice ? "Continue →" : "Pick a market"}
        primaryDisabled={!marketChoice}
        primaryLoading={selectMarket.isPending}
        onPrimary={async () => {
          if (!marketChoice) return;
          toggleMarket(marketChoice);
          setPreferredMarketLocal(marketChoice).catch(() => {});
          try {
            await selectMarket.mutateAsync(marketChoice);
            router.push(setupRouteForMarket());
          } catch {/* error banner already shown via mutation state */}
        }}
      >
        <MarketStep value={marketChoice} onChange={setMarketChoice} />
        <OnboardingError
          error={selectMarket.error}
          onRetry={() => selectMarket.reset()}
          retrying={selectMarket.isPending}
        />
      </OnboardingShell>
    );
  }

  if (activeKey === "setupAdded") {
    return <ShellLoading />;
  }

  if (activeKey === "tradeAdded") {
    const market = state?.preferredMarket || marketChoice;
    return (
      <OnboardingShell
        funnel={funnel}
        title="Import your first trade."
        subtitle="Use a broker screenshot or manual entry. Once it saves, we will open your trade log."
        skipLabel="Skip onboarding"
        onSkip={handleSkip}
        secondaryLabel="← Back"
        onSecondary={gotoPrev}
        primaryLabel="Open import"
        onPrimary={() => {
          const marketRoot = market === "Indian_Market" ? "/indian-market" : "";
          router.push(`${marketRoot}/upload-trade?onboarding=1`);
        }}
      >
        <TradeStep market={market} />
      </OnboardingShell>
    );
  }

  if (activeKey === "journalSeen") {
    const market = state?.preferredMarket || marketChoice;
    const marketRoot = market === "Indian_Market" ? "/indian-market" : "";
    return (
      <OnboardingShell
        funnel={funnel}
        title="Review your trade log."
        subtitle="Your first trade is saved. Open your trade log to confirm it and finish activation."
        secondaryLabel="← Back"
        onSecondary={gotoPrev}
        primaryLabel="Open trade log"
        onPrimary={() => router.push(`${marketRoot}/trades?onboarding=1`)}
      >
        <div style={{
          padding: "14px",
          borderRadius: 12,
          background: "rgba(34,199,142,0.08)",
          border: "1px solid rgba(34,199,142,0.22)",
          color: "#CBD5E1",
          fontSize: 12,
          lineHeight: 1.6,
        }}>
          Your trade log is where every saved trade lives. This final step confirms the loop: setup, import, review.
        </div>
      </OnboardingShell>
    );
  }

  // "done" intermediate state — handled by the useEffect above.
  return <ShellLoading />;
}

function ShellLoading() {
  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(180deg, #0F1923 0%, #182333 100%)",
      color: "#F1F5F9",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "var(--font-plus-jakarta-sans)",
      fontSize: 13,
    }}>
      Loading your onboarding…
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <ErrorBoundary fallback={<div style={{ padding: "2rem", textAlign: "center" }}>Onboarding failed to load. Please refresh.</div>}>
      <Suspense fallback={<ShellLoading />}><Page /></Suspense>
    </ErrorBoundary>
  );
}
