"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ErrorBoundary from "@/components/ErrorBoundary";
import { useMarket } from "@/context/MarketContext";
import { getOnboardingSetupsUrl } from "@/utils/marketNavigation";
import { markOnboardingStep } from "@/services/api";
import { markStartupContentReady } from "@/utils/startupGate";
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

function Page() {
  const router = useRouter();
  const search = useSearchParams();
  const stateQuery = useOnboardingState();
  const selectMarket = useSelectMarket();
  const complete = useCompleteOnboarding();
  const { toggleMarket } = useMarket();

  const state = stateQuery.data;
  const funnel = state?.funnel;

  // Release the brand opener once this screen has something real to show —
  // success or error, both are content. Until this fires the opener stays up,
  // so the user never sees a loading screen hand off to another loading
  // screen on a cold start into onboarding.
  useEffect(() => {
    if (stateQuery.isSuccess || stateQuery.isError) markStartupContentReady();
  }, [stateQuery.isSuccess, stateQuery.isError]);

  // Resume on the first incomplete step. We allow known `?step=` values to
  // override, and ignore stale links from older onboarding routes.
  const stepParam = search.get("step");
  const requestedStep = STEPS.includes(stepParam) ? stepParam : null;
  const resumeKey = requestedStep || funnel?.nextStepKey || (funnel?.isComplete ? "done" : "welcomeSeen");
  const [activeKey, setActiveKey] = useState(resumeKey);
  useEffect(() => { setActiveKey(resumeKey); }, [resumeKey]);

  const [marketChoice, setMarketChoice] = useState(state?.preferredMarket || null);
  const selectedMarket = state?.preferredMarket || marketChoice;

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
    router.replace(getOnboardingSetupsUrl(selectedMarket));
  }, [activeKey, selectedMarket, router]);

  // Final hop — when the funnel is complete, route to the dashboard. The
  // dashboard hides FirstLoginWelcome via the existing welcomeSeen flag.
  useEffect(() => {
    if (activeKey !== "done") return;
    // Navigate first. The dashboard reads the funnel itself, so holding the
    // user on a loading screen for the length of this request bought nothing
    // — and on a failed request it stranded them there completely.
    complete.mutate();
    router.replace("/dashboard?onboarded=1");
  }, [activeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Start" used to await markOnboardingStep AND a refetch of the whole
  // onboarding state before moving — two round-trips during which the button
  // showed no loading state at all, so on a slow connection the first tap in
  // the app looked like it did nothing. The step is recorded in the
  // background; nothing on the next screen depends on the answer, and the
  // funnel trail is corrected by the next natural refetch if it fails.
  const advanceFromWelcome = useCallback(() => {
    markOnboardingStep("welcomeSeen", true).catch(() => {});
    setActiveKey("marketSelected");
  }, []);

  // router.push on a heavy route can take a moment to paint. Without this the
  // button looked inert and users tapped it again.
  const [navigating, setNavigating] = useState(false);
  const navigateTo = useCallback((href) => {
    if (navigating) return;
    setNavigating(true);
    router.push(href);
  }, [navigating, router]);
  // A back gesture returns to this screen without unmounting it, so the
  // button has to become tappable again.
  useEffect(() => { setNavigating(false); }, [activeKey]);

  function gotoNext() {
    const idx = STEPS.indexOf(activeKey);
    setActiveKey(STEPS[Math.min(idx + 1, STEPS.length - 1)] || "done");
  }
  function gotoPrev() {
    const idx = STEPS.indexOf(activeKey);
    setActiveKey(STEPS[Math.max(idx - 1, 0)] || "welcomeSeen");
  }

  function handleSkip() {
    // Skip = mark the user as having seen the welcome and let them into the
    // dashboard. Their getting-started card will still nudge them through the
    // remaining steps. Fire-and-forget: awaiting it only delayed the exit the
    // user just asked for, and the dashboard re-reads this flag anyway.
    markOnboardingStep("welcomeSeen", true).catch(() => {});
    router.replace("/dashboard?onboarding=skipped");
  }

  const isLoadingState = stateQuery.isLoading;

  if (isLoadingState) {
    return <ShellLoading />;
  }

  // Offline or a failing API used to fall through to the welcome step with an
  // empty funnel: the progress trail vanished, and a user resuming halfway
  // was silently sent back to the beginning. Say what happened and offer a
  // real retry instead.
  if (stateQuery.isError && !state) {
    return (
      <OnboardingShell
        funnel={null}
        title="We couldn't load your setup."
        subtitle="Check your connection and try again. Nothing you've done so far is lost."
        primaryLabel="Try again"
        primaryLoading={stateQuery.isFetching}
        onPrimary={() => stateQuery.refetch()}
        secondaryLabel="Go to dashboard"
        onSecondary={() => router.replace("/dashboard")}
      >
        <OnboardingError error={stateQuery.error} />
      </OnboardingShell>
    );
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
        onPrimary={advanceFromWelcome}
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
          if (!marketChoice || selectMarket.isPending) return;
          toggleMarket(marketChoice);
          // No separate PATCH /auth/me/preferences here: the onboarding
          // market endpoint writes preferredMarket itself (see
          // onboardingService.selectMarket), so the second request only added
          // latency and a chance of the two disagreeing.
          try {
            await selectMarket.mutateAsync(marketChoice);
            router.push(getOnboardingSetupsUrl(marketChoice));
          } catch {/* error banner already shown via mutation state */}
        }}
      >
        <MarketStep value={marketChoice} onChange={setMarketChoice} />
        {/* Retry re-sends the request. It used to call reset(), which only
            cleared the banner and left the step unsaved. */}
        <OnboardingError
          error={selectMarket.error}
          onRetry={() => marketChoice && selectMarket.mutate(marketChoice)}
          retrying={selectMarket.isPending}
        />
      </OnboardingShell>
    );
  }

  if (activeKey === "setupAdded") {
    return <ShellLoading label="Opening your setups" />;
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
        primaryLoading={navigating}
        onPrimary={() => {
          const marketRoot = market === "Indian_Market" ? "/indian-market" : "";
          navigateTo(`${marketRoot}/upload-trade?onboarding=1`);
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
        primaryLoading={navigating}
        onPrimary={() => navigateTo(`${marketRoot}/trades?onboarding=1`)}
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
  return <ShellLoading label="Finishing setup" />;
}

// A skeleton of the shell rather than a line of centred text. The card, the
// header and the progress trail are already in their final positions, so when
// the data lands the page fills in instead of replacing one screen with a
// completely different one.
function ShellLoading({ label = "Getting your setup ready" }) {
  const bar = (width, height = 12, extra = {}) => ({
    width,
    height,
    borderRadius: 999,
    background: "rgba(255,255,255,0.07)",
    animation: "onboardingPulse 1.4s ease-in-out infinite",
    ...extra,
  });
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #0F1923 0%, #182333 100%)",
        color: "#F1F5F9",
        fontFamily: "var(--font-plus-jakarta-sans)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <style>{`
        @keyframes onboardingPulse {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.45; }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-onboarding-skeleton] * { animation: none !important; }
        }
      `}</style>
      <div data-onboarding-skeleton style={{ display: "contents" }}>
        {/* Header: icon tile + two lines, same box as OnboardingShell's. */}
        <header style={{ padding: "20px 24px 0", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 30, height: 30, borderRadius: 10, background: "rgba(34,199,142,0.18)" }} />
          <div style={{ display: "grid", gap: 6 }}>
            <div style={bar(72, 9)} />
            <div style={bar(96, 12)} />
          </div>
        </header>

        {/* Progress trail pills. */}
        <div style={{ padding: "16px 24px 0", display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
          {[68, 82, 74, 90, 70].map((width, index) => (
            <div key={index} style={bar(width, 24, { borderRadius: 999 })} />
          ))}
        </div>

        <main style={{ flex: 1, padding: "20px 20px 32px", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <section style={{
            width: "100%",
            maxWidth: 520,
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 18,
            padding: "26px 24px 24px",
            display: "grid",
            gap: 14,
          }}>
            <div style={bar("70%", 22)} />
            <div style={bar("100%", 12)} />
            <div style={bar("85%", 12)} />
            <div style={bar("100%", 84, { borderRadius: 12, marginTop: 6 })} />
            <div style={bar("100%", 44, { borderRadius: 12, marginTop: 8 })} />
          </section>
        </main>
      </div>
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
