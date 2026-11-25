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
  // The outer box clips the 6px the entrance starts offset by. Without it the
  // page is briefly wider than the screen, Android WebView grows the layout
  // viewport to fit, and every position: fixed element shifts — the launch
  // logo visibly jumped a few px and back on the redirect to /login. body's
  // overflow-x: hidden does not prevent that; this does. `clip`, not
  // `hidden`, so it is not a scroll container and position: sticky still works.
  return (
    <div className="page-transition">
      <div key={transitionKey} className="page-enter">
        {children}
      </div>
    </div>
  );
}
