"use client";

import { useEffect, useRef, useState } from 'react';
import { useMarket, MARKETS } from '@/context/MarketContext';
import { setPreferredMarket } from '@/services/api';
import { useRouter, usePathname } from 'next/navigation';

const SWITCH_DURATION_MS = 240;

export default function MarketSwitcher() {
  const { currentMarket, toggleMarket } = useMarket();
  const router = useRouter();
  const pathname = usePathname();
  const navigationTimerRef = useRef(null);
  const [isSwitching, setIsSwitching] = useState(false);

  useEffect(() => () => {
    if (navigationTimerRef.current) clearTimeout(navigationTimerRef.current);
  }, []);

  const handleSwitch = () => {
    const targetMarket = currentMarket === MARKETS.FOREX
      ? MARKETS.INDIAN_MARKET
      : MARKETS.FOREX;

    let newPath = pathname || '/dashboard';

    if (targetMarket === MARKETS.FOREX) {
      if (newPath.startsWith('/indian-market')) {
        newPath = newPath.replace('/indian-market', '');
      }
      if (newPath === '' || newPath === '/') newPath = '/dashboard';
      if (newPath === '/weekly-reports') {
        newPath = '/weekly-reports?market=Forex';
      }
    } else if (newPath === '/' || newPath === '/dashboard') {
      newPath = '/indian-market/dashboard';
    } else if (
      newPath === '/trades' ||
      newPath.startsWith('/trades/') ||
      newPath === '/add-trade' ||
      newPath === '/upload-trade' ||
      newPath === '/setups' ||
      newPath === '/discipline'
    ) {
      newPath = `/indian-market${newPath}`;
    } else if (newPath === '/analytics' || newPath.startsWith('/analytics/')) {
      newPath = '/indian-market/analytics';
    } else if (newPath === '/weekly-reports') {
      newPath = '/weekly-reports?market=Indian_Market';
    }

    router.prefetch(newPath);
    setIsSwitching(true);
    toggleMarket(targetMarket);
    // Persist the choice. Only onboarding used to write this, so the server kept
    // returning the market the user picked at signup no matter how often they
    // switched — leaving every later session (and the dashboard's startup
    // restore) disagreeing with the switcher. Fire-and-forget: a failed PATCH
    // must not block navigation, and the local choice already took effect.
    setPreferredMarket(targetMarket).catch(() => {});

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    navigationTimerRef.current = setTimeout(() => {
      router.push(newPath);
      setIsSwitching(false);
    }, prefersReducedMotion ? 0 : SWITCH_DURATION_MS);
  };

  const isForex = currentMarket === MARKETS.FOREX;

  return (
    <div className="market-switcher-wrap" style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    }}>
      {/* Toggle Container */}
      <button
        onClick={handleSwitch}
        disabled={isSwitching}
        aria-label={`Switch to ${isForex ? 'Indian Market' : 'Forex'}`}
        suppressHydrationWarning
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          background: '#FFFFFF',
          border: '2px solid #0D9E6E',
          borderRadius: '24px',
          padding: '4px',
          cursor: 'pointer',
          transition: 'border-color 180ms ease, box-shadow 180ms ease',
          boxShadow: '0 2px 8px rgba(13, 158, 110, 0.2)',
          width: '168px',
          height: '36px',
          flexShrink: 0,
        }}
        title={`Switch to ${isForex ? 'Indian Market' : 'Forex'}`}
      >
        {/* Sliding pill */}
        <div
          style={{
            position: 'absolute',
            left: '4px',
            width: 'calc(50% - 6px)',
            height: '24px',
            background: 'linear-gradient(135deg, #0D9E6E 0%, #22C78E 100%)',
            borderRadius: '16px',
            transform: isForex ? 'translateX(0)' : 'translateX(calc(100% + 4px))',
            transition: `transform ${SWITCH_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
            willChange: 'transform',
            boxShadow: '0 2px 6px rgba(13,158,110,0.35)',
          }}
        />

        {/* Forex Side */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '5px',
            zIndex: 1,
            transition: `color ${SWITCH_DURATION_MS}ms ease`,
            color: isForex ? '#FFFFFF' : '#94A3B8',
            fontSize: '11px',
            fontWeight: '700',
            fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: '0.04em',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="12" cy="12" r="10" />
            <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" />
            <line x1="12" y1="18" x2="12" y2="2" />
          </svg>
          FOREX
        </div>

        {/* Indian Market Side */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1,
            transition: `color ${SWITCH_DURATION_MS}ms ease`,
            color: !isForex ? '#FFFFFF' : '#94A3B8',
            fontSize: '10px',
            fontWeight: '700',
            fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: '0.02em',
            whiteSpace: 'nowrap',
          }}
        >
          INDIA MKT
        </div>
      </button>
    </div>
  );
}
