import apiClient from "@/services/apiClient";

export const getDashboardSnapshot = async (signal) => {
  return await apiClient.get("/dashboard/snapshot", signal ? { signal } : undefined);
};
