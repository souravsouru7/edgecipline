"use client";

import { useMarket, MARKETS } from '@/context/MarketContext';
import { useRouter, usePathname } from 'next/navigation';

export default function MarketSwitcher() {
  const { currentMarket, toggleMarket, getCurrencySymbol, getMarketLabel } = useMarket();
  const router = useRouter();
  const pathname = usePathname();

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

    toggleMarket(targetMarket);
    router.push(newPath);
  };

  const isForex = currentMarket === MARKETS.FOREX;
  const currencySymbol = getCurrencySymbol();

  return (
    <div className="market-switcher-wrap" style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    }}>
      {/* Toggle Container */}
      <button
        onClick={handleSwitch}
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
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
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
            left: isForex ? '4px' : 'calc(50% + 2px)',
            width: 'calc(50% - 6px)',
            height: '24px',
            background: 'linear-gradient(135deg, #0D9E6E 0%, #22C78E 100%)',
            borderRadius: '16px',
            transition: 'left 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
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
            transition: 'color 0.3s ease',
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
            transition: 'color 0.3s ease',
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

      {/* Currency Symbol Indicator */}
      <div
        className="market-currency-badge"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '34px',
          height: '34px',
          background: 'linear-gradient(135deg, #0D9E6E 0%, #22C78E 100%)',
          borderRadius: '10px',
          boxShadow: '0 2px 8px rgba(13, 158, 110, 0.3)',
          color: '#FFFFFF',
          fontSize: '16px',
          fontWeight: '700',
          fontFamily: "'JetBrains Mono', monospace",
          transition: 'all 0.3s ease',
        }}
        title={`Current: ${getMarketLabel()}`}
      >
        {currencySymbol}
      </div>

      {/* Market Status Label - hidden on mobile */}
      <div
        className="market-status-label"
        style={{
          fontSize: '10px',
          fontWeight: '600',
          fontFamily: "'Plus Jakarta Sans', sans-serif",
          color: '#0D9E6E',
          background: 'rgba(13, 158, 110, 0.08)',
          padding: '6px 12px',
          borderRadius: '8px',
          border: '1px solid rgba(13, 158, 110, 0.25)',
          whiteSpace: 'nowrap',
          transition: 'all 0.3s ease',
        }}
      >
        {getMarketLabel()}
      </div>

      <style>{`
        @media (max-width: 768px) {
          .market-currency-badge { display: none !important; }
          .market-status-label   { display: none !important; }
        }
      `}</style>
    </div>
  );
}
