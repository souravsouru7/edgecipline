"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const MIN_VISIBLE_MS = 280;
const FAILSAFE_MS = 8000;

function isInternalNavigation(anchor) {
  if (!anchor?.href) return false;
  if (anchor.target && anchor.target !== "_self") return false;
  if (anchor.hasAttribute("download")) return false;

  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin) return false;
  if (url.pathname === window.location.pathname && url.search === window.location.search) return false;
  return true;
}

export default function RouteTransitionProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [active, setActive] = useState(false);
  const [settling, setSettling] = useState(false);
  const startedAtRef = useRef(0);
  const timeoutRef = useRef(null);
  const settleTimeoutRef = useRef(null);

  useEffect(() => {
    const clearPendingTimeout = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (settleTimeoutRef.current) {
        clearTimeout(settleTimeoutRef.current);
        settleTimeoutRef.current = null;
      }
    };

    const start = () => {
      clearPendingTimeout();
      setSettling(false);
      startedAtRef.current = Date.now();
      setActive(true);
      timeoutRef.current = setTimeout(() => setActive(false), FAILSAFE_MS);
    };

    const onClick = (event) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target?.closest?.("a[href]");
      if (!anchor || !isInternalNavigation(anchor)) return;
      start();
    };

    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      clearPendingTimeout();
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    const elapsed = Date.now() - startedAtRef.current;
    const remaining = Math.max(0, MIN_VISIBLE_MS - elapsed);
    const timer = setTimeout(() => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      setSettling(true);
      setActive(false);
      settleTimeoutRef.current = setTimeout(() => {
        settleTimeoutRef.current = null;
        setSettling(false);
      }, 260);
    }, remaining);
    return () => {
      clearTimeout(timer);
    };
  }, [pathname, searchParams, active]);

  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        top: "env(safe-area-inset-top, 0px)",
        left: 0,
        right: 0,
        height: 3,
        zIndex: 2147483647,
        opacity: active || settling ? 1 : 0,
        pointerEvents: "none",
        transition: active ? "opacity 0.08s ease" : "opacity 0.22s ease 0.08s",
      }}
    >
      <div
        style={{
          height: "100%",
          width: active ? "86%" : settling ? "100%" : "0%",
          background: "linear-gradient(90deg, #0D9E6E 0%, #22C78E 48%, #B8860B 100%)",
          boxShadow: active || settling ? "0 0 16px rgba(13,158,110,0.32)" : "none",
          transition: active
            ? "width 1.4s cubic-bezier(0.16, 1, 0.3, 1)"
            : settling
              ? "width 0.18s ease-out"
              : "width 0s linear 0.25s",
        }}
      />
    </div>
  );
}
