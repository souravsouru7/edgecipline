import { API_URL } from "@/config/api";
import { getValidToken, hydrateAuthToken } from "@/utils/auth";

const readPayload = async (response) => {
  const payload = await response.json();
  return payload?.success === true && Object.prototype.hasOwnProperty.call(payload, "data")
    ? payload.data
    : payload;
};

export const logChecklistEvent = async (data) => {
  const token = getValidToken() || await hydrateAuthToken();
  if (!token) throw new Error("No token found");

  const response = await fetch(`${API_URL}/checklists/track`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errData = await response.json();
    throw new Error(errData.error?.message || errData.message || "Failed to log checklist");
  }

  return readPayload(response);
};

export const getChecklistStats = async (market) => {
  const token = getValidToken() || await hydrateAuthToken();
  if (!token) throw new Error("No token found");

  const response = await fetch(`${API_URL}/checklists/track${market ? `?market=${market}` : ''}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const errData = await response.json();
    throw new Error(errData.error?.message || errData.message || "Failed to fetch checklist stats");
  }

  return readPayload(response);
};
