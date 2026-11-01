"use client";

import { useMarket } from "@/context/MarketContext";
import { Skeleton } from "@/features/shared";
import PageHeader from "@/features/shared/components/PageHeader";
import IndianMarketHeader from "@/components/IndianMarketHeader";
import OnboardingMarketGuard from "@/features/onboarding/components/OnboardingMarketGuard";
import SetupBuilder from "@/features/setups/components/SetupBuilder";

const STARTER_TEMPLATES = [
  {
    name: "Breakout Setup",
    description: "Use when price breaks a clear range with momentum.",
    rules: [
      "Market is trending or breaking out of a clean range",
      "Breakout candle closes beyond the key level",
      "Volume or momentum confirms the move",
      "Stop loss is below the breakout level",
    ],
  },
  {
    name: "Pullback Setup",
    description: "Use when price returns to value inside an existing trend.",
    rules: [
      "Trend direction is clear before entry",
      "Price pulls back to support, resistance, or moving average",
      "Entry candle rejects the pullback area",
      "Target gives at least 1:2 risk reward",
    ],
  },
  {
    name: "Reversal Setup",
    description: "Use only when price rejects an important level.",
    rules: [
      "Price reaches a major support or resistance zone",
      "There is rejection wick or failed breakout",
      "Entry happens after confirmation, not before",
      "Risk is small if the level breaks",
    ],
  },
];

const COPY = {
  onboardingTitle: "Create one setup or strategy first.",
  onboardingBody: "Pick an example or create your own, add simple rules, then press Save setups at the bottom. After saving, we will take you to import your first trade.",
  namePlaceholder: "e.g. London Breakout, NY Reversal…",
  rulePlaceholder: "Describe this rule…",
};

const loadingState = (
  <div className="sp-panel sp-skel">
    <Skeleton width="160px" height="14px" style={{ marginBottom: 14 }} />
    <Skeleton width="100%" height="48px" style={{ borderRadius: 12, marginBottom: 12 }} />
    {[...Array(3)].map((_, j) => (
      <Skeleton key={j} width="100%" height="44px" style={{ borderRadius: 12, marginBottom: 8 }} />
    ))}
  </div>
);

function SetupStrategiesContent() {
  const { currentMarket, getMarketLabel } = useMarket();
  const isIndian = currentMarket === "Indian_Market";

  return (
    <SetupBuilder
      market={currentMarket}
      header={isIndian ? <IndianMarketHeader /> : <PageHeader />}
      templates={STARTER_TEMPLATES}
      marketChip={getMarketLabel()}
      copy={COPY}
      uploadRoute={isIndian ? "/indian-market/upload-trade?onboarding=1" : "/upload-trade?onboarding=1"}
      loadingState={loadingState}
    />
  );
}

export default function SetupStrategiesPage() {
  return (
    <OnboardingMarketGuard>
      <SetupStrategiesContent />
    </OnboardingMarketGuard>
  );
}
