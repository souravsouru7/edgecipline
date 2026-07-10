

import apiClient from "./apiClient";

let welcomeGuideSeenRequest = null;

export const registerUser = async (data) => {
  return await apiClient.post(`/auth/register`, data);
};

export const loginUser = async (data) => {
  return await apiClient.post(`/auth/login`, data);
};

export const googleLogin = async (idToken) => {
  return await apiClient.post(`/auth/google`, { idToken });
};

// Get basic profile of the logged-in user
export const getProfile = async () => {
  return await apiClient.get(`/auth/me`);
};

export const forgotPassword = async (email) => {
  return await apiClient.post(`/auth/forgot-password`, { email });
};

export const verifyOTP = async (email, otp) => {
  return await apiClient.post(`/auth/verify-otp`, { email, otp });
};

export const resetPassword = async (email, resetToken, password) => {
  return await apiClient.post(`/auth/reset-password`, { email, resetToken, password });
};

export const logoutUser = async () => {
  return await apiClient.post('/auth/logout');
};

export const submitFeedback = async (data) => {
  const isFormData = data instanceof FormData;
  // If FormData, we don't need to wrap it in a string and we shouldn't explicitly set Content-Type.
  return await apiClient.post(`/feedback`, data, isFormData ? {
    headers: { 'Content-Type': 'multipart/form-data' }
  } : undefined);
};

// Payment APIs
export const createPaymentOrder = async () => {
  return await apiClient.post(`/payments/order`);
};

export const verifyPayment = async (data) => {
  return await apiClient.post(`/payments/verify`, data);
};

// Trial & smart-paywall APIs
export const getTrialStatus = async () => {
  return await apiClient.get(`/trial/status`, { skipRateLimitRetry: true });
};

export const getPaywallContext = async () => {
  return await apiClient.get(`/trial/paywall-context`);
};

export const recordTrialEvent = async (event, properties = {}) => {
  try {
    return await apiClient.post(`/trial/event`, { event, properties });
  } catch {
    // Analytics beacons must never break the UI.
    return null;
  }
};

// Subscription rescue funnel
export const getRescueBanner = async () => {
  return await apiClient.get(`/rescue/banner`);
};

export const recordRescueEvent = async (event, touchpoint, properties = {}) => {
  try {
    return await apiClient.post(`/rescue/event`, { event, touchpoint, properties });
  } catch {
    return null;
  }
};

export const testConnection = async () => {
  // Can just ping the server base URL
  return await apiClient.get('/');
};

// ── Onboarding / welcome guide preference ────────────────────────────────────
export const getWelcomeGuideSeen = async () => {
  if (!welcomeGuideSeenRequest) {
    welcomeGuideSeenRequest = apiClient
      .get('/auth/me/preferences', { skipRateLimitRetry: true })
      .finally(() => {
        welcomeGuideSeenRequest = null;
      });
  }

  return await welcomeGuideSeenRequest;
};

export const markWelcomeGuideSeen = async () => {
  return await apiClient.patch(
    '/auth/me/preferences',
    { hasSeenWelcomeGuide: true, isOnboardingCompleted: true },
    { skipRateLimitRetry: true }
  );
};

export const resetOnboarding = async () => {
  return await apiClient.patch(
    '/auth/me/preferences',
    { isOnboardingCompleted: false },
    { skipRateLimitRetry: true }
  );
};

// Mark a single onboarding step as done (welcomeSeen, setupAdded, tradeAdded,
// journalSeen, analyticsSeen, notificationsSeen, tourCompleted, checklistDismissed)
export const markOnboardingStep = async (step, value = true) => {
  return await apiClient.patch(
    '/auth/me/onboarding',
    { step, value },
    { skipRateLimitRetry: true }
  );
};

// Persist the user's preferred market ("Forex" | "Indian_Market") on the
// server so we can restore it on a fresh device / session.
export const setPreferredMarket = async (preferredMarket) => {
  return await apiClient.patch(
    '/auth/me/preferences',
    { preferredMarket },
    { skipRateLimitRetry: true }
  );
};

// ── Terms & Privacy Policy acceptance ────────────────────────────────────────
export const acceptTerms = async () => {
  return await apiClient.post('/auth/accept-terms', undefined, { skipTermsRedirect: true });
};
