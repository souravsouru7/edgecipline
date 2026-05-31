import { API_URL as BASE_URL } from "@/config/api";

/**
 * adminApi.js — Admin API client
 *
 * Authentication: uses the httpOnly admin_sid cookie set by POST /api/admin/auth/login.
 * credentials: "include" ensures the browser sends the cookie automatically.
 * No tokens are read from or written to localStorage by this module.
 */

export const clearAdminSession = async () => {
  if (typeof window === "undefined") return;
  // Clear display-only values stored in localStorage (non-sensitive)
  localStorage.removeItem("adminName");
  // Ask the server to clear the httpOnly admin_sid cookie
  try {
    await fetch(`${BASE_URL}/admin/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
  } catch {
    // Best-effort — cookie will expire on its own (8h)
  }
};

const handleResponse = async (res) => {
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) {
      // Clear display name and redirect to admin login
      localStorage.removeItem("adminName");
    }
    throw new Error(data.message || `Request failed with status ${res.status}`);
  }
  return res.json();
};

/** Shared fetch wrapper that always sends credentials (cookie). */
const adminFetch = (url, options = {}) =>
  fetch(`${BASE_URL}${url}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

/**
 * Admin Login
 * POST /api/admin/auth/login
 * Server sets admin_sid httpOnly cookie on success.
 */
export const adminLogin = async ({ email, password }) => {
  const res = await adminFetch("/admin/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  return handleResponse(res);
};

/**
 * Get Admin Profile
 * GET /api/admin/auth/me
 */
export const getAdminProfile = async () => {
  const res = await adminFetch("/admin/auth/me");
  return handleResponse(res);
};

export const getAdminStats = async () => {
  const res = await adminFetch("/admin/analytics/stats");
  return handleResponse(res);
};

export const getAdminGrowth = async () => {
  const res = await adminFetch("/admin/analytics/growth");
  return handleResponse(res);
};

export const getAllAdminUsers = async () => {
  const res = await adminFetch("/admin/users");
  return handleResponse(res);
};

export const deleteAdminUser = async (id) => {
  const res = await adminFetch(`/admin/users/${id}`, { method: "DELETE" });
  return handleResponse(res);
};

export const toggleAdminUserStatus = async (id) => {
  const res = await adminFetch(`/admin/users/${id}/status`, { method: "PATCH" });
  return handleResponse(res);
};

export const extendAdminUserPlan = async (id, days) => {
  const res = await adminFetch(`/admin/users/${id}/extend`, {
    method: "PATCH",
    body: JSON.stringify({ days }),
  });
  return handleResponse(res);
};

export const getAdminPayments = async () => {
  const res = await adminFetch("/admin/payments");
  return handleResponse(res);
};

export const updateAdminPaymentStatus = async (id, status) => {
  const res = await adminFetch(`/admin/payments/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  return handleResponse(res);
};

export const addManualPayment = async (paymentData) => {
  const res = await adminFetch("/admin/payments/manual", {
    method: "POST",
    body: JSON.stringify(paymentData),
  });
  return handleResponse(res);
};

export const getExpiredAdminUsers = async () => {
  const res = await adminFetch("/admin/users/expired");
  return handleResponse(res);
};

export const sendAdminRenewalReminder = async (id) => {
  const res = await adminFetch(`/admin/users/${id}/remind`, { method: "POST" });
  return handleResponse(res);
};

export const getAdminAllTrades = async () => {
  const res = await adminFetch("/admin/trades");
  return handleResponse(res);
};

export const getAdminExtractionLogs = async () => {
  const res = await adminFetch("/admin/trades/logs");
  return handleResponse(res);
};

export const getAdminFeedback = async () => {
  const res = await adminFetch("/admin/feedback");
  return handleResponse(res);
};

export const updateAdminFeedbackStatus = async (id, updateData) => {
  const res = await adminFetch(`/admin/feedback/${id}`, {
    method: "PATCH",
    body: JSON.stringify(updateData),
  });
  return handleResponse(res);
};

export const deleteAdminFeedback = async (id) => {
  const res = await adminFetch(`/admin/feedback/${id}`, { method: "DELETE" });
  return handleResponse(res);
};

export const getAdminNotifications = async () => {
  const res = await adminFetch("/admin/notifications");
  return handleResponse(res);
};

export const markAdminNotificationAsRead = async (id) => {
  const res = await adminFetch(`/admin/notifications/${id}/read`, { method: "PATCH" });
  return handleResponse(res);
};

export const markAllAdminNotificationsAsRead = async () => {
  const res = await adminFetch("/admin/notifications/read-all", { method: "POST" });
  return handleResponse(res);
};

export const sendAdminCustomNotification = async (payload) => {
  const res = await adminFetch("/admin/notifications/custom", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
};
