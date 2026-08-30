


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

// Permanently deletes the account and every piece of data attached to it.
// Irreversible — there is no undo and no grace period. `confirmEmail` must
// match the signed-in user's address exactly; the server rejects the request
// otherwise, so this cannot be triggered by a stray call.
// Needs far more than the 10s default: the server purges ~24 collections, drops
// the Firebase identity and destroys every uploaded image before it answers. A
// measured run took 9.7s while aborting partway, so the default was close enough
// to the real cost that the client would give up on a deletion the server went
// on to finish — showing an error for work that actually succeeded, with no way
// for the user to tell. On this path a slow success beats a fast lie.
export const deleteMyAccount = async (confirmEmail) => {
  return await apiClient.delete('/auth/account', {
    data: { confirmEmail },
    timeout: 60000,
  });
};

export const submitFeedback = async (data) => {
  const isFormData = data instanceof FormData;
  // If FormData, we don't need to wrap it in a string and we shouldn't explicitly set Content-Type.
  return await apiClient.post(`/feedback`, data, isFormData ? {
    headers: { 'Content-Type': 'multipart/form-data' }
  } : undefined);
};

// Payment APIs
export const createPaymentOrder = async (planType, couponCode) => {
  const body = planType ? { planType } : {};
  if (couponCode) body.couponCode = couponCode;
  return await apiClient.post(`/payments/order`, body);
};

export const validateCoupon = async (code, planType) => {
  return await apiClient.post(`/promotions/coupons/validate`, { code, planType });
};

export const recordPromoTouch = async (data) => {
  try {
    return await apiClient.post(`/promotions/touch`, data || {});
  } catch {
    return null;
  }
};

export const verifyPayment = async (data) => {
  return await apiClient.post(`/payments/verify`, data);
};

// ─── Google Play billing (Android only) ────────────────────────────────────
// The web app never calls these; the Android app never calls the Razorpay pair
// above. Both end up at the same entitlement — see GET /trial/status.

/** Product/base-plan ids to query from Play, plus this account's binding id. */
export const getGooglePlayConfig = async () => {
  return await apiClient.get(`/payments/google-play/config`);
};

/**
 * Exchange a Play purchase token for a verified entitlement.
 * The token is all the server needs — it re-reads everything else from Google.
 */
export const verifyGooglePlayPurchase = async ({ purchaseToken, productId }) => {
  return await apiClient.post(`/payments/google-play/verify`, { purchaseToken, productId });
};

/** Re-verify every purchase the device holds. Safe to call repeatedly. */
export const restoreGooglePlayPurchases = async (purchaseTokens) => {
  return await apiClient.post(`/payments/google-play/restore`, { purchaseTokens });
};

/** Renewal date / auto-renew detail for the "Manage subscription" screen. */
export const getGooglePlaySubscription = async () => {
  return await apiClient.get(`/payments/google-play/subscription`);
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
