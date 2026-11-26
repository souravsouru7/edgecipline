import apiClient from "@/services/apiClient";

// The trade-entry screens (add, Indian add, upload) all mount the one-time
// risk-limits prompt, and each mount used to refetch these limits. They
// change only when the trader edits them, so keep one shared copy for a few
// minutes (and drop it on every update). Fewer calls also keeps a busy
// session clear of the API's per-user rate limit.
const TTL_MS = 5 * 60 * 1000;
let cached = null;
let cachedAt = 0;
let inflight = null;

// { Forex: {dailyLossLimit, maxTradesPerDay, promptAnsweredAt}, Indian_Market: {...} }
export const getRiskLimits = ({ fresh = false } = {}) => {
  if (!fresh && cached && Date.now() - cachedAt < TTL_MS) return Promise.resolve(cached);
  if (!fresh && inflight) return inflight;
  inflight = apiClient.get("/profile/risk-limits")
    .then((data) => {
      cached = data;
      cachedAt = Date.now();
      return data;
    })
    .finally(() => { inflight = null; });
  return inflight;
};

// payload: { market, dailyLossLimit?, maxTradesPerDay?, promptAnswered? }
export const updateRiskLimits = async (payload) => {
  cached = null;
  cachedAt = 0;
  const result = await apiClient.patch("/profile/risk-limits", payload);
  cached = null;
  return result;
};
