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
// Polls every 5 minutes — copy is anchored to subscriptionExpiry (rescue) or
// freeTier.lastFreeTradeAt (free tier), both of which move at most once per
// cycle, so we don't need to be aggressive. Re-fetches on
// tab focus so a user who paid in another tab sees the banner disappear.
const POLL_MS = 5 * 60 * 1000;

// PageHeader (and so this hook) remounts on every route change. Without a
// shared copy each navigation and each tab focus refetched the banner, which
// alone used ~17 requests in 9 minutes of the per-user API budget. One copy
// for the whole app, refreshed when it's older than the poll interval.
let sharedData = null;
let sharedAt = 0;
let sharedInflight = null;

function loadBanner({ force = false } = {}) {
  if (!force && sharedData && Date.now() - sharedAt < POLL_MS) return Promise.resolve(sharedData);
  if (sharedInflight) return sharedInflight;
  sharedInflight = getRescueBanner()
    .then((data) => {
      sharedData = data;
      sharedAt = Date.now();
      return data;
    })
    .finally(() => { sharedInflight = null; });
  return sharedInflight;
}

export function useRescueBanner() {
  const [state, setState] = useState(() => ({ loading: !sharedData, banner: sharedData?.banner || null }));
  const mounted = useRef(true);
  const lastViewedTouchpoint = useRef(null);

  const refresh = useCallback(async ({ force = false } = {}) => {
    try {
      const data = await loadBanner({ force });
      if (!mounted.current) return data;
      const banner = data?.banner || null;
      setState({ loading: false, banner });
      // Fire a banner_viewed beacon once per touchpoint per session — gives us
      // an impression count without spamming events on every re-render.
      if (banner && banner.touchpoint !== lastViewedTouchpoint.current) {
        lastViewedTouchpoint.current = banner.touchpoint;
        const isFreeTier = banner.funnel === "free_tier";
        recordRescueEvent(isFreeTier ? "free_nudge_viewed" : "rescue_banner_viewed", banner.touchpoint, {
          funnel: isFreeTier ? "free_tier" : "subscription_rescue",
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
    // Uses the shared copy when it's fresh; fetches only when stale.
    const initialTimer = setTimeout(() => {
      refresh();
    }, 0);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      mounted.current = false;
      clearTimeout(initialTimer);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refresh]);

  // Callers that change the banner's inputs (e.g. after a purchase) force it.
  const forceRefresh = useCallback(() => refresh({ force: true }), [refresh]);
  return { ...state, refresh: forceRefresh };
}
