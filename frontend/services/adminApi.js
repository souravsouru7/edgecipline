import { API_URL as BASE_URL } from "@/config/api";

const ADMIN_TOKEN_KEY = "admin_token";
const LEGACY_ADMIN_TOKEN_KEY = "adminToken";
const ADMIN_ROLE_KEY = "adminRole";

const getAdminToken = () => {
  if (typeof window === "undefined") return null;
  return (
    sessionStorage.getItem(ADMIN_TOKEN_KEY) ||
    sessionStorage.getItem(LEGACY_ADMIN_TOKEN_KEY) ||
    localStorage.getItem(ADMIN_TOKEN_KEY) ||
    localStorage.getItem(LEGACY_ADMIN_TOKEN_KEY)
  );
};

/** True when a Bearer token is stored (required for cross-origin admin UI). */
export const hasAdminSession = () => Boolean(getAdminToken());

const setAdminToken = (token) => {
  if (typeof window === "undefined") return;
  if (!token) return;

  sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
  sessionStorage.setItem(LEGACY_ADMIN_TOKEN_KEY, token);
  localStorage.setItem(ADMIN_TOKEN_KEY, token);
  localStorage.setItem(LEGACY_ADMIN_TOKEN_KEY, token);
  localStorage.setItem(ADMIN_ROLE_KEY, "admin");
};

const clearStoredAdminSession = (requestToken = null) => {
  if (typeof window === "undefined") return;

  const currentToken = getAdminToken();
  // Only skip clearing when a different session's token was rejected.
  if (requestToken && currentToken && currentToken !== requestToken) {
    return;
  }

  sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  sessionStorage.removeItem(LEGACY_ADMIN_TOKEN_KEY);
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  localStorage.removeItem(LEGACY_ADMIN_TOKEN_KEY);
  localStorage.removeItem(ADMIN_ROLE_KEY);
  localStorage.removeItem("adminName");
};

export const clearAdminSession = async () => {
  if (typeof window === "undefined") return;
  clearStoredAdminSession(getAdminToken());
  try {
    await fetch(`${BASE_URL}/admin/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
  } catch {
    // Best-effort
  }
};

const handleResponse = async (res) => {
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) {
      clearStoredAdminSession(res.adminRequestToken || null);
    }
    throw new Error(data.message || `Request failed with status ${res.status}`);
  }
  return res.json();
};

/** Shared fetch wrapper — sends Bearer token if available, falls back to cookie. */
const adminFetch = (url, options = {}) => {
  const token = getAdminToken();
  const authHeader = token ? { Authorization: `Bearer ${token}` } : {};
  return fetch(`${BASE_URL}${url}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...authHeader,
      ...(options.headers || {}),
    },
  }).then((res) => {
    res.adminRequestToken = token;
    return res;
  });
};

/**
 * Admin Login
 * POST /api/admin/auth/login
 * Stores the returned JWT in sessionStorage for subsequent requests.
 */
export const adminLogin = async ({ email, password }) => {
  const res = await adminFetch("/admin/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  const data = await handleResponse(res);
  if (data?.token && typeof window !== "undefined") {
    setAdminToken(data.token);
  }
  return data;
};

/**
 * Get Admin Profile
 * GET /api/admin/auth/me
 */
export const getAdminProfile = async () => {
  if (!getAdminToken()) {
    throw new Error("No admin session");
  }
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
