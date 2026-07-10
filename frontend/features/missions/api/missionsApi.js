import apiClient from "@/services/apiClient";

export const getActiveMissions = (signal) =>
  apiClient.get("/missions", signal ? { signal } : undefined);

export const getMissionHistory = ({ page = 1, limit = 20 } = {}, signal) =>
  apiClient.get(`/missions/history?page=${page}&limit=${limit}`, signal ? { signal } : undefined);

export const getMission = (id, signal) =>
  apiClient.get(`/missions/${id}`, signal ? { signal } : undefined);

export const getMissionStats = (signal) =>
  apiClient.get("/missions/stats", signal ? { signal } : undefined);

export const getMissionTemplates = ({ category, difficulty } = {}, signal) => {
  const params = new URLSearchParams();
  if (category) params.set("category", category);
  if (difficulty) params.set("difficulty", difficulty);
  const qs = params.toString();
  return apiClient.get(`/missions/templates${qs ? `?${qs}` : ""}`, signal ? { signal } : undefined);
};

export const getBehaviorProfile = ({ lookback = 30 } = {}, signal) =>
  apiClient.get(`/missions/profile?lookback=${lookback}`, signal ? { signal } : undefined);

export const acceptMission = (id) =>
  apiClient.post(`/missions/${id}/accept`, {});

export const archiveMission = (id) =>
  apiClient.post(`/missions/${id}/archive`, {});

export const getRecommendations = ({ lookback = 30 } = {}) =>
  apiClient.post(`/missions/recommend?lookback=${lookback}`, {});
