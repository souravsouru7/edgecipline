import apiClient from "@/services/apiClient";

// { Forex: {dailyLossLimit, maxTradesPerDay, promptAnsweredAt}, Indian_Market: {...} }
export const getRiskLimits = () => apiClient.get("/profile/risk-limits");

// payload: { market, dailyLossLimit?, maxTradesPerDay?, promptAnswered? }
export const updateRiskLimits = (payload) => apiClient.patch("/profile/risk-limits", payload);
