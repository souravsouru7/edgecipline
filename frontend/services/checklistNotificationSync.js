"use client";

import { Capacitor } from "@capacitor/core";
import { getChecklistNotificationSettings } from "@/services/checklistNotificationApi";
import {
  configureChecklistNotification,
  
  cancelChecklistNotification,
} from "@/plugins/ChecklistNotificationPlugin";

// The Android notification keeps its own copy of the rules in SharedPreferences,
// written once when the user saves notification settings. Editing a setup used
// to leave that copy untouched, so the notification kept firing with rules the
// user had already changed or deleted. Anything that edits setups calls this
// afterwards to push the current rules back down.

export const MAX_NOTIFICATION_ITEMS = 8;

// Rule subdocuments carry their own _id, which survives an edit now that saves
// update in place. Using it as the item id means a deleted rule takes its tick
// with it, instead of the tick sliding onto whatever rule moved into its slot.
export function ruleItemId(rule, index) {
  return String(rule?._id || rule?.id || index);
}

export function buildNotificationItems(rules = []) {
  return rules
    .filter((rule) => rule?.label && String(rule.label).trim())
    .slice(0, MAX_NOTIFICATION_ITEMS)
    .map((rule, index) => ({ id: ruleItemId(rule, index), label: rule.label }));
}

/**
 * Re-push the checklist notification after setups changed.
 *
 * No-ops on web and when no notification is enabled for this market. If the
 * bound strategy was deleted the server has already cleared the binding, so
 * there is nothing left to refresh.
 *
 * @param {{strategies: Array, market: string}} params - freshly saved strategies
 */
export async function refreshChecklistNotificationFromSetups({ strategies, market }) {
  try {
    if (typeof window === "undefined" || !Capacitor.isNativePlatform()) return;

    const settings = await getChecklistNotificationSettings(market);
    if (!settings?.enabled) return;

    // The server clears the binding when the bound strategy is deleted. Leaving
    // the notification up would keep showing a checklist the user no longer has.
    if (!settings.strategyId) {
      await cancelChecklistNotification(market);
      return;
    }

    const bound = (strategies || []).find(
      (strategy) => String(strategy?._id) === String(settings.strategyId)
    );
    if (!bound) {
      await cancelChecklistNotification(market);
      return;
    }

    await configureChecklistNotification({
      enabled: true,
      strategyId: String(bound._id),
      strategyName: bound.name || settings.strategyName || "",
      market,
      notificationTime: settings.notificationTime,
      repeatMode: settings.repeatMode,
      customDays: settings.customDays,
      persistent: settings.persistent,
      resetEnabled: settings.resetEnabled,
      resetTime: settings.resetTime,
      items: buildNotificationItems(bound.rules),
    });
  } catch {
    // A refresh failure must never block or fail the setup save itself.
  }
}
