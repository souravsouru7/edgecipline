"use client";

import { useSyncExternalStore } from "react";
import {
  DEFAULT_THEME, THEME_STORAGE_KEY, THEME_SURFACE, normalizePreference, resolveTheme,
} from "./themeBoot";
import { applySystemBars } from "@/features/shared/hooks/useSystemBars";

// Appearance for the redesigned UI (design-system.css). The saved preference
// is applied before first paint by THEME_BOOT_SCRIPT (utils/themeBoot.js);
// this module reads and changes it afterwards. Dark is the default.

export { DEFAULT_THEME, THEMES, THEME_PREFERENCES, THEME_SURFACE, resolveTheme } from "./themeBoot";

const EVENT = "ec-theme-change";
const LIGHT_QUERY = "(prefers-color-scheme: light)";

function prefersLight() {
  try {
    return window.matchMedia?.(LIGHT_QUERY)?.matches === true;
  } catch {
    return false;
  }
}

export function getTheme() {
  if (typeof document === "undefined") return DEFAULT_THEME;
  const t = document.documentElement.dataset.theme;
  return t === "light" || t === "dark" ? t : DEFAULT_THEME;
}

export function getThemePreference() {
  if (typeof document === "undefined") return DEFAULT_THEME;
  return normalizePreference(document.documentElement.dataset.themePref);
}

/**
 * Everything outside the page that should match the theme: the canvas behind
 * the page, the browser/OS chrome colour, and the native status/navigation
 * bars. Called at start-up (app/providers.tsx) and on every theme change.
 */
export function syncThemeChrome(resolved = getTheme()) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const bg = THEME_SURFACE[resolved] || THEME_SURFACE.dark;
  root.style.background = bg;
  root.style.colorScheme = resolved;
  try {
    const metas = document.querySelectorAll('meta[name="theme-color"]');
    metas.forEach((m) => {
      m.setAttribute("content", bg);
      m.removeAttribute("media");
    });
  } catch {
    // Not critical.
  }
  void applySystemBars(resolved);
}

function apply(pref) {
  const resolved = resolveTheme(pref, prefersLight());
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.themePref = pref;
  syncThemeChrome(resolved);
  window.dispatchEvent(new Event(EVENT));
}

export function setThemePreference(pref) {
  if (typeof document === "undefined") return;
  const p = normalizePreference(pref);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, p);
  } catch {
    // Private mode / blocked storage — the choice lasts for this session only.
  }
  apply(p);
}

// Kept for older callers: setTheme("dark" | "light").
export const setTheme = setThemePreference;

// Follow the OS while the preference is "system". One listener per page.
let osListenerAttached = false;
function ensureOsListener() {
  if (osListenerAttached || typeof window === "undefined" || !window.matchMedia) return;
  osListenerAttached = true;
  try {
    window.matchMedia(LIGHT_QUERY).addEventListener("change", () => {
      if (getThemePreference() === "system") apply("system");
    });
  } catch {
    // Old WebView without addEventListener on MediaQueryList — no live follow.
  }
}

function subscribe(callback) {
  ensureOsListener();
  window.addEventListener(EVENT, callback);
  return () => window.removeEventListener(EVENT, callback);
}

const serverTheme = () => DEFAULT_THEME;

/** { theme: resolved "dark"|"light", preference: "dark"|"light"|"system", setPreference } */
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getTheme, serverTheme);
  const preference = useSyncExternalStore(subscribe, getThemePreference, serverTheme);
  return { theme, preference, setPreference: setThemePreference };
}
