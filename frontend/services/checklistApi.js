import { API_URL } from "@/config/api";
import { getValidToken } from "@/utils/auth";

export const logChecklistEvent = async (data) => {
  const token = getValidToken();
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
    throw new Error(errData.message || "Failed to log checklist");
  }

  return await response.json();
};

export const getChecklistStats = async (market) => {
  const token = getValidToken();
  if (!token) throw new Error("No token found");

  const response = await fetch(`${API_URL}/checklists/track${market ? `?market=${market}` : ''}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const errData = await response.json();
    throw new Error(errData.message || "Failed to fetch checklist stats");
  }

  return await response.json();
};
