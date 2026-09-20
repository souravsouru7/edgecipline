"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useMarket } from "@/context/MarketContext";
import { hasValidAuthToken } from "@/utils/auth";
import { decideBackAction, dismissTop } from "@/utils/backNavigation";

// Single owner of the Android hardware back button. Mounted once in
// Providers; renders nothing. Policy lives in utils/backNavigation.
export default function NativeBackButton() {
  const router = useRouter();
  const pathname = usePathname();
  const { currentMarket } = useMarket();
  const pathRef = useRef(pathname);
  const prevPathRef = useRef("");
  const marketRef = useRef(currentMarket);

  useEffect(() => {
    if (pathRef.current !== pathname) {
      prevPathRef.current = pathRef.current;
      pathRef.current = pathname;
    }
  }, [pathname]);
  useEffect(() => { marketRef.current = currentMarket; }, [currentMarket]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.Capacitor?.isNativePlatform?.()) return undefined;
    let handle = null;
    let cancelled = false;

    (async () => {
      try {
        const { App } = await import("@capacitor/app");
        const listener = await App.addListener("backButton", ({ canGoBack }) => {
          const decision = decideBackAction({
            pathname: pathRef.current,
            referrer: prevPathRef.current,
            canGoBack,
            dialogOpen: Boolean(document.querySelector('[role="dialog"][aria-modal="true"]')),
            signedIn: hasValidAuthToken(),
            currentMarket: marketRef.current,
          });
          switch (decision.action) {
            case "dismiss":
              dismissTop();
              break;
            case "escape":
              // A dialog we cannot address directly: give it Escape, which
              // every dialog in the app already listens for. Never navigate
              // underneath an open modal.
              window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
              break;
            case "back":
              router.back();
              break;
            case "replace":
              router.replace(decision.to);
              break;
            case "minimize":
            default:
              App.minimizeApp().catch(() => {});
          }
        });
        if (cancelled) listener.remove(); else handle = listener;
      } catch {
        // Plugin not available (web) — the browser handles history.
      }
    })();

    return () => {
      cancelled = true;
      handle?.remove?.();
    };
  }, [router]);

  return null;
}
