import apiClient from "@/services/apiClient";

export const getDashboardSnapshot = async (signal, marketType = "") => {
  const query = marketType ? `?market=${encodeURIComponent(marketType)}` : "";
  return await apiClient.get(`/dashboard/snapshot${query}`, signal ? { signal } : undefined);
};
