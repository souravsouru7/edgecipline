"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ErrorBoundary from "@/components/ErrorBoundary";
import { useMarket } from "@/context/MarketContext";
import { markOnboardingStep, setPreferredMarket as setPreferredMarketLocal } from "@/services/api";
import OnboardingShell from "@/features/onboarding/components/OnboardingShell";
import WelcomeStep from "@/features/onboarding/components/WelcomeStep";
import MarketStep from "@/features/onboarding/components/MarketStep";
import StyleStep from "@/features/onboarding/components/StyleStep";
import SetupStep from "@/features/onboarding/components/SetupStep";
import TradeStep from "@/features/onboarding/components/TradeStep";
import InsightStep from "@/features/onboarding/components/InsightStep";
import OnboardingError from "@/features/onboarding/components/OnboardingError";
import {
  useCompleteOnboarding,
  useGenerateFirstInsight,
  useOnboardingState,
  useSeedSetup,
  useSelectMarket,
  useSelectStyle,
  useSkipFirstTrade,
} from "@/features/onboarding/hooks/useOnboarding";

// Step order MUST mirror onboardingService.FLOW_STEPS on the backend so the
// resume logic (server returns the next-incomplete step) and the progress
// trail labels line up exactly.
const STEPS = [
  "welcomeSeen",
  "marketSelected",
  "styleSelected",
  "setupAdded",
  "tradeAdded",
  "firstInsightSeen",
];

function Page() {
  const router = useRouter();
  const search = useSearchParams();
  const stateQuery = useOnboardingState();
  const selectMarket = useSelectMarket();
  const selectStyle = useSelectStyle();
  const seedSetup = useSeedSetup();
  const skipTrade = useSkipFirstTrade();
  const generateInsight = useGenerateFirstInsight();
  const complete = useCompleteOnboarding();
  const { toggleMarket } = useMarket();

  const state = stateQuery.data;
  const funnel = state?.funnel;

  // Resume on the first incomplete step. We allow `?step=` to override (used
  // by the trade page when it links the user back after a successful save).
  const requestedStep = search.get("step");
  const resumeKey = requestedStep || funnel?.nextStepKey || (funnel?.isComplete ? "done" : "welcomeSeen");
  const [activeKey, setActiveKey] = useState(resumeKey);
  useEffect(() => { setActiveKey(resumeKey); }, [resumeKey]);

  const [marketChoice, setMarketChoice] = useState(state?.preferredMarket || null);
  const [styleChoice, setStyleChoice] = useState(state?.tradingStyle || null);
  const [customising, setCustomising] = useState(false);
  const [custom, setCustom] = useState({ name: "", rules: ["", "", ""] });

  useEffect(() => {
    if (state?.preferredMarket && !marketChoice) setMarketChoice(state.preferredMarket);
    if (state?.tradingStyle && !styleChoice) setStyleChoice(state.tradingStyle);
  }, [state?.preferredMarket, state?.tradingStyle]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedStyle = useMemo(() => {
    if (!state?.styles) return null;
    return state.styles.find((s) => s.id === styleChoice) || null;
  }, [state?.styles, styleChoice]);

  const insight = generateInsight.data?.insight || null;

  // Pre-existing accounts: the server backfilled their funnel from real
  // data (trades / setups / preferredMarket) and flagged them as already
  // activated. Don't make them walk through the wizard — short-circuit to
  // the dashboard. Defence in depth on top of the login-time redirect.
  useEffect(() => {
    if (!state?.isPreActivated) return;
    router.replace("/dashboard?onboarded=existing");
  }, [state?.isPreActivated]); // eslint-disable-line react-hooks/exhaustive-deps

  // Final hop — when the funnel is complete, route to the dashboard. The
  // dashboard hides FirstLoginWelcome via the existing welcomeSeen flag.
  useEffect(() => {
    if (activeKey !== "done") return;
    complete.mutate(undefined, {
      onSettled: () => router.replace("/dashboard?onboarded=1"),
    });
  }, [activeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-fire the insight generation as soon as the user lands on the
  // insight step (after logging a trade or skipping). Idempotent on the
  // backend, so a refresh just re-renders the same insight.
  useEffect(() => {
    if (activeKey !== "firstInsightSeen") return;
    if (generateInsight.data || generateInsight.isPending) return;
    generateInsight.mutate();
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
        subtitle="Six milestones guide you from market choice to your first journal review. We'll save your progress at every step - close any time."
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
        subtitle="We'll tailor your screenshot AI, setup form, and journal to your market. Switch later from the top header."
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
            gotoNext();
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

  if (activeKey === "styleSelected") {
    return (
      <OnboardingShell
        funnel={funnel}
        title="How do you trade?"
        subtitle="Your style shapes our suggested setup template, your coach prompts, and the patterns we surface first."
        skipLabel="Skip onboarding"
        onSkip={handleSkip}
        secondaryLabel="← Back"
        onSecondary={gotoPrev}
        primaryLabel={styleChoice ? "Continue →" : "Pick a style"}
        primaryDisabled={!styleChoice}
        primaryLoading={selectStyle.isPending}
        onPrimary={async () => {
          if (!styleChoice) return;
          try {
            await selectStyle.mutateAsync(styleChoice);
            gotoNext();
          } catch {/* banner */}
        }}
      >
        <StyleStep
          styles={state?.styles || []}
          value={styleChoice}
          onChange={setStyleChoice}
        />
        <OnboardingError
          error={selectStyle.error}
          onRetry={() => selectStyle.reset()}
          retrying={selectStyle.isPending}
        />
      </OnboardingShell>
    );
  }

  if (activeKey === "setupAdded") {
    return (
      <OnboardingShell
        funnel={funnel}
        title="Lock in your default setup."
        subtitle="A setup is the pattern you wait for. We'll create a starter from your style — you can edit it now or refine it any time from Setups."
        skipLabel="Skip onboarding"
        onSkip={handleSkip}
        secondaryLabel="← Back"
        onSecondary={gotoPrev}
        primaryLabel={customising ? "Save my setup" : "Use this setup"}
        primaryLoading={seedSetup.isPending}
        onPrimary={async () => {
          const body = {
            style: styleChoice,
            market: marketChoice || state?.preferredMarket,
          };
          if (customising) {
            const cleanRules = (custom.rules || []).map((r) => String(r || "").trim()).filter(Boolean);
            if (cleanRules.length === 0) return;
            body.custom = {
              name: String(custom.name || selectedStyle?.seedSetup?.name || "My setup").trim() || "My setup",
              rules: cleanRules,
            };
          }
          try {
            await seedSetup.mutateAsync(body);
            gotoNext();
          } catch {/* banner */}
        }}
      >
        <SetupStep
          selectedStyle={selectedStyle}
          customising={customising}
          custom={custom}
          onCustomToggle={() => {
            const next = !customising;
            setCustomising(next);
            if (next && selectedStyle?.seedSetup) {
              setCustom({
                name: selectedStyle.seedSetup.name,
                rules: [...selectedStyle.seedSetup.rules],
              });
            }
          }}
          onCustomChange={setCustom}
        />
        <OnboardingError
          error={seedSetup.error}
          onRetry={() => seedSetup.reset()}
          retrying={seedSetup.isPending}
        />
      </OnboardingShell>
    );
  }

  if (activeKey === "tradeAdded") {
    const market = state?.preferredMarket || marketChoice;
    return (
      <OnboardingShell
        funnel={funnel}
        title="Log your first trade."
        subtitle="This is where everything lights up. Upload a screenshot, type one in, or tell us you haven't traded yet — we adapt either way."
        skipLabel="Do this later"
        onSkip={handleSkip}
        secondaryLabel="← Back"
        onSecondary={gotoPrev}
        primaryLabel="I'll do this later — see my dashboard"
        onPrimary={async () => {
          // The user can still preview an insight without a logged trade —
          // the service has a no-trade welcome path.
          gotoNext();
        }}
      >
        <TradeStep
          market={market}
          skipping={skipTrade.isPending}
          error={skipTrade.error}
          onSkipTrade={async () => {
            try {
              await skipTrade.mutateAsync("not_traded_yet");
              gotoNext();
            } catch {/* TradeStep renders its own inline notice */}
          }}
        />
      </OnboardingShell>
    );
  }

  if (activeKey === "firstInsightSeen") {
    return (
      <OnboardingShell
        funnel={funnel}
        title="Your first insight is ready."
        subtitle="Every reply from Edgecipline is grounded in your real data — no generic advice."
        secondaryLabel="← Back"
        onSecondary={gotoPrev}
        primaryLabel="Open my dashboard →"
        primaryLoading={complete.isPending || generateInsight.isPending}
        onPrimary={() => setActiveKey("done")}
      >
        <InsightStep insight={insight} loading={generateInsight.isPending} />
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
