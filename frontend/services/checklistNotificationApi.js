import { API_URL } from "@/config/api";
import { getValidToken, hydrateAuthToken } from "@/utils/auth";

async function authFetch(path, options = {}) {
  const token = getValidToken() || await hydrateAuthToken();
  if (!token) throw new Error("No token found");
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || err.message || "Request failed");
  }
  const payload = await res.json();
  return payload?.success === true && Object.prototype.hasOwnProperty.call(payload, "data")
    ? payload.data
    : payload;
}

export const getChecklistNotificationSettings = (market = "Forex") =>
  authFetch(`/checklists/notification-settings?market=${encodeURIComponent(market)}`);

export const saveChecklistNotificationSettings = (data) =>
  authFetch("/checklists/notification-settings", {
    method: "PUT",
    body: JSON.stringify(data),
  });
