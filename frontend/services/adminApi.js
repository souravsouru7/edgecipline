import { API_URL as BASE_URL } from "@/config/api";

export const clearAdminSession = () => {
  if (typeof window === "undefined") return;
  localStorage.removeItem("adminToken");
  localStorage.removeItem("adminRole");
  localStorage.removeItem("adminName");
};

const handleResponse = async (res) => {
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) {
      clearAdminSession();
    }
    throw new Error(data.message || `Request failed with status ${res.status}`);
  }
  return res.json();
};

/**
 * Admin Login
 * POST /api/admin/auth/login
 */
export const adminLogin = async ({ email, password }) => {
  const res = await fetch(`${BASE_URL}/admin/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email, password })
  });

  return handleResponse(res);
};

/**
 * Get Admin Profile
 * GET /api/admin/auth/me
 */
export const getAdminProfile = async () => {
  const token = typeof window !== "undefined" ? localStorage.getItem("adminToken") : null;

  const res = await fetch(`${BASE_URL}/admin/auth/me`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });

  return handleResponse(res);
};

export const getAdminStats = async () => {
  const token = typeof window !== "undefined" ? localStorage.getItem("adminToken") : null;
  const res = await fetch(`${BASE_URL}/admin/analytics/stats`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });
  return handleResponse(res);
};

export const getAdminGrowth = async () => {
  const token = typeof window !== "undefined" ? localStorage.getItem("adminToken") : null;
  const res = await fetch(`${BASE_URL}/admin/analytics/growth`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });
  return handleResponse(res);
};

export const getAllAdminUsers = async () => {
  const token = typeof window !== "undefined" ? localStorage.getItem("adminToken") : null;
  const res = await fetch(`${BASE_URL}/admin/users`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });
  return handleResponse(res);
};

export const deleteAdminUser = async (id) => {
  const token = typeof window !== "undefined" ? localStorage.getItem("adminToken") : null;
  const res = await fetch(`${BASE_URL}/admin/users/${id}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });
  return handleResponse(res);
};

export const toggleAdminUserStatus = async (id) => {
  const token = typeof window !== "undefined" ? localStorage.getItem("adminToken") : null;
  const res = await fetch(`${BASE_URL}/admin/users/${id}/status`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });
  return handleResponse(res);
};

export const extendAdminUserPlan = async (id, days) => {
  const token = typeof window !== "undefined" ? localStorage.getItem("adminToken") : null;
  const res = await fetch(`${BASE_URL}/admin/users/${id}/extend`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({ days })
  });
  return handleResponse(res);
};

export const getAdminPayments = async () => {
  const token = typeof window !== "undefined" ? localStorage.getItem("adminToken") : null;
  const res = await fetch(`${BASE_URL}/admin/payments`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });
  return handleResponse(res);
};

export const updateAdminPaymentStatus = async (id, status) => {
  const token = typeof window !== "undefined" ? localStorage.getItem("adminToken") : null;
  const res = await fetch(`${BASE_URL}/admin/payments/${id}/status`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({ status })
  });
  return handleResponse(res);
};

export const addManualPayment = async (paymentData) => {
  const token = typeof window !== "undefined" ? localStorage.getItem("adminToken") : null;
  const res = await fetch(`${BASE_URL}/admin/payments/manual`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(paymentData)
  });
  return handleResponse(res);
};

export const getExpiredAdminUsers = async () => {
  const token = typeof window !== "undefined" ? localStorage.getItem("adminToken") : null;
  const res = await fetch(`${BASE_URL}/admin/users/expired`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });
  return handleResponse(res);
};

export const sendAdminRenewalReminder = async (id) => {
  const token = typeof window !== "undefined" ? localStorage.getItem("adminToken") : null;
  const res = await fetch(`${BASE_URL}/admin/users/${id}/remind`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });
  return handleResponse(res);
};

export const getAdminAllTrades = async () => {
  const token = typeof window !== "undefined" ? localStorage.getItem("adminToken") : null;
  const res = await fetch(`${BASE_URL}/admin/trades`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });
  return handleResponse(res);
};

export const getAdminExtractionLogs = async () => {
  const token = typeof window !== "undefined" ? localStorage.getItem("adminToken") : null;
  const res = await fetch(`${BASE_URL}/admin/trades/logs`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });
  return handleResponse(res);
};

export const getAdminFeedback = async () => {
  const token = typeof window !== "undefined" ? localStorage.getItem("adminToken") : null;
  const res = await fetch(`${BASE_URL}/admin/feedback`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });
  return handleResponse(res);
};

export const updateAdminFeedbackStatus = async (id, updateData) => {
  const token = typeof window !== "undefined" ? localStorage.getItem("adminToken") : null;
  const res = await fetch(`${BASE_URL}/admin/feedback/${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(updateData)
  });
  return handleResponse(res);
};

export const deleteAdminFeedback = async (id) => {
  const token = typeof window !== "undefined" ? localStorage.getItem("adminToken") : null;
  const res = await fetch(`${BASE_URL}/admin/feedback/${id}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });
  return handleResponse(res);
};

// --- Notifications ---

export const getAdminNotifications = async () => {
  const token = typeof window !== "undefined" ? localStorage.getItem("adminToken") : null;
  const res = await fetch(`${BASE_URL}/admin/notifications`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });
  return handleResponse(res);
};

export const markAdminNotificationAsRead = async (id) => {
  const token = typeof window !== "undefined" ? localStorage.getItem("adminToken") : null;
  const res = await fetch(`${BASE_URL}/admin/notifications/${id}/read`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });
  return handleResponse(res);
};

export const markAllAdminNotificationsAsRead = async () => {
  const token = typeof window !== "undefined" ? localStorage.getItem("adminToken") : null;
  const res = await fetch(`${BASE_URL}/admin/notifications/read-all`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });
  return handleResponse(res);
};

export const sendAdminCustomNotification = async (payload) => {
  const token = typeof window !== "undefined" ? localStorage.getItem("adminToken") : null;
  const res = await fetch(`${BASE_URL}/admin/notifications/custom`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(payload)
  });
  return handleResponse(res);
};





