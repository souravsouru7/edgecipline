import apiClient from "@/services/apiClient";

export const getTodayReflection = (signal) =>
  apiClient.get("/reflections/today", signal ? { signal } : undefined);

export const getReflectionSummary = (signal) =>
  apiClient.get("/reflections/summary", signal ? { signal } : undefined);

export const listReflections = (days = 14, signal) =>
  apiClient.get(`/reflections?days=${days}`, signal ? { signal } : undefined);

export const submitReflection = (payload) =>
  apiClient.post("/reflections", payload);

export const skipReflection = (payload = {}) =>
  apiClient.post("/reflections/skip", payload);
