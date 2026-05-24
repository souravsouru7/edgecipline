import apiClient from "@/services/apiClient";

export const registerDeviceToken = (payload) => {
  return apiClient.post("/profile/device-tokens", payload);
};

export const unregisterDeviceToken = (token) => {
  return apiClient.delete("/profile/device-tokens", { data: { token } });
};

export const getNotifications = ({ limit = 50, unreadOnly = false } = {}) => {
  return apiClient.get("/notifications", { params: { limit, unreadOnly } });
};

export const markNotificationAsRead = (id) => {
  return apiClient.patch(`/notifications/${id}/read`);
};

export const markAllNotificationsAsRead = () => {
  return apiClient.patch("/notifications/read-all");
};

export const getNotificationPreferences = () => {
  return apiClient.get("/profile/notification-preferences");
};

export const updateNotificationPreferences = (payload) => {
  return apiClient.patch("/profile/notification-preferences", payload);
};
