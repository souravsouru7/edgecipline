import apiClient from "@/services/apiClient";

const WEEKLY_GENERATE_TIMEOUT_MS = 130_000;

export const listWeeklyReports = async (limit = 12, marketType = "Forex") => {
  return apiClient.get(
    `/reports/weekly?limit=${encodeURIComponent(limit)}&marketType=${encodeURIComponent(marketType)}`
  );
};

export const getWeeklyReport = async (id) => {
  return apiClient.get(`/reports/weekly/${id}`);
};

export const generateWeeklyFeedbackNow = async (marketType = "Forex") => {
  return apiClient.post(
    `/reports/weekly/generate-now?marketType=${encodeURIComponent(marketType)}`,
    undefined,
    {
      skipRateLimitRetry: true,
      timeout: WEEKLY_GENERATE_TIMEOUT_MS,
    }
  );
};

