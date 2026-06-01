"use client";

import { registerPlugin } from "@capacitor/core";

const WebFallback = {
  configure: async () => {},
  syncItems: async () => {},
  cancel: async () => {},
  getState: async () => ({ enabled: false, items: [] }),
  requestPermission: async () => ({ granted: true }),
  addListener: () => ({ remove: () => {} }),
};

let _plugin = null;

function getPlugin() {
  if (_plugin) return _plugin;
  if (typeof window === "undefined") return WebFallback;

  try {
    const { Capacitor } = require("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return WebFallback;

    _plugin = registerPlugin("ChecklistNotification", {
      web: () => Promise.resolve(WebFallback),
    });
    return _plugin;
  } catch {
    return WebFallback;
  }
}

/**
 * Request POST_NOTIFICATIONS permission (Android 13+).
 * Call this before configureChecklistNotification.
 * @returns {{ granted: boolean }}
 */
export async function requestChecklistNotificationPermission() {
  return getPlugin().requestPermission();
}

/**
 * Configure, show immediately, and schedule the daily checklist notification.
 * The notification appears right away AND fires daily at notificationTime.
 */
export async function configureChecklistNotification(config) {
  return getPlugin().configure(config);
}

/**
 * Push the latest checked-state of items to the live notification.
 * Call whenever the user checks/unchecks a rule inside the app.
 */
export async function syncChecklistItems(items) {
  return getPlugin().syncItems({ items });
}

/** Cancel the notification and remove all scheduled jobs. */
export async function cancelChecklistNotification() {
  return getPlugin().cancel();
}

/**
 * Read current state from SharedPreferences.
 * @returns {{ enabled: boolean, items: {id,label,checked}[] }}
 */
export async function getChecklistNotificationState() {
  return getPlugin().getState();
}

/**
 * Listen for item toggles made inside the notification (app foregrounded).
 * @returns {{ remove(): void }}
 */
export function addChecklistToggleListener(handler) {
  return getPlugin().addListener("checklistItemToggled", handler);
}
