"use client";

// Subtle native haptics at meaningful moments only. Every function is a
// no-op on the web and swallows plugin errors, so callers never guard.
//
//   tapLight()   — a confirmed micro-action: checklist tick, toggle
//   success()    — a completed task: trade saved, streak milestone
//   warning()    — a blocked action: validation error, failed save
//
// Do not add these to ordinary buttons; the app should feel calm, not noisy.

let hapticsModule = null;

async function plugin() {
  if (typeof window === "undefined" || !window.Capacitor?.isNativePlatform?.()) return null;
  if (hapticsModule === null) {
    try {
      hapticsModule = await import("@capacitor/haptics");
    } catch {
      hapticsModule = false;
    }
  }
  return hapticsModule || null;
}

function reducedMotion() {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  } catch {
    return false;
  }
}

export async function tapLight() {
  const m = await plugin();
  if (!m || reducedMotion()) return;
  try { await m.Haptics.impact({ style: m.ImpactStyle.Light }); } catch { /* unsupported */ }
}

export async function success() {
  const m = await plugin();
  if (!m || reducedMotion()) return;
  try { await m.Haptics.notification({ type: m.NotificationType.Success }); } catch { /* unsupported */ }
}

export async function warning() {
  const m = await plugin();
  if (!m || reducedMotion()) return;
  try { await m.Haptics.notification({ type: m.NotificationType.Warning }); } catch { /* unsupported */ }
}
