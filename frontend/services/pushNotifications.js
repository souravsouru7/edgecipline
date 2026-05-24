"use client";

import { registerDeviceToken } from "@/services/notificationApi";
import { Capacitor } from "@capacitor/core";

let initialized = false;

function isNativeCapacitorRuntime() {
  return typeof window !== "undefined" && Capacitor.isNativePlatform();
}

// ─── Deep-link router ─────────────────────────────────────────────────────────
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
  window.dispatchEvent(
    new CustomEvent("edgecipline:notification-route", { detail: { target } })
  );
}

// ─── 5 premium notification channels ─────────────────────────────────────────
// Must match TYPE_CHANNEL map in backend/services/notificationService.js
const NOTIFICATION_CHANNELS = [
  {
    id:          "edgecipline_risk",
    name:        "Risk Alerts",
    description: "Revenge trading, overtrading, and daily loss warnings",
    importance:  5,          // IMPORTANCE_HIGH
    visibility:  1,          // VISIBILITY_PUBLIC — shown on lock screen
    sound:       "default",
    lights:      true,
    vibration:   true,
    lightColor:  "#E53935",  // red
  },
  {
    id:          "edgecipline_discipline",
    name:        "Discipline Alerts",
    description: "Setup checklist, mood risk, and trade quality warnings",
    importance:  4,          // IMPORTANCE_DEFAULT
    visibility:  0,          // VISIBILITY_PRIVATE
    sound:       "default",
    lights:      true,
    vibration:   true,
    lightColor:  "#F59E0B",  // amber
  },
  {
    id:          "edgecipline_insights",
    name:        "Performance Insights",
    description: "Repeated mistakes, weekly summaries, and improvement tips",
    importance:  3,          // IMPORTANCE_LOW
    visibility:  0,
    sound:       null,
    lights:      true,
    vibration:   false,
    lightColor:  "#0D9E6E",  // green
  },
  {
    id:          "edgecipline_coaching",
    name:        "Coaching",
    description: "Confidence and discipline reinforcement messages",
    importance:  3,
    visibility:  0,
    sound:       null,
    lights:      false,
    vibration:   false,
    lightColor:  "#3B82F6",  // blue
  },
  {
    id:          "edgecipline_session",
    name:        "Session Reminders",
    description: "London, New York, and Asian session start reminders",
    importance:  4,
    visibility:  1,
    sound:       "default",
    lights:      true,
    vibration:   true,
    lightColor:  "#8B5CF6",  // purple
  },
];

async function createAllChannels(PushNotifications) {
  await Promise.allSettled(
    NOTIFICATION_CHANNELS.map((ch) =>
      PushNotifications.createChannel({
        id:          ch.id,
        name:        ch.name,
        description: ch.description,
        importance:  ch.importance,
        visibility:  ch.visibility,
        sound:       ch.sound,
        lights:      ch.lights,
        vibration:   ch.vibration,
        lightColor:  ch.lightColor,
      }).catch((err) => console.warn(`Channel "${ch.id}" setup skipped:`, err))
    )
  );
}

// ─── Main initializer ─────────────────────────────────────────────────────────
export async function initializePushNotifications() {
  if (initialized || !isNativeCapacitorRuntime()) return;

  const authToken = typeof window !== "undefined" && window.localStorage.getItem("token");
  if (!authToken) return;

  initialized = true;

  const { PushNotifications } = await import("@capacitor/push-notifications");

  const permission = await PushNotifications.requestPermissions();
  if (permission.receive !== "granted") {
    initialized = false;
    return;
  }

  // Create all 5 channels before registering so every incoming notification
  // is routed to the correct channel immediately.
  await createAllChannels(PushNotifications);

  PushNotifications.addListener("registration", async ({ value }) => {
    try {
      await registerDeviceToken({ token: value, platform: "android", appVersion: "1.0" });
    } catch (error) {
      console.error("Failed to register push token", error);
    }
  });

  PushNotifications.addListener("registrationError", (error) => {
    console.error("Push registration failed", error);
    initialized = false;
  });

  PushNotifications.addListener("pushNotificationReceived", (notification) => {
    // Dispatch to any in-app listener (e.g. notification bell)
    window.dispatchEvent(
      new CustomEvent("edgecipline:push", { detail: notification })
    );
  });

  PushNotifications.addListener("pushNotificationActionPerformed", ({ notification }) => {
    routeFromNotification(notification?.data || {});
  });

  await PushNotifications.register();
}
