"use client";

import { useMarketTransition } from "@/context/marketTransition";

/**
 * Wraps the market-specific part of a page so it fades out before the market
 * changes and fades back in once the new market is on screen. Everything
 * outside it — header, ticker, switcher, bottom nav — stays perfectly still.
 *
 * The phases come from context/marketTransition; this component only maps
 * them to two classes. Styles live in app/mobile-optimizations.css next to
 * the route transition so both are tuned in one place.
 */
export default function MarketContentTransition({ children, className = "", style }) {
  const { phase } = useMarketTransition();
  const stateClass =
    phase === "out" || phase === "commit"
      ? " market-content-leaving"
      : phase === "in"
        ? " market-content-entering"
        : "";

  return (
    <div className={`market-content${stateClass}${className ? ` ${className}` : ""}`} style={style}>
      {children}
    </div>
  );
}
