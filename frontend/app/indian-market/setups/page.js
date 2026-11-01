"use client";

import { MARKETS } from "@/context/MarketContext";
import IndianMarketHeader from "@/components/IndianMarketHeader";
import IndianMarketLoadingState from "@/components/IndianMarketLoadingState";
import SetupBuilder from "@/features/setups/components/SetupBuilder";

const STARTER_TEMPLATES = [
  {
    name: "NIFTY Opening Range Breakout",
    description: "Use when NIFTY breaks the first range with volume and clean risk.",
    rules: [
      "First 15-minute range is clearly formed",
      "Breakout candle closes beyond the range high or low",
      "Volume supports the breakout direction",
      "Stop loss is inside or below the broken range",
    ],
  },
  {
    name: "BANKNIFTY VWAP Pullback",
    description: "Use when BANKNIFTY trends, pulls back to VWAP, then rejects.",
    rules: [
      "Trend direction is clear before the pullback",
      "Price pulls back near VWAP or a key moving average",
      "Rejection candle forms in the trend direction",
      "Target gives at least 1:2 risk reward",
    ],
  },
  {
    name: "Stock Breakout Retest",
    description: "Use for NSE stocks breaking a major level and retesting it cleanly.",
    rules: [
      "Stock breaks a strong support or resistance level",
      "Retest holds the broken level",
      "Entry happens after confirmation, not during the first spike",
      "Invalidation level is clear before entry",
    ],
  },
];

const COPY = {
  onboardingTitle: "Create one Indian market setup first.",
  onboardingBody: "Pick an example or create your own, add simple NSE / BSE rules, then press Save setups at the bottom. After saving, we will take you to import your first Indian trade.",
  namePlaceholder: "e.g. NIFTY Opening Range Breakout…",
  rulePlaceholder: "Add a rule for this setup…",
};

export default function IndianSetupStrategiesPage() {
  return (
    <SetupBuilder
      market={MARKETS.INDIAN_MARKET}
      header={<IndianMarketHeader />}
      templates={STARTER_TEMPLATES}
      marketChip="NSE / BSE"
      copy={COPY}
      uploadRoute="/indian-market/upload-trade?onboarding=1"
      loadingState={
        <IndianMarketLoadingState
          title="Loading Indian Market setups"
          subtitle="Preparing strategies, setup rules, and reference images"
          dense
        />
      }
    />
  );
}
