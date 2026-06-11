import { API_URL as BASE_URL } from "@/config/api";
import { getValidToken, hydrateAuthToken } from "@/utils/auth";

const getAuthHeaders = async () => {
  const token = getValidToken() || await hydrateAuthToken();
  return {
    "Content-Type": "application/json",
    Authorization: token ? `Bearer ${token}` : "",
  };
};

const handleResponse = async (res) => {
  if (!res.ok) {
    const errorText = await res.text();
    let errorMessage = `Request failed with status ${res.status}`;
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.message || errorMessage;
    } catch (e) {
      // ignore
    }
    const err = new Error(errorMessage);
    err.status = res.status;
    throw err;
  }
  return res.json();
};

export const listWeeklyReports = async (limit = 12, marketType = "Forex") => {
  const res = await fetch(
    `${BASE_URL}/reports/weekly?limit=${encodeURIComponent(limit)}&marketType=${encodeURIComponent(marketType)}`,
    { headers: await getAuthHeaders() }
  );
  return handleResponse(res);
};

export const getWeeklyReport = async (id) => {
  const res = await fetch(`${BASE_URL}/reports/weekly/${id}`, {
    headers: await getAuthHeaders(),
  });
  return handleResponse(res);
};

export const generateWeeklyFeedbackNow = async (marketType = "Forex") => {
  const res = await fetch(
    `${BASE_URL}/reports/weekly/generate-now?marketType=${encodeURIComponent(marketType)}`,
    {
      method: "POST",
      headers: await getAuthHeaders(),
    }
  );
  return handleResponse(res);
};

