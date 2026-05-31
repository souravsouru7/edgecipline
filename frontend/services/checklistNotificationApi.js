import { API_URL } from "@/config/api";
import { getValidToken } from "@/utils/auth";

async function authFetch(path, options = {}) {
  const token = getValidToken();
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
    throw new Error(err.message || "Request failed");
  }
  return res.json();
}

export const getChecklistNotificationSettings = () =>
  authFetch("/checklists/notification-settings");

export const saveChecklistNotificationSettings = (data) =>
  authFetch("/checklists/notification-settings", {
    method: "PUT",
    body: JSON.stringify(data),
  });
