"use client";

import { useEffect } from "react";

// Keeps the native status bar (and on Android the navigation bar) in step
// with the app theme.
//
// The native shell boots dark (styles.xml / LaunchScreen, matching the app's
// default theme). utils/theme.js calls applySystemBars() once at start-up and
// on every theme change, so screens don't need to do anything.
//
// Colours are the --ec-bg values in app/design-system.css.
export const SYSTEM_BAR_THEMES = {
  light: { color: "#F7F7F5", dark: false },
  dark:  { color: "#0A0D12", dark: true },
};

export async function applySystemBars(theme = "dark") {
  if (typeof window === "undefined" || !window.Capacitor?.isNativePlatform?.()) return;
  const platform = window.Capacitor.getPlatform?.();
  const target = SYSTEM_BAR_THEMES[theme] || SYSTEM_BAR_THEMES.dark;
  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    // Style.Dark = light icons for a dark background; Style.Light = dark icons.
    await StatusBar.setStyle({ style: target.dark ? Style.Dark : Style.Light });
    if (platform === "android") {
      await StatusBar.setOverlaysWebView({ overlay: false });
      await StatusBar.setBackgroundColor({ color: target.color });
    }
    // iOS: the web content (viewport-fit=cover) shows under the status bar,
    // so only the icon style needs to change.
  } catch {
    // Plugin unavailable: the native defaults remain.
  }
}

/**
 * Kept for existing callers. The bars now follow the global theme, so this
 * only re-applies the theme it's given. It used to reset the bars to light
 * on unmount, which left a beige status bar over dark screens.
 */
export function useSystemBars(theme) {
  useEffect(() => {
    if (theme) applySystemBars(theme);
  }, [theme]);
}
