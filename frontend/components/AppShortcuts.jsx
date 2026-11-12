"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useLogTrade } from "@/features/trade/components/LogTradeChooser";
import { subscribeStartupGate } from "@/utils/startupGate";
import { hasValidAuthToken } from "@/utils/auth";

// Home-screen shortcuts (long-press the app icon): "Log a trade" and
// "Checklist". The native side turns them into edgecipline://shortcut/<name>
// links:
//   Android  res/xml/shortcuts.xml (static shortcuts → MainActivity)
//   iOS      Info.plist UIApplicationShortcutItems → SceneDelegate
// and Capacitor's App plugin hands them here, as the launch URL on a cold
// start or as an appUrlOpen event while the app is running.

const SCHEME = "edgecipline:";
const FALLBACK_MS = 6000;

function shortcutName(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== SCHEME || u.host !== "shortcut") return null;
    return u.pathname.replace(/^\/+/, "") || null;
  } catch {
    return null;
  }
}

export default function AppShortcuts() {
  const router = useRouter();
  const { open: openLogTrade } = useLogTrade();
  const handled = useRef(new Set());

  useEffect(() => {
    if (typeof window === "undefined" || !window.Capacitor?.isNativePlatform?.()) return undefined;
    let removeListener = null;
    let cancelled = false;

    const run = (url) => {
      const name = shortcutName(url);
      if (!name) return;
      // The launch URL is reported again on later reads; act once per URL+launch.
      if (handled.current.has(url)) return;
      handled.current.add(url);
      // Signed out: the app is already showing sign-in; nothing to open yet.
      if (!hasValidAuthToken()) return;
      if (name === "log-trade") openLogTrade();
      else if (name === "checklist") router.push("/checklist");
    };

    // Wait until start-up routing (session restore → first screen) is done,
    // so the shortcut isn't overridden by the redirect to the dashboard.
    const whenReady = (fn) => {
      let done = false;
      const go = () => {
        if (done || cancelled) return;
        done = true;
        fn();
      };
      const unsubscribe = subscribeStartupGate(go);
      setTimeout(() => {
        unsubscribe();
        go();
      }, FALLBACK_MS);
    };

    (async () => {
      try {
        const { App } = await import("@capacitor/app");
        const launch = await App.getLaunchUrl();
        if (launch?.url) whenReady(() => run(launch.url));
        const sub = await App.addListener("appUrlOpen", ({ url }) => {
          // Fresh tap while running: allow the same shortcut again.
          handled.current.delete(url);
          run(url);
        });
        removeListener = () => sub.remove();
        if (cancelled) removeListener();
      } catch {
        // App plugin unavailable: shortcuts simply open the app.
      }
    })();

    return () => {
      cancelled = true;
      removeListener?.();
    };
  }, [openLogTrade, router]);

  return null;
}
