"use client";

import { useEffect, useState } from "react";
import { registerDismissable } from "@/utils/backNavigation";

// Modal bottom sheet for phones and desktop alike.
//
// Three phone-specific problems this handles that a plain
// `position: fixed; inset: 0` overlay does not:
//
//   1. Edge-to-edge (targetSdk 35+): the WebView extends under the status
//      bar, so a sheet tall enough to reach the top puts its header — and the
//      close button — underneath the clock, where taps do not land.
//      → The overlay is padded by env(safe-area-inset-top).
//   2. The keyboard: Android resizes the viewport when an input focuses and
//      may scroll the document to reveal it. A sheet sized in vh keeps its old
//      height, gets pushed up, and stays there after the keyboard closes
//      ("the page went up"). → The overlay tracks window.visualViewport, the
//      sheet is sized as a percentage of it, and the document scroll position
//      is restored on every focus-out.
//   3. Scroll bleed: dragging the sheet's content at its end scrolled the
//      page behind it. → body overflow is locked while open.
//
// Also: Escape and the Android back gesture close the sheet. The sheet
// registers itself with utils/backNavigation while mounted, and the global
// NativeBackButton dismisses it instead of navigating the page underneath.
//
// `height` is the sheet's height as a CSS value relative to the overlay
// (default "min(88%, 720px)"); pass "auto" for content-sized sheets and let
// `maxHeight` cap them. `padding` is a single number (px) applied to all
// sides; the bottom additionally absorbs the home-indicator inset.
export default function BottomSheet({
  onClose,
  label,
  children,
  height = "min(88%, 720px)",
  maxHeight = "100%",
  maxWidth = 640,
  zIndex = 1100,
  padding = 0,
  scrollable = false,
  showHandle = true,
}) {
  const [viewport, setViewport] = useState(null);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const vv = window.visualViewport;
    const scrollYAtOpen = window.scrollY;
    const body = document.body;
    const previousOverflow = body.style.overflow;
    body.style.overflow = "hidden";

    const sync = () => {
      if (!vv) return;
      setViewport({ height: Math.round(vv.height), top: Math.round(vv.offsetTop) });
    };
    // Some WebViews do not shrink the viewport back on their own when the
    // keyboard closes; a focus-out is the reliable signal that it is leaving.
    const restoreScroll = () => {
      window.setTimeout(() => {
        window.scrollTo(0, scrollYAtOpen);
        sync();
      }, 60);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };

    sync();
    vv?.addEventListener("resize", sync);
    vv?.addEventListener("scroll", sync);
    document.addEventListener("focusout", restoreScroll);
    window.addEventListener("keydown", onKeyDown);

    // Android back closes the sheet: handled by the global NativeBackButton
    // through this registration, so a press never also navigates the page
    // underneath.
    const unregisterBack = registerDismissable(() => onClose?.());

    return () => {
      body.style.overflow = previousOverflow;
      vv?.removeEventListener("resize", sync);
      vv?.removeEventListener("scroll", sync);
      document.removeEventListener("focusout", restoreScroll);
      window.removeEventListener("keydown", onKeyDown);
      unregisterBack();
      window.scrollTo(0, scrollYAtOpen);
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      style={{
        position: "fixed",
        left: 0, right: 0,
        top: viewport ? viewport.top : 0,
        height: viewport ? viewport.height : "100%",
        zIndex,
        background: "rgba(15, 25, 35, 0.55)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
        paddingTop: "env(safe-area-inset-top, 0px)",
        boxSizing: "border-box",
        overscrollBehavior: "contain",
      }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose?.(); }}
    >
      <div style={{
        width: "100%", maxWidth,
        height,
        maxHeight,
        background: "#FFFFFF",
        borderTopLeftRadius: 20, borderTopRightRadius: 20,
        boxShadow: "0 -16px 40px rgba(15,25,35,0.18)",
        display: "flex", flexDirection: "column",
        overflow: scrollable ? "auto" : "hidden",
        overscrollBehavior: "contain",
        WebkitOverflowScrolling: "touch",
        padding,
        paddingBottom: `calc(${padding}px + env(safe-area-inset-bottom, 0px))`,
        boxSizing: "border-box",
      }}>
        {showHandle && (
          <div aria-hidden="true" style={{ display: "flex", justifyContent: "center", padding: "10px 0 0", flexShrink: 0 }}>
            <div style={{ width: 40, height: 4, borderRadius: 2, background: "#CBD5E1" }} />
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
