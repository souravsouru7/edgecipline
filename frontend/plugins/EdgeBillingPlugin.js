"use client";

import { Capacitor, registerPlugin } from "@capacitor/core";

// JS bridge for the native EdgeBillingPlugin.
//
// Mirrors the ChecklistNotificationPlugin pattern: a web fallback that reports
// "unavailable" rather than throwing, so every caller can be written once and
// run on web, on a device without Play Services, and on a real Android phone.
//
// Nothing here decides entitlement. The plugin returns purchase TOKENS; those
// go to the backend, and the backend's answer is the only source of truth.

const WebFallback = {
  isAvailable: async () => ({ available: false, reason: "not_native" }),
  getProducts: async () => ({ offers: [] }),
  purchase: async () => {
    throw new Error("In-app purchases are only available in the Android app.");
  },
  getPurchases: async () => ({ purchases: [] }),
  addListener: () => ({ remove: () => {} }),
};

let _plugin = null;

function getPlugin() {
  if (_plugin) return _plugin;
  if (typeof window === "undefined") return WebFallback;

  try {
    if (!Capacitor.isNativePlatform()) return WebFallback;
    _plugin = registerPlugin("EdgeBilling", {
      web: () => Promise.resolve(WebFallback),
    });
    return _plugin;
  } catch {
    return WebFallback;
  }
}

/** True only inside the native Android app. */
export function isAndroidApp() {
  if (typeof window === "undefined") return false;
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
  } catch {
    return false;
  }
}

/**
 * Can this device actually transact? False on web, on devices without the Play
 * Store, and while the Play Store app is mid-update.
 */
export async function isBillingAvailable() {
  try {
    return await getPlugin().isAvailable();
  } catch (error) {
    return { available: false, reason: error?.message || "unknown" };
  }
}

/**
 * Live, localised offers straight from Play.
 *
 * `formattedPrice` is already in the user's currency with their region's tax
 * treatment applied — it is the only price that should ever be rendered. Do not
 * reformat `priceAmountMicros` yourself; it is exposed for analytics only.
 */
export async function getBillingProducts(productId) {
  return getPlugin().getProducts({ productId });
}

/**
 * Open Play's purchase sheet.
 *
 * Resolves as soon as the sheet is up, NOT when the purchase completes — Play's
 * flow can outlive the app. Subscribe with onPurchaseUpdated() before calling.
 */
export async function startPurchase({ productId, offerToken, obfuscatedAccountId }) {
  return getPlugin().purchase({ productId, offerToken, obfuscatedAccountId });
}

/** Every subscription purchase Play associates with this device. */
export async function getDevicePurchases() {
  return getPlugin().getPurchases();
}

/**
 * Subscribe to purchase outcomes.
 *
 * Fires for purchases completed after the app was backgrounded or killed, which
 * is why this and not the purchase() promise is the real completion signal.
 *
 * Event: { status: "purchased" | "cancelled" | "already_owned" | "failed",
 *          purchases?, responseCode, message? }
 */
export function onPurchaseUpdated(handler) {
  try {
    return getPlugin().addListener("purchaseUpdated", handler);
  } catch {
    return { remove: () => {} };
  }
}
