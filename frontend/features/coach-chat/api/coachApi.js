import apiClient from "@/services/apiClient";

export const getCoachQuota = (signal) =>
  apiClient.get("/coach/quota", signal ? { signal } : undefined);

export const getQuickPrompts = (anchor = "freeform", signal) =>
  apiClient.get(`/coach/quick-prompts?anchor=${encodeURIComponent(anchor)}`, signal ? { signal } : undefined);

export const listConversations = (limit = 20, anchorKind, signal) => {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  if (anchorKind) params.set("anchorKind", anchorKind);
  return apiClient.get(`/coach/conversations?${params.toString()}`, signal ? { signal } : undefined);
};

export const getConversation = (id, signal) =>
  apiClient.get(`/coach/conversations/${id}`, signal ? { signal } : undefined);

export const createConversation = (payload = {}) =>
  apiClient.post("/coach/conversations", payload);

export const deleteConversation = (id) =>
  apiClient.delete(`/coach/conversations/${id}`);

// Context is cached per market server-side, so tell it which one to rebuild.
export const refreshCoachContext = (market) =>
  apiClient.post("/coach/refresh-context", market ? { market } : {});
