"use client";

import {
  registerDeviceToken,
  unregisterDeviceToken,
  trackNotificationDelivered,
  trackNotificationAction,
} from "@/services/notificationApi";
import { Capacitor } from "@capacitor/core";
import { getValidToken, hasValidAuthToken, hydrateAuthToken } from "@/utils/auth";
import { silentRefresh } from "@/services/apiClient";

// ─── Structured logging ───────────────────────────────────────────────────────
// All FCM lifecycle events go through this. Use grep on FCM_ prefix in
// production to trace any device's registration history.
const logger = {
  info:  (event, meta) => console.info(event, meta || {}),
  warn:  (event, meta) => console.warn(event, meta || {}),
  error: (event, meta) => console.error(event, meta || {}),
};

const STORAGE_KEYS = {
  token: "edgecipline:fcmToken",
  pending: "edgecipline:pendingPushRegistration",
  backendRegistered: "edgecipline:pushBackendRegistered",
  retryCount: "edgecipline:pushRetryCount",
  lastAttempt: "edgecipline:pushLastAttempt",
  registeredForUser: "edgecipline:pushRegisteredForUser",
  lastRegisteredAt: "edgecipline:pushLastRegisteredAt",
};

// True exponential backoff: 2, 4, 8, 16, 32 seconds. Max 5 attempts.
const RETRY_DELAYS_MS = [2000, 4000, 8000, 16000, 32000];
const MAX_REGISTRATION_ATTEMPTS = RETRY_DELAYS_MS.length;
const REGISTRATION_HEARTBEAT_MS = 7 * 24 * 60 * 60 * 1000;

// ─── Module state ────────────────────────────────────────────────────────────
let channelSetupPromise = null;
let channelsCreated = false;
let pluginInitialized = false;
let pluginInitPromise = null;
let listenerHandles = [];
let permissionGranted = false;
let appStateListenerRegistered = false;
let registrationPromise = null;
let lastFcmToken = null;
let pushNotificationsPlugin = null;

function isNativeCapacitorRuntime() {
  return typeof window !== "undefined" && Capacitor.isNativePlatform();
}

function storageGet(key, fallback = null) {
  if (typeof window === "undefined") return fallback;
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function storageSet(key, value) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(key, String(value)); } catch { /* ignore */ }
}
function storageRemove(key) {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}
function storageBool(key) { return storageGet(key, "false") === "true"; }

function setPendingRegistration(pending) { storageSet(STORAGE_KEYS.pending, pending ? "true" : "false"); }
function setBackendRegistered(registered) { storageSet(STORAGE_KEYS.backendRegistered, registered ? "true" : "false"); }
function setRetryCount(count) { storageSet(STORAGE_KEYS.retryCount, String(count)); }

function rememberFcmToken(token) {
  if (!token) return;
  lastFcmToken = token;
  storageSet(STORAGE_KEYS.token, token);
}
function getStoredFcmToken() { return lastFcmToken || storageGet(STORAGE_KEYS.token, ""); }
function getDeviceId() {
  let deviceId = storageGet("edgecipline:device-id", "");
  if (!deviceId) {
    deviceId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    storageSet("edgecipline:device-id", deviceId);
  }
  return deviceId;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Read auth, and if missing, give silentRefresh ONE chance to revive it.
async function getAuthTokenOrRefreshOnce() {
  let token = getValidToken() || await hydrateAuthToken();
  if (token) return token;
  try {
    token = await silentRefresh();
  } catch {
    // silentRefresh handles its own logout side-effects; we only care
    // whether we ended up with a usable token afterwards.
  }
  return token || null;
}

// ─── Deep-link router ────────────────────────────────────────────────────────
export function getNotificationTarget(data = {}) {
  if (data.deepLink) return data.deepLink;
  const routes = {
    "trade":             `/trades/view?id=${data.tradeId || ""}`,
    "trade-edit":        `/trades/edit?id=${data.tradeId || ""}`,
    "indian-trade":      `/indian-market/trades/view?id=${data.tradeId || ""}`,
    "indian-trade-edit": `/indian-market/trades/edit?id=${data.tradeId || ""}`,
    "indian-trades":     "/indian-market/trades",
    "trades":            "/trades",
    "weekly-report":     `/weekly-reports?id=${data.reportId || ""}`,
    "analytics":         "/analytics",
    "psychology":        "/checklist/psychology",
    "notifications":     "/notifications",
  };
  return routes[data.screen] || "/dashboard";
}
function routeFromNotification(data = {}) {
  const target = getNotificationTarget(data);
  window.dispatchEvent(new CustomEvent("edgecipline:notification-route", { detail: { target } }));
}

// ─── Notification channels (must always be created) ──────────────────────────
const NOTIFICATION_CHANNELS = [
  { id: "edgecipline_risk",       name: "Risk Alerts",          description: "Revenge trading, overtrading, and daily loss warnings", importance: 5, visibility: 1, sound: "default", lights: true,  vibration: true,  lightColor: "#E53935" },
  { id: "edgecipline_discipline", name: "Discipline Alerts",    description: "Setup checklist, mood risk, and trade quality warnings", importance: 4, visibility: 0, sound: "default", lights: true,  vibration: true,  lightColor: "#F59E0B" },
  { id: "edgecipline_insights",   name: "Performance Insights", description: "Repeated mistakes, weekly summaries, and improvement tips", importance: 3, visibility: 0, sound: null,      lights: true,  vibration: false, lightColor: "#0D9E6E" },
  { id: "edgecipline_coaching",   name: "Coaching",             description: "Confidence and discipline reinforcement messages", importance: 3, visibility: 0, sound: null,      lights: false, vibration: false, lightColor: "#3B82F6" },
  { id: "edgecipline_session",    name: "Session Reminders",    description: "London, New York, and Asian session start reminders", importance: 4, visibility: 1, sound: "default", lights: true,  vibration: true,  lightColor: "#8B5CF6" },
  { id: "edgecipline_checklist",  name: "Pre-Trade Checklist",  description: "Daily interactive checklist in the notification shade", importance: 5, visibility: 1, sound: "default", lights: true,  vibration: true,  lightColor: "#0D9E6E" },
  { id: "edgecipline_ocr",        name: "OCR Results",          description: "Trade screenshot processing completion and failure alerts", importance: 4, visibility: 0, sound: "default", lights: true, vibration: true, lightColor: "#0EA5E9" },
  { id: "edgecipline_support",    name: "Support",              description: "Replies and status updates on your support tickets", importance: 4, visibility: 0, sound: "default", lights: true, vibration: true, lightColor: "#B8860B" },
];

// Channels are independent of auth, permission, and registration. They must
// be created on every cold start so notifications display correctly even
// before login or before the user grants permission.
export async function ensureChannelsCreated() {
  if (!isNativeCapacitorRuntime()) return false;
  if (channelsCreated) return true;
  if (channelSetupPromise) return channelSetupPromise;

  channelSetupPromise = (async () => {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    pushNotificationsPlugin = pushNotificationsPlugin || PushNotifications;

    const results = await Promise.allSettled(
      NOTIFICATION_CHANNELS.map((ch) => PushNotifications.createChannel(ch))
    );

    const detail = NOTIFICATION_CHANNELS.map((ch, i) => ({
      id: ch.id,
      success: results[i].status === "fulfilled",
      error: results[i].status === "rejected"
        ? (results[i].reason?.message || String(results[i].reason))
        : null,
    }));

    channelsCreated = detail.every((c) => c.success);

    if (channelsCreated) {
      logger.info("FCM_CHANNEL_CREATED", { count: detail.length });
    } else {
      logger.error("FCM_CHANNEL_CREATION_FAILED", {
        failed: detail.filter((c) => !c.success),
      });
    }
    return channelsCreated;
  })().finally(() => { channelSetupPromise = null; });

  return channelSetupPromise;
}

// ─── Backend registration ────────────────────────────────────────────────────
export async function registerDeviceTokenWithRetry(token, options = {}) {
  if (!token || !isNativeCapacitorRuntime()) return false;
  if (registrationPromise && !options.force) return registrationPromise;

  registrationPromise = (async () => {
    rememberFcmToken(token);
    setPendingRegistration(true);
    setBackendRegistered(false);

    for (let index = 0; index < MAX_REGISTRATION_ATTEMPTS; index += 1) {
      const attempt = index + 1;
      const delay = RETRY_DELAYS_MS[index];

      // Always wait first — exponential backoff applies on attempt #1 too,
      // giving auth hydration time to complete during cold start.
      await sleep(delay);

      const authToken = await getAuthTokenOrRefreshOnce();
      const hasAuth = Boolean(authToken);
      storageSet(STORAGE_KEYS.lastAttempt, new Date().toISOString());
      setRetryCount(attempt);

      if (!hasAuth) {
        logger.warn("FCM_TOKEN_RETRY", { attempt, reason: "auth_unavailable", delayMs: delay });
        continue;
      }

      try {
        await registerDeviceToken({
          token,
          platform: "android",
          appVersion: process.env.NEXT_PUBLIC_APP_VERSION || "1.0",
          deviceId: getDeviceId(),
        });
        setPendingRegistration(false);
        setBackendRegistered(true);
        storageSet(STORAGE_KEYS.lastRegisteredAt, new Date().toISOString());
        setRetryCount(0);
        logger.info("FCM_TOKEN_REGISTERED", { attempt });
        return true;
      } catch (error) {
        logger.error("FCM_TOKEN_REGISTER_FAILED", {
          attempt,
          error: error?.message || String(error),
          status: error?.status || error?.response?.status,
        });
      }
    }

    setPendingRegistration(true);
    setBackendRegistered(false);
    logger.error("FCM_TOKEN_RETRY", { exhausted: true, attempts: MAX_REGISTRATION_ATTEMPTS });
    return false;
  })().finally(() => { registrationPromise = null; });

  return registrationPromise;
}

export async function ensurePushRegistration() {
  if (!isNativeCapacitorRuntime()) return false;

  // Channels are always safe to (re)create — independent of auth/permission.
  await ensureChannelsCreated();

  await initializePushNotifications();

  // Re-check permission on every call. The user may have toggled it via
  // Android Settings since the app last asked.
  await refreshPermissionState();
  if (!permissionGranted) return false;

  const token = getStoredFcmToken();
  if (!token) {
    if (pushNotificationsPlugin?.register) {
      try {
        await pushNotificationsPlugin.register();
      } catch (error) {
        logger.error("FCM_TOKEN_REGISTER_FAILED", { phase: "fcm_register", error: error?.message });
      }
    }
    return false;
  }

  const lastRegisteredAt = Date.parse(storageGet(STORAGE_KEYS.lastRegisteredAt, ""));
  const heartbeatFresh = Number.isFinite(lastRegisteredAt)
    && Date.now() - lastRegisteredAt < REGISTRATION_HEARTBEAT_MS;
  if (storageBool(STORAGE_KEYS.backendRegistered)
      && !storageBool(STORAGE_KEYS.pending)
      && heartbeatFresh) {
    return true;
  }

  return registerDeviceTokenWithRetry(token, { force: true });
}

// ─── Permission state ────────────────────────────────────────────────────────
async function refreshPermissionState() {
  if (!pushNotificationsPlugin?.checkPermissions) return permissionGranted;
  try {
    const status = await pushNotificationsPlugin.checkPermissions();
    permissionGranted = status?.receive === "granted";
  } catch {
    // Keep last known value if checkPermissions throws.
  }
  return permissionGranted;
}

// ─── Auth resume warming (kept from prior fix) ───────────────────────────────
let lastAuthWarmAt = 0;
const AUTH_WARM_THROTTLE_MS = 5_000;

async function warmAuthOnResume() {
  const now = Date.now();
  if (now - lastAuthWarmAt < AUTH_WARM_THROTTLE_MS) return;
  lastAuthWarmAt = now;
  try {
    await hydrateAuthToken();
    if (hasValidAuthToken()) return;
    await silentRefresh();
  } catch (error) {
    logger.warn("FCM_APP_RESUME_RECOVERY", { phase: "auth_warm", error: error?.message });
  }
}

function registerAppResumeRecovery() {
  if (appStateListenerRegistered || typeof window === "undefined") return;
  appStateListenerRegistered = true;

  const recover = async () => {
    logger.info("FCM_APP_RESUME_RECOVERY", { trigger: "resume" });
    await warmAuthOnResume();
    // Re-check permission after resume — user may have changed it in Settings.
    await refreshPermissionState();
    ensurePushRegistration().catch((error) => {
      logger.error("FCM_APP_RESUME_RECOVERY", { phase: "ensure", error: error?.message });
    });
  };

  const appPlugin = Capacitor.Plugins?.App;
  if (appPlugin?.addListener) {
    appPlugin
      .addListener("appStateChange", ({ isActive }) => { if (isActive === true) recover(); })
      .then((handle) => listenerHandles.push(handle))
      .catch?.(() => {});
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") recover();
  });
  window.addEventListener("focus", recover);
}

// ─── Diagnostics ─────────────────────────────────────────────────────────────
export function getPushDiagnostics() {
  return {
    pluginInitialized,
    permissionGranted,
    channelsCreated,
    fcmTokenPresent: Boolean(getStoredFcmToken()),
    backendRegistered: storageBool(STORAGE_KEYS.backendRegistered),
    pendingRegistration: storageBool(STORAGE_KEYS.pending),
    retryCount: Number(storageGet(STORAGE_KEYS.retryCount, "0")) || 0,
    lastAttempt: storageGet(STORAGE_KEYS.lastAttempt, null),
    lastRegisteredAt: storageGet(STORAGE_KEYS.lastRegisteredAt, null),
    registeredForUser: storageGet(STORAGE_KEYS.registeredForUser, null),
  };
}

// ─── Lifecycle hooks for login / logout ──────────────────────────────────────
//
// These MUST be called by useLogin / logout flows so the FCM state machine
// knows the authenticated identity has changed. Without these, the
// backendRegistered flag carries over from the previous user.
export async function onUserLoggedIn(userId) {
  if (!isNativeCapacitorRuntime()) return;
  const prevUser = storageGet(STORAGE_KEYS.registeredForUser, null);
  if (prevUser && userId && prevUser !== String(userId)) {
    // Different user on same device — wipe the registered-for marker so
    // ensurePushRegistration forces a fresh backend register for this user.
    setBackendRegistered(false);
    setPendingRegistration(true);
  }
  if (userId) storageSet(STORAGE_KEYS.registeredForUser, String(userId));

  await ensureChannelsCreated();
  await initializePushNotifications();
  await ensurePushRegistration();
}

export async function onUserLoggedOut() {
  if (!isNativeCapacitorRuntime()) return;
  const token = getStoredFcmToken();
  // Tell backend to disable this token for the logged-out user. Best-effort —
  // if it fails (offline), the 90-day TTL handles cleanup.
  if (token) {
    try { await unregisterDeviceToken(token); } catch { /* offline-tolerant */ }
  }
  storageRemove(STORAGE_KEYS.registeredForUser);
  setBackendRegistered(false);
  setPendingRegistration(false);
  // Keep the FCM token in storage — Firebase will reuse it on next login
  // so we don't need to re-request from Google Play Services.
}

// ─── Token rotation ──────────────────────────────────────────────────────────
async function handleTokenRotation(newToken) {
  const oldToken = getStoredFcmToken();
  if (oldToken && oldToken !== newToken) {
    logger.info("FCM_TOKEN_REFRESH", { hasOldToken: true });
    try { await unregisterDeviceToken(oldToken); } catch { /* offline-tolerant */ }
  }
  rememberFcmToken(newToken);
  setPendingRegistration(true);
  setBackendRegistered(false);
}

// ─── Main initializer ────────────────────────────────────────────────────────
export async function initializePushNotifications() {
  if (!isNativeCapacitorRuntime()) return;

  // Channels are independent — make sure they're up before anything else.
  await ensureChannelsCreated();

  if (pluginInitialized) {
    // Re-check permission state (user may have toggled in Settings) and
    // re-trigger any pending registration.
    await refreshPermissionState();
    if (permissionGranted) {
      if (storageBool(STORAGE_KEYS.pending) && getStoredFcmToken()) {
        void registerDeviceTokenWithRetry(getStoredFcmToken(), { force: true });
      }
    }
    return;
  }
  if (pluginInitPromise) return pluginInitPromise;

  logger.info("FCM_INIT_START");

  pluginInitPromise = (async () => {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    pushNotificationsPlugin = PushNotifications;

    registerAppResumeRecovery();

    // Remove any stale handles (handles only exist if we're somehow re-running,
    // which shouldn't happen with the singleton guard, but defence in depth).
    await removeAllListeners();

    // Store listener handles so we can remove them on hot reload / logout.
    listenerHandles.push(
      await PushNotifications.addListener("registration", ({ value }) => {
        logger.info("FCM_TOKEN_GENERATED");
        void (async () => {
          await handleTokenRotation(value);
          await registerDeviceTokenWithRetry(value, { force: true });
        })();
      })
    );

    listenerHandles.push(
      await PushNotifications.addListener("registrationError", (error) => {
        logger.error("FCM_TOKEN_REGISTER_FAILED", {
          phase: "fcm_registration_error",
          error: error?.message || String(error),
        });
        // Do NOT reset pluginInitialized here — that previously caused the
        // entire init to re-run on next call, duplicating listeners (R5/R6).
        // ensurePushRegistration will retry the network step on next resume.
      })
    );

    listenerHandles.push(
      await PushNotifications.addListener("pushNotificationReceived", (notification) => {
        window.dispatchEvent(new CustomEvent("edgecipline:push", { detail: notification }));
        const notificationId = notification?.data?.notificationId;
        if (notificationId) trackNotificationDelivered(notificationId).catch(() => {});
      })
    );

    listenerHandles.push(
      await PushNotifications.addListener("pushNotificationActionPerformed", ({ notification, actionId }) => {
        const data = notification?.data || {};
        routeFromNotification(data);
        const notificationId = data.notificationId;
        if (notificationId) {
          trackNotificationAction(notificationId, actionId || data.screen || "default").catch(() => {});
        }
      })
    );

    // Request permission (no-op if already granted).
    let permission;
    try {
      permission = await PushNotifications.requestPermissions();
    } catch (error) {
      logger.error("FCM_TOKEN_REGISTER_FAILED", { phase: "requestPermissions", error: error?.message });
      pluginInitialized = true; // mark initialized to avoid infinite retry of permission prompt
      return;
    }

    permissionGranted = permission?.receive === "granted";
    if (permissionGranted) {
      logger.info("FCM_PERMISSION_GRANTED");
    } else {
      logger.warn("FCM_PERMISSION_DENIED", { state: permission?.receive });
    }

    pluginInitialized = true;

    if (!permissionGranted) return;

    try {
      await PushNotifications.register();
    } catch (error) {
      logger.error("FCM_TOKEN_REGISTER_FAILED", { phase: "fcm_register", error: error?.message });
    }

    const pendingToken = getStoredFcmToken();
    if (pendingToken && storageBool(STORAGE_KEYS.pending)) {
      void registerDeviceTokenWithRetry(pendingToken, { force: true });
    }
  })().finally(() => { pluginInitPromise = null; });

  return pluginInitPromise;
}

async function removeAllListeners() {
  if (!listenerHandles.length) return;
  for (const handle of listenerHandles) {
    try { await handle?.remove?.(); } catch { /* ignore */ }
  }
  listenerHandles = [];
}
