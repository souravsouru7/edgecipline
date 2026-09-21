"use client";

import { usePathname } from "next/navigation";
import { isShallowMarketSwitchRoute } from "@/utils/marketNavigation";

// 180ms shared-axis entrance on every route change. Pure CSS keyed on the
// pathname: navigation is never delayed, no JS runs per frame, and reduced
// motion turns it off. Only the page wrapper animates — never individual
// components.
//
// The Forex and Indian dashboards are one component whose URL the market
// switcher rewrites in place (see useMarketSwitch); they share a key so that
// rewrite does not remount the screen or replay the entrance.
export default function PageTransition({ children }) {
  const pathname = usePathname();
  const transitionKey = isShallowMarketSwitchRoute(pathname) ? "/dashboard" : pathname;
  return (
    <div key={transitionKey} className="page-enter">
      {children}
    </div>
  );
}
