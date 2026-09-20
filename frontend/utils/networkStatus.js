"use client";

// One source of truth for "are we online?".
//
// navigator.onLine is unreliable inside the Android WebView (it can stay true
// on a captive portal or after a long doze). @capacitor/network reads the
// platform connectivity manager, so on native we trust it and fall back to
// the browser events on the web. React Query's onlineManager is fed from the
// same signal so paused queries resume the moment connectivity returns.

import { onlineManager } from "@tanstack/react-query";

let online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
const listeners = new Set();
let wired = false;

function setOnline(next) {
  const value = Boolean(next);
  if (value === online) return;
  online = value;
  onlineManager.setOnline(value);
  for (const listener of listeners) listener(value);
}

export function isOnline() {
  return online;
}

export function subscribeNetworkStatus(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Idempotent; called once from Providers on the client.
export async function initNetworkStatus() {
  if (wired || typeof window === "undefined") return;
  wired = true;

  window.addEventListener("online", () => setOnline(true));
  window.addEventListener("offline", () => setOnline(false));

  const isNative = Boolean(window.Capacitor?.isNativePlatform?.());
  if (!isNative) return;

  try {
    const { Network } = await import("@capacitor/network");
    const status = await Network.getStatus();
    setOnline(status.connected);
    await Network.addListener("networkStatusChange", (s) => setOnline(s.connected));
  } catch {
    // Plugin missing (web bundle) — browser events remain the signal.
  }
}

export const OFFLINE_ERROR_CODE = "OFFLINE";

export function createOfflineError() {
  const err = new Error("You're offline. Showing the last saved data.");
  err.code = OFFLINE_ERROR_CODE;
  err.isOffline = true;
  err.status = 0;
  return err;
}

export function isOfflineError(error) {
  return Boolean(error?.isOffline || error?.code === OFFLINE_ERROR_CODE);
}
