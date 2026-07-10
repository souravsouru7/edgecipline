import apiClient from "@/services/apiClient";

export const getStreaks = async (days = 90, signal) =>
  apiClient.get(`/streaks?days=${days}`, signal ? { signal } : undefined);

export const markNoTradeToday = async ({ market, note } = {}) =>
  apiClient.post("/streaks/no-trade-today", { market, note });

export const recomputeStreaks = async () =>
  apiClient.post("/streaks/recompute", {});

export const updateRuleThreshold = async (threshold) =>
  apiClient.put("/streaks/threshold", { threshold });
