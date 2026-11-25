"use client";

import { useSyncExternalStore } from "react";

// Shared "signing you out" state. useLogout starts it on tap so there is
// feedback straight away; the login page finishes it once the form is painted,
// so the overlay crossfades into the next screen instead of cutting.

const SAFETY_MS = 10_000; // never leave the overlay stuck if login never mounts

let active = false;
let safetyTimer = null;
const listeners = new Set();

function emit() {
  listeners.forEach((fn) => fn());
}

export function startSignOutOverlay() {
  if (safetyTimer) clearTimeout(safetyTimer);
  safetyTimer = setTimeout(finishSignOutOverlay, SAFETY_MS);
  if (active) return;
  active = true;
  emit();
}

export function finishSignOutOverlay() {
  if (safetyTimer) clearTimeout(safetyTimer);
  safetyTimer = null;
  if (!active) return;
  active = false;
  emit();
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useSignOutOverlay() {
  return useSyncExternalStore(subscribe, () => active, () => false);
}
