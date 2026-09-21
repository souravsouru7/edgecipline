"use client";

import { useRef } from 'react';
import { MARKETS } from '@/context/MarketContext';
import { MARKET_SWITCH_TIMING } from '@/context/marketTransition';
import { useMarketSwitch } from '@/features/shared/hooks/useMarketSwitch';

const PILL_MS = MARKET_SWITCH_TIMING.pill;
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

const TABS = [
  { market: MARKETS.FOREX, label: 'FOREX', id: 'market-tab-forex' },
  { market: MARKETS.INDIAN_MARKET, label: 'INDIA MKT', id: 'market-tab-india' },
];

/**
 * Forex ↔ India MKT segmented control.
 *
 * The selected state comes from useMarketSwitch, which flips on the tap and
 * holds until the route agrees, so the pill glides once and never bounces
 * back while the switch is in flight. The switch choreography (content fade,
 * URL update, cache) lives in that hook; this component is purely the control.
 *
 * @param {object} [props]
 * @param {(market: string) => void} [props.onSwitch]  called after a tap that
 *   starts a switch — the mobile drawer uses it to close itself.
 */
export default function MarketSwitcher({ onSwitch }) {
  const { selectedMarket, switchMarket } = useMarketSwitch();
  const tabRefs = useRef([]);

  const isForex = selectedMarket === MARKETS.FOREX;
  const selectedIndex = isForex ? 0 : 1;

  const select = (market) => {
    if (market === selectedMarket) return;
    switchMarket(market);
    onSwitch?.(market);
  };

  // Roving tabindex: arrows move between segments and select; Enter/Space
  // are native button activation.
  const onKeyDown = (event) => {
    let next = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (selectedIndex + 1) % TABS.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (selectedIndex - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TABS.length - 1;
    if (next === null) return;
    event.preventDefault();
    tabRefs.current[next]?.focus();
    select(TABS[next].market);
  };

  return (
    <div className="market-switcher-wrap" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div
        role="tablist"
        aria-label="Market"
        className="market-switcher"
        suppressHydrationWarning
      >
        {/* One pill that physically moves between the two segments. */}
        <span
          aria-hidden="true"
          className="market-switcher-pill"
          suppressHydrationWarning
          style={{ transform: isForex ? 'translateX(0)' : 'translateX(calc(100% + 4px))' }}
        />

        {TABS.map((tab, index) => {
          const selected = index === selectedIndex;
          return (
            <button
              key={tab.market}
              ref={(el) => { tabRefs.current[index] = el; }}
              type="button"
              role="tab"
              id={tab.id}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              className={`market-tab${selected ? ' is-selected' : ''}`}
              onClick={() => select(tab.market)}
              onKeyDown={onKeyDown}
              title={selected ? undefined : `Switch to ${tab.market === MARKETS.FOREX ? 'Forex' : 'Indian Market'}`}
              suppressHydrationWarning
            >
              {tab.market === MARKETS.FOREX && (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" />
                  <line x1="12" y1="18" x2="12" y2="2" />
                </svg>
              )}
              {tab.label}
            </button>
          );
        })}
      </div>

      <style jsx>{`
        .market-switcher {
          position: relative;
          display: flex;
          align-items: stretch;
          width: 168px;
          /* 48px outer (2px border) so each tab is a full 44px-tall target;
             the pill is inset 4px so the visual stays the same slim strip. */
          height: 48px;
          padding: 0;
          flex-shrink: 0;
          background: #FFFFFF;
          border: 2px solid #0D9E6E;
          border-radius: 24px;
          box-shadow: 0 2px 8px rgba(13, 158, 110, 0.2);
          /* Press feedback: the whole control dips very slightly. :active
             matches ancestors of the pressed tab, so no JS is involved. */
          transition: transform 90ms ease, box-shadow 180ms ease;
          -webkit-tap-highlight-color: transparent;
          user-select: none;
          -webkit-user-select: none;
        }
        .market-switcher:active {
          transform: scale(0.98);
        }
        .market-switcher-pill {
          position: absolute;
          top: 4px;
          bottom: 4px;
          left: 4px;
          width: calc(50% - 6px);
          border-radius: 16px;
          background: linear-gradient(135deg, #0D9E6E 0%, #22C78E 100%);
          box-shadow: 0 2px 6px rgba(13, 158, 110, 0.35);
          transition: transform ${PILL_MS}ms ${EASE};
          will-change: transform;
        }
        .market-tab {
          position: relative;
          z-index: 1;
          flex: 1 1 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          /* The global mobile stylesheet forces 48px buttons; inside the
             control each tab is exactly half the width and the full height. */
          min-height: 44px;
          min-width: 0;
          height: 100%;
          padding: 0;
          margin: 0;
          border: none;
          border-radius: 16px;
          background: transparent;
          color: #94A3B8;
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.04em;
          white-space: nowrap;
          cursor: pointer;
          transition: color ${PILL_MS}ms ease;
        }
        .market-tab:last-child {
          font-size: 10px;
          letter-spacing: 0.02em;
        }
        .market-tab.is-selected {
          color: #FFFFFF;
          cursor: default;
        }
        .market-tab:active {
          /* The container handles press feedback; no per-tab nudge. */
          transform: none;
        }
        .market-tab:focus-visible {
          outline: 2px solid #0D9E6E;
          outline-offset: 2px;
        }
        @media (prefers-reduced-motion: reduce) {
          .market-switcher,
          .market-switcher-pill,
          .market-tab {
            transition: none;
          }
          .market-switcher:active {
            transform: none;
          }
        }
      `}</style>
    </div>
  );
}
