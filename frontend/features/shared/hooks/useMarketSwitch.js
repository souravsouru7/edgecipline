"use client";

import { useCallback, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useMarket, MARKETS } from "@/context/MarketContext";
import {
  cancelMarketSwitch,
  requestMarketSwitch,
  settleMarketSwitch,
  useMarketTransition,
} from "@/context/marketTransition";
import { getMarketSwitchPath, isShallowMarketSwitchRoute } from "@/utils/marketNavigation";
import { setPreferredMarket } from "@/services/api";

const otherMarket = (market) =>
  market === MARKETS.FOREX ? MARKETS.INDIAN_MARKET : MARKETS.FOREX;

// The market a path stands for, or null when the path is market-neutral and
// MarketContext is the only signal (checklist, coach, intelligence, ...).
function marketOfPath(pathname) {
  if (!pathname) return null;
  if (pathname.startsWith("/indian-market")) return MARKETS.INDIAN_MARKET;
  if (
    pathname === "/" ||
    pathname === "/dashboard" ||
    pathname === "/trades" ||
    pathname.startsWith("/trades/") ||
    pathname === "/analytics" ||
    pathname.startsWith("/analytics/") ||
    pathname === "/add-trade" ||
    pathname === "/upload-trade" ||
    pathname === "/setups" ||
    pathname === "/discipline"
  ) {
    return MARKETS.FOREX;
  }
  return null;
}

/**
 * Drives the Forex ↔ Indian Market switch.
 *
 * `selectedMarket` is what the switcher should show: it flips on the tap,
 * before any URL or data work, and stays put until the route catches up, so
 * the pill never snaps back while a navigation is in flight.
 *
 * `switchMarket(target)` runs the choreography in context/marketTransition:
 * on the dashboard the URL is rewritten in place (Next's history integration
 * keeps `usePathname` in sync without remounting anything), everywhere else
 * the existing route mirroring is kept via router.push.
 */
export function useMarketSwitch() {
  const router = useRouter();
  const pathname = usePathname();
  const { currentMarket, toggleMarket } = useMarket();
  const transition = useMarketTransition();

  const selectedMarket = transition.phase === "idle" ? currentMarket : transition.target;

  // The counterpart page's chunk is what would otherwise show the route
  // loading screen mid-switch. Warm it while the user is still reading.
  useEffect(() => {
    if (!pathname || isShallowMarketSwitchRoute(pathname)) return;
    const target = getMarketSwitchPath(pathname, otherMarket(currentMarket));
    if (target && target !== pathname) {
      try {
        router.prefetch(target);
      } catch {
        // Static export without a matching route — nothing to warm.
      }
    }
  }, [pathname, currentMarket, router]);

  // Once the route (or, for market-neutral pages, the context) reflects the
  // committed target, let the content animate back in. Any other route change
  // mid-switch means the user went elsewhere: drop the transition.
  useEffect(() => {
    if (transition.phase !== "commit") return;
    const committed = transition.commitPath?.split("?")[0];
    if (pathname === committed) {
      const routeMarket = marketOfPath(pathname);
      const arrived = routeMarket
        ? routeMarket === transition.target
        : currentMarket === transition.target;
      if (arrived) settleMarketSwitch();
      return;
    }
    // Still on the origin path: a router.push is in flight, keep waiting.
    if (pathname === transition.fromPath) return;
    cancelMarketSwitch();
  }, [
    transition.phase,
    transition.commitPath,
    transition.fromPath,
    transition.target,
    pathname,
    currentMarket,
  ]);

  const switchMarket = useCallback(
    (target) => {
      if (!Object.values(MARKETS).includes(target)) return;
      const startPath = pathname || "/dashboard";
      const newPath = getMarketSwitchPath(startPath, target);

      requestMarketSwitch({
        target,
        routeMarket: currentMarket,
        fromPath: startPath,
        commit: () => {
          // The user left the page during the out phase (deep link, back
          // button). Rewriting the URL now would desync route and content.
          if (typeof window !== "undefined" && window.location.pathname !== startPath) {
            return false;
          }

          // Persist the choice server-side so the next login restores it.
          // Fire-and-forget: the local switch already happened.
          setPreferredMarket(target).catch(() => {});

          if (isShallowMarketSwitchRoute(startPath)) {
            // Same component on both routes: swap the URL, keep the tree.
            // MarketSync then updates the context from the new pathname.
            window.history.pushState(null, "", newPath);
            return newPath;
          }

          // Pages without a route counterpart only have the context to go
          // on — unless they were opened with ?market=, which MarketSync
          // treats as authoritative and would reapply over a context toggle.
          if (newPath === startPath) {
            const params = new URLSearchParams(window.location.search);
            if (params.has("market")) {
              params.set("market", target);
              const withMarket = `${startPath}?${params.toString()}`;
              router.replace(withMarket, { scroll: false });
              return withMarket;
            }
            toggleMarket(target);
            return newPath;
          }

          // Real navigation. MarketSync sets the context once the new route
          // renders; setting it here first would only be reverted by the
          // current route until then.
          router.push(newPath, { scroll: false });
          return newPath;
        },
      });
    },
    [pathname, currentMarket, router, toggleMarket]
  );

  return {
    selectedMarket,
    switchMarket,
    isSwitching: transition.phase !== "idle",
  };
}
