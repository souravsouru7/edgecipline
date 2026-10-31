"use client";

import { registerPlugin } from "@capacitor/core";
import { isIOSNative } from "@/utils/platform";

// JS bridge for the native EdgeStoreKitPlugin (ios/App/App/EdgeStoreKitPlugin.swift).
//
// The iOS twin of EdgeBillingPlugin, and an iOS-ONLY plugin: everywhere else it
// returns a fallback that reports "unavailable" instead of throwing, so callers
// are written once for web, Android and iOS.
//
// Nothing here decides entitlement. The plugin returns Apple's SIGNED
// transaction; that goes to the backend, and the backend's answer is the only
// source of truth. A transaction is finished only after the backend confirms
// it — see finishTransaction().

const UnsupportedFallback = {
  isAvailable: async () => ({ available: false, reason: "not_ios" }),
  getProducts: async () => ({ products: [] }),
  purchase: async () => {
    throw new Error("In-app purchases are only available in the iPhone app.");
  },
  finishTransaction: async () => {},
  getCurrentEntitlements: async () => ({ transactions: [] }),
  restore: async () => ({ transactions: [] }),
  manageSubscriptions: async () => {},
  addListener: () => ({ remove: () => {} }),
};

let _plugin = null;

function getPlugin() {
  if (_plugin) return _plugin;
  if (!isIOSNative()) return UnsupportedFallback;

  try {
    _plugin = registerPlugin("EdgeStoreKit", {
      web: () => Promise.resolve(UnsupportedFallback),
    });
    return _plugin;
  } catch {
    return UnsupportedFallback;
  }
}

export const isIOSApp = isIOSNative;

/** Can this Apple ID buy? False on web/Android and under Screen Time limits. */
export async function isStoreKitAvailable() {
  try {
    return await getPlugin().isAvailable();
  } catch (error) {
    return { available: false, reason: error?.message || "unknown" };
  }
}

/**
 * Live, localised products from the App Store. `displayPrice` is the only
 * price that may be shown — it is already in the user's currency with tax
 * handled. `price` is for analytics only.
 */
export async function getStoreKitProducts(productIds) {
  return getPlugin().getProducts({ productIds });
}

/**
 * Open Apple's purchase sheet.
 *
 * Resolves with { status: "purchased" | "cancelled" | "pending", ... }. On
 * "purchased" the caller must POST signedTransaction to the backend and only
 * then call finishTransaction(transactionId).
 */
export async function startStoreKitPurchase({ productId, appAccountToken }) {
  return getPlugin().purchase({ productId, appAccountToken });
}

/** Tell StoreKit the purchase is recorded. Call only after backend success. */
export async function finishStoreKitTransaction(transactionId) {
  return getPlugin().finishTransaction({ transactionId: String(transactionId) });
}

/** Signed transactions for every subscription this Apple ID currently holds. */
export async function getStoreKitEntitlements() {
  return getPlugin().getCurrentEntitlements();
}

/** "Restore Purchases": syncs with the App Store (may ask for the password). */
export async function restoreStoreKitPurchases() {
  return getPlugin().restore();
}

/** Apple's own Manage Subscriptions sheet (cancel, switch plan). */
export async function openStoreKitManageSubscriptions() {
  return getPlugin().manageSubscriptions();
}

/**
 * Renewals, Ask-to-Buy approvals, purchases from another device and anything
 * left unfinished by a previous launch. Each event carries a signedTransaction
 * to verify and then finish, exactly like a fresh purchase.
 */
export function onStoreKitTransactionUpdated(handler) {
  try {
    return getPlugin().addListener("transactionUpdated", handler);
  } catch {
    return { remove: () => {} };
  }
}
