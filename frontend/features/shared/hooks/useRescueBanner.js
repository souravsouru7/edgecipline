"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getRescueBanner, recordRescueEvent } from "@/services/api";

// Source of truth for the rescue funnel banner.
//
// Returns: { loading, banner, refresh }
//   banner = null              → hide
//   banner = { touchpoint, headline, body, ctaLabel, ctaDeepLink,
//              metricLabel, metricValue, tone, phase }
//
// Polls every 5 minutes — copy is anchored to subscriptionExpiry which only
// shifts once per renewal, so we don't need to be aggressive. Re-fetches on
// tab focus so a user who paid in another tab sees the banner disappear.
const POLL_MS = 5 * 60 * 1000;

export function useRescueBanner() {
  const [state, setState] = useState({ loading: true, banner: null });
  const mounted = useRef(true);
  const lastViewedTouchpoint = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const data = await getRescueBanner();
      if (!mounted.current) return data;
      const banner = data?.banner || null;
      setState({ loading: false, banner });
      // Fire a banner_viewed beacon once per touchpoint per session — gives us
      // an impression count without spamming events on every re-render.
      if (banner && banner.touchpoint !== lastViewedTouchpoint.current) {
        lastViewedTouchpoint.current = banner.touchpoint;
        recordRescueEvent("rescue_banner_viewed", banner.touchpoint, {
          phase: banner.phase,
          tone: banner.tone,
        });
      }
      return data;
    } catch {
      if (mounted.current) setState({ loading: false, banner: null });
      return null;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refresh]);

  return { ...state, refresh };
}
