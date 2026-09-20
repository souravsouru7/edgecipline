"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { subscribeNetworkStatus, isOnline } from "@/utils/networkStatus";

// Thin pill under the status bar while the device is offline. Does not block
// anything — cached screens stay usable — and announces reconnection briefly
// so the user knows fresh data is on its way.
//
// State is driven straight from the network store's subscription (not from
// a render-time effect) so a flap never queues cascading renders.
export default function OfflineBanner() {
  const queryClient = useQueryClient();
  const [state, setState] = useState("online"); // "online" | "offline" | "reconnected"
  const timerRef = useRef(null);

  useEffect(() => {
    const apply = (online) => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (!online) {
        setState("offline");
        return;
      }
      setState((prev) => {
        if (prev !== "offline") return prev;
        // Back online: refresh whatever the user is looking at, then thank them.
        queryClient.invalidateQueries({ refetchType: "active" });
        timerRef.current = window.setTimeout(() => setState("online"), 2500);
        return "reconnected";
      });
    };
    if (!isOnline()) apply(false);
    const unsubscribe = subscribeNetworkStatus(apply);
    return () => {
      unsubscribe();
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [queryClient]);

  if (state === "online") return null;

  return (
    <div role="status" aria-live="polite" className="offline-banner" data-state={state}>
      <style>{`
        .offline-banner {
          position: fixed;
          top: calc(env(safe-area-inset-top, 0px) + 10px);
          left: 50%;
          transform: translateX(-50%);
          z-index: 1200;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 7px 14px;
          border-radius: 999px;
          font-size: var(--fs-xs, 12px);
          font-weight: 700;
          letter-spacing: 0.02em;
          color: #fff;
          background: #334155;
          box-shadow: 0 6px 18px rgba(15, 25, 35, 0.18);
          pointer-events: none;
          white-space: nowrap;
          animation: offlineBannerIn 220ms cubic-bezier(0.2, 0, 0, 1);
        }
        .offline-banner[data-state="reconnected"] { background: #0D9E6E; }
        .offline-banner::before {
          content: "";
          width: 7px; height: 7px; border-radius: 50%;
          background: currentColor; opacity: .9;
        }
        @keyframes offlineBannerIn {
          from { opacity: 0; transform: translate(-50%, -6px); }
          to   { opacity: 1; transform: translate(-50%, 0); }
        }
        @media (prefers-reduced-motion: reduce) { .offline-banner { animation: none; } }
      `}</style>
      {state === "reconnected" ? "Back online — refreshing" : "You're offline · showing saved data"}
    </div>
  );
}
