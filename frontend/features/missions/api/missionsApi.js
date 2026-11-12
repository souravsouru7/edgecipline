import apiClient from "@/services/apiClient";

// The list endpoints answer { success, data, pagination? } and every caller
// reads `.data` (and `.pagination` for history). apiClient strips the envelope
// by default, which left those reads undefined and the Missions page empty, so
// these ask for the envelope as sent.
const raw = (signal) => (signal ? { signal, rawEnvelope: true } : { rawEnvelope: true });

export const getActiveMissions = (signal) =>
  apiClient.get("/missions", raw(signal));

export const getMissionHistory = ({ page = 1, limit = 20 } = {}, signal) =>
  apiClient.get(`/missions/history?page=${page}&limit=${limit}`, raw(signal));

export const getMission = (id, signal) =>
  apiClient.get(`/missions/${id}`, signal ? { signal } : undefined);

export const getMissionStats = (signal) =>
  apiClient.get("/missions/stats", raw(signal));

export const getMissionTemplates = ({ category, difficulty } = {}, signal) => {
  const params = new URLSearchParams();
  if (category) params.set("category", category);
  if (difficulty) params.set("difficulty", difficulty);
  const qs = params.toString();
  return apiClient.get(`/missions/templates${qs ? `?${qs}` : ""}`, raw(signal));
};

export const getBehaviorProfile = ({ lookback = 30 } = {}, signal) =>
  apiClient.get(`/missions/profile?lookback=${lookback}`, signal ? { signal } : undefined);

export const acceptMission = (id) =>
  apiClient.post(`/missions/${id}/accept`, {});

export const archiveMission = (id) =>
  apiClient.post(`/missions/${id}/archive`, {});

export const getRecommendations = ({ lookback = 30 } = {}) =>
  apiClient.post(`/missions/recommend?lookback=${lookback}`, {});
