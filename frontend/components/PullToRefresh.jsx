"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { tapLight } from "@/utils/haptics";

// Pull down from the top of a list screen to reload it, the way native apps
// do. One instance for the whole app: it refetches every query the current
// screen has mounted, and fires `ec:pull-refresh` for the few screens that
// load data by hand (they listen and reload themselves).
//
// Only on touch devices and only on the screens listed here: never on forms
// (a pull would fight text selection and scrolling inside inputs) or on the
// coach chat, which scrolls inside its own panel.
const ENABLED_PREFIXES = [
  "/dashboard", "/indian-market/dashboard",
  "/trades", "/indian-market/trades",
  "/notifications", "/missions", "/streaks", "/reflection",
  "/discipline", "/indian-market/discipline", "/psychology-timeline",
  "/analytics", "/indian-market/analytics",
  "/intelligence", "/indian-market/intelligence",
  "/weekly-reports", "/trading-dna",
  "/setups", "/indian-market/setups",
  "/support/tickets",
];
const DISABLED_PATHS = ["/trades/edit", "/indian-market/trades/edit", "/support/tickets/new"];

const TRIGGER = 72; // px of (damped) pull needed to refresh
const MAX = 110;
const MIN_SPIN_MS = 600;

function isEnabledPath(pathname) {
  if (!pathname) return false;
  if (DISABLED_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return false;
  return ENABLED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

// A dialog, bottom sheet or full-screen menu owns the gesture.
function overlayOpen() {
  return Boolean(
    document.querySelector('[aria-modal="true"], .ec-modal-overlay') ||
      document.body.style.overflow === "hidden" ||
      document.documentElement.dataset.keyboardOpen !== undefined
  );
}

export default function PullToRefresh() {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const start = useRef(null);
  const pullRef = useRef(0);
  const busy = useRef(false);
  const enabled = isEnabledPath(pathname);

  useEffect(() => {
    if (!enabled) return undefined;
    if (!window.matchMedia?.("(pointer: coarse)").matches) return undefined;

    const onStart = (e) => {
      if (busy.current || e.touches.length !== 1 || window.scrollY > 0 || overlayOpen()) {
        start.current = null;
        return;
      }
      // Ignore pulls that begin inside something scrollable of its own.
      const scroller = e.target.closest?.("[data-no-pull], textarea, input, select, .ec-sheet, [role='dialog']");
      if (scroller) {
        start.current = null;
        return;
      }
      start.current = { y: e.touches[0].clientY, x: e.touches[0].clientX, armed: false };
    };

    const onMove = (e) => {
      const s = start.current;
      if (!s) return;
      const dy = e.touches[0].clientY - s.y;
      const dx = Math.abs(e.touches[0].clientX - s.x);
      if (!s.armed) {
        // Mostly-horizontal swipes (carousels, iOS back swipe) aren't pulls.
        if (dx > Math.abs(dy) || dy < 6 || window.scrollY > 0) {
          if (dy < 0 || dx > 12) start.current = null;
          return;
        }
        s.armed = true;
      }
      // Rubber-band damping so it feels like resistance, not a drag.
      const damped = Math.min(MAX, Math.max(0, dy) * 0.5);
      if (damped > 0 && e.cancelable) e.preventDefault();
      if (pullRef.current < TRIGGER && damped >= TRIGGER) void tapLight();
      pullRef.current = damped;
      setPull(damped);
    };

    const onEnd = async () => {
      const s = start.current;
      start.current = null;
      const distance = pullRef.current;
      pullRef.current = 0;
      if (!s?.armed) return;
      if (distance < TRIGGER) {
        setPull(0);
        return;
      }
      busy.current = true;
      setRefreshing(true);
      setPull(TRIGGER * 0.75);
      const started = Date.now();
      window.dispatchEvent(new Event("ec:pull-refresh"));
      try {
        await queryClient.refetchQueries({ type: "active" });
      } catch {
        // A failed refetch shows its own error state on the page.
      }
      const wait = MIN_SPIN_MS - (Date.now() - started);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      setRefreshing(false);
      setPull(0);
      busy.current = false;
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [enabled, queryClient]);

  if (!enabled || (pull === 0 && !refreshing)) return null;

  const progress = Math.min(1, pull / TRIGGER);
  return (
    <div
      className={`ec-ptr${refreshing ? " is-refreshing" : ""}${progress >= 1 ? " is-ready" : ""}`}
      style={{ transform: `translate(-50%, ${pull}px)`, opacity: Math.min(1, progress * 1.4) }}
      role="status"
      aria-live="polite"
    >
      <RefreshCw size={18} style={{ transform: refreshing ? undefined : `rotate(${progress * 270}deg)` }} aria-hidden="true" />
      <span className="ec-sr-only">{refreshing ? "Refreshing" : progress >= 1 ? "Release to refresh" : "Pull to refresh"}</span>
    </div>
  );
}
