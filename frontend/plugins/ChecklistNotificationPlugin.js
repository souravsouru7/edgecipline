"use client";

import { registerPlugin } from "@capacitor/core";
import { isAndroidNative } from "@/utils/platform";

// ChecklistNotification is an ANDROID-ONLY plugin. Its implementation is
// ChecklistNotificationPlugin.java plus the alarm/worker/receiver classes around
// it; there is no Swift counterpart, so iOS has nothing to call.
//
// This used to gate on Capacitor.isNativePlatform(), which is true on iOS too —
// so on iOS every function below returned the real bridge proxy and rejected
// with "ChecklistNotification plugin is not implemented on ios".
//
// The gate is isAndroidNative(). Everywhere else — iOS, web, SSR — gets the
// fallback below, which reports "not supported" instead of throwing.

const UnsupportedFallback = {
  configure: async () => ({ supported: false }),
  syncItems: async () => ({ supported: false }),
  cancel: async () => ({ supported: false }),
  getState: async () => ({ supported: false, enabled: false, items: [] }),
  // `granted: false` with `supported: false`: nothing was granted because there
  // is no permission to grant here. Callers must gate on the platform rather
  // than read this as a denial — see notification-settings/page.js.
  requestPermission: async () => ({ supported: false, granted: false }),
  addListener: () => ({ remove: () => {} }),
};

let _plugin = null;

function getPlugin() {
  if (_plugin) return _plugin;
  if (!isAndroidNative()) return UnsupportedFallback;

  try {
    _plugin = registerPlugin("ChecklistNotification", {
      web: () => Promise.resolve(UnsupportedFallback),
    });
    return _plugin;
  } catch {
    return UnsupportedFallback;
  }
}

// The wrappers below stay thin on purpose. Off Android they resolve through
// UnsupportedFallback, so an unsupported platform is a value and never an
// exception. On Android they do NOT catch: a real scheduling failure must still
// reach the caller, because the settings screen has to know the notification was
// not actually set. Unsupported platform ≠ failed operation.

/**
 * Request POST_NOTIFICATIONS permission (Android 13+). Android only.
 * Call this before configureChecklistNotification.
 *
 * Off Android this resolves { supported: false, granted: false } without
 * touching the bridge. Do not read that as a denial — check the platform first.
 *
 * @returns {{ supported?: boolean, granted: boolean }}
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
export async function syncChecklistItems(items, market = "Forex") {
  return getPlugin().syncItems({ items, market });
}

/** Cancel the notification and remove all scheduled jobs for the given market. */
export async function cancelChecklistNotification(market = "Forex") {
  return getPlugin().cancel({ market });
}

/**
 * Read current state from SharedPreferences.
 * @returns {{ supported?: boolean, enabled: boolean, items: {id,label,checked}[] }}
 */
export async function getChecklistNotificationState(market = "Forex") {
  return getPlugin().getState({ market });
}

/**
 * Listen for item toggles made inside the notification (app foregrounded).
 * @returns {{ remove(): void }}
 */
export function addChecklistToggleListener(handler) {
  // Synchronous, so it cannot be routed through callPlugin. A page mounting on
  // iOS must not have its effect throw on the way in.
  try {
    return getPlugin().addListener("checklistItemToggled", handler);
  } catch {
    return { remove: () => {} };
  }
}
