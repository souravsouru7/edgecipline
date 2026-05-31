"use client";

import { registerPlugin } from "@capacitor/core";

/**
 * JS bridge to the native Android ChecklistNotificationPlugin.
 *
 * On non-native platforms (web/desktop) all methods are no-ops so the
 * checklist page renders without errors in the Next.js dev server.
 */

const WebFallback = {
  configure: async () => {},
  syncItems: async () => {},
  cancel: async () => {},
  getState: async () => ({ enabled: false, items: [] }),
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
 * Configure and schedule the checklist notification.
 * Call this whenever the user saves their settings.
 *
 * @param {object} config
 * @param {boolean} config.enabled
 * @param {string}  config.notificationTime  "HH:mm"
 * @param {string}  config.repeatMode        "daily"|"weekdays"|"custom"
 * @param {number[]}config.customDays        [1..7], 1=Mon 7=Sun
 * @param {boolean} config.persistent
 * @param {boolean} config.resetEnabled
 * @param {string}  config.resetTime         "HH:mm"
 * @param {string}  config.strategyName
 * @param {{id:string, label:string}[]} config.items  max 8
 */
export async function configureChecklistNotification(config) {
  return getPlugin().configure(config);
}

/**
 * Push the latest checked-state of items to the live notification.
 * Call this whenever the user checks/unchecks a rule inside the app.
 *
 * @param {{id:string, label:string, checked:boolean}[]} items
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
 * Listen for item toggles that happen directly inside the notification
 * (while the app is foregrounded).
 *
 * @param {function({ itemId: string, checked: boolean }): void} handler
 * @returns {{ remove(): void }}
 */
export function addChecklistToggleListener(handler) {
  return getPlugin().addListener("checklistItemToggled", handler);
}
