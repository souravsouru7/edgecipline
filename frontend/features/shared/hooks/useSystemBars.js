"use client";

import { useEffect } from "react";

// Keeps the Android status/navigation bars in step with the screen.
//
// The native theme (styles.xml) paints both bars #F4F2EE with dark icons,
// which matches every light screen. A screen with a dark surface calls
// useSystemBars("dark") so the icons flip to light and the bar colour
// follows; it restores the light bars on unmount. No-op off Android.
//
// Colours are the app palette; keep in sync with styles.xml + globals.css.
export const SYSTEM_BAR_THEMES = {
  light: { color: "#F4F2EE", dark: false },
  dark:  { color: "#0F1923", dark: true },
};

export async function applySystemBars(theme = "light") {
  if (typeof window === "undefined" || !window.Capacitor?.isNativePlatform?.()) return;
  if (window.Capacitor.getPlatform?.() !== "android") return;
  const target = SYSTEM_BAR_THEMES[theme] || SYSTEM_BAR_THEMES.light;
  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setOverlaysWebView({ overlay: false });
    await StatusBar.setBackgroundColor({ color: target.color });
    // Style.Dark = light icons on a dark bar; Style.Light = dark icons.
    await StatusBar.setStyle({ style: target.dark ? Style.Dark : Style.Light });
  } catch {
    // Plugin unavailable — the native theme's default colours remain.
  }
}

export function useSystemBars(theme = "light") {
  useEffect(() => {
    applySystemBars(theme);
    return () => {
      if (theme !== "light") applySystemBars("light");
    };
  }, [theme]);
}
