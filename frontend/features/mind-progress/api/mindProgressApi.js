import apiClient from "@/services/apiClient";

const opts = (signal) => (signal ? { signal } : undefined);

// A 404 means the feature is switched off server-side (MIND_PROGRESS_ENABLED)
// or the API predates it: the UI treats both as "no Mind Score", not an error.
async function orDisabled(promise) {
  try {
    return await promise;
  } catch (error) {
    if (error?.status === 404) return { status: "disabled" };
    throw error;
  }
}

export const getMindCard = (signal) => orDisabled(apiClient.get("/mind-progress/card", opts(signal)));
export const getMindProgress = (signal) => orDisabled(apiClient.get("/mind-progress", opts(signal)));

export const getMindMicro = async (signal) => {
  try {
    const res = await apiClient.get("/mind-progress/micro", opts(signal));
    return res?.micro ?? null;
  } catch {
    return null; // the save already succeeded; the reward is optional
  }
};

export const markMindWinsSeen = (ids) => apiClient.post("/mind-progress/wins/seen", { ids });
export const getMindTargetSuggestions = (signal) => apiClient.get("/mind-progress/targets/suggestions", opts(signal));
export const setMindTarget = ({ preset, params }) => apiClient.put("/mind-progress/target", { preset, params: params || {} });
export const cancelMindTarget = () => apiClient.delete("/mind-progress/target");
