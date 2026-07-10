import apiClient from "@/services/apiClient";

export const getOnboardingState = (signal) =>
  apiClient.get("/onboarding", signal ? { signal } : undefined);

export const selectOnboardingMarket = (market) =>
  apiClient.post("/onboarding/market", { market });

export const selectOnboardingStyle = (style) =>
  apiClient.post("/onboarding/style", { style });

export const seedOnboardingSetup = (payload = {}) =>
  apiClient.post("/onboarding/setup", payload);

export const skipFirstTrade = (reason = "not_traded_yet") =>
  apiClient.post("/onboarding/skip-trade", { reason });

export const generateFirstInsight = () =>
  apiClient.post("/onboarding/insight", {});

export const completeOnboarding = () =>
  apiClient.post("/onboarding/complete", {});
