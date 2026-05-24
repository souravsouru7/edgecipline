"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, Suspense } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

// Market types
export const MARKETS = {
  FOREX: 'Forex',
  INDIAN_MARKET: 'Indian_Market'
};

// Default market
const DEFAULT_MARKET = MARKETS.FOREX;

// Storage key for persistence
const STORAGE_KEY = 'currentMarket';

const MarketContext = createContext(null);

// Helper component to handle market syncing with search params
// This is separated to be wrapped in Suspense for static generation
function MarketSync({ currentMarket, setCurrentMarket }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!pathname) return;

    let targetMarket = null;

    // 1. Check for explicit Indian Market path
    if (pathname.startsWith('/indian-market')) {
      targetMarket = MARKETS.INDIAN_MARKET;
    }
    // 2. Check for market query parameter
    else {
      const marketParam = searchParams.get('market');
      if (marketParam && Object.values(MARKETS).includes(marketParam)) {
        targetMarket = marketParam;
      }
      // 3. Fallback to Forex for standard routes
      else {
        const isStandardRoute =
          pathname === '/dashboard' ||
          pathname === '/trades' ||
          pathname === '/analytics' ||
          pathname === '/add-trade' ||
          pathname === '/upload-trade' ||
          pathname === '/';

        if (isStandardRoute) {
          targetMarket = MARKETS.FOREX;
        }
      }
    }

    // Only update if we have a target market and it's different from the current one
    if (targetMarket && currentMarket !== targetMarket) {
      setCurrentMarket(targetMarket);
      try {
        localStorage.setItem(STORAGE_KEY, targetMarket);
      } catch (e) {
        // Ignore localStorage errors during SSR
      }
    }
  }, [pathname, searchParams, currentMarket, setCurrentMarket]);

  return null;
}

export function MarketProvider({ children }) {
  const [currentMarket, setCurrentMarket] = useState(DEFAULT_MARKET);
  const [isLoading, setIsLoading] = useState(true);

  // Load saved market preference on mount
  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        const savedMarket = localStorage.getItem(STORAGE_KEY);
        if (savedMarket && Object.values(MARKETS).includes(savedMarket)) {
          setCurrentMarket(savedMarket);
        }
      }
    } catch (error) {
      console.error('Error loading market preference:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Save market preference whenever it changes
  const toggleMarket = useCallback((market) => {
    if (!Object.values(MARKETS).includes(market)) {
      console.error('Invalid market type:', market);
      return;
    }

    setCurrentMarket(market);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, market);
      window.dispatchEvent(new CustomEvent('marketChanged', { detail: { market } }));
    }
  }, []);

  // Toggle between Forex and Indian Market
  const switchMarket = useCallback(() => {
    setCurrentMarket(prev => {
      const nextMarket = prev === MARKETS.FOREX ? MARKETS.INDIAN_MARKET : MARKETS.FOREX;
      if (typeof window !== "undefined") {
        localStorage.setItem(STORAGE_KEY, nextMarket);
        window.dispatchEvent(new CustomEvent('marketChanged', { detail: { market: nextMarket } }));
      }
      return nextMarket;
    });
  }, []);

  // Get currency symbol for current market
  const getCurrencySymbol = () => {
    return currentMarket === MARKETS.FOREX ? '$' : '₹';
  };

  // Format currency amount
  const formatCurrency = (amount, showSymbol = true) => {
    const symbol = getCurrencySymbol();
    const formatted = Math.abs(amount).toFixed(2);
    const sign = amount < 0 ? '-' : '';
    return showSymbol ? `${sign}${symbol}${formatted}` : `${sign}${formatted}`;
  };

  // Get market-specific label
  const getMarketLabel = () => {
    return currentMarket === MARKETS.FOREX ? 'Forex' : 'Indian Market';
  };

  // Get market-specific theme colors
  const getThemeColors = () => {
    if (currentMarket === MARKETS.FOREX) {
      return {
        primary: '#0D9E6E',
        secondary: '#0F1923',
        background: '#F0EEE9',
        accent: '#B8860B',
        bull: '#0D9E6E',
        bear: '#D63B3B'
      };
    } else {
      // Same as Forex
      return {
        primary: '#0D9E6E',
        secondary: '#0F1923',
        background: '#F0EEE9',
        accent: '#B8860B',
        bull: '#0D9E6E',
        bear: '#D63B3B'
      };
    }
  };

  const value = {
    currentMarket,
    toggleMarket,
    switchMarket,
    getCurrencySymbol,
    formatCurrency,
    getMarketLabel,
    getThemeColors,
    isLoading,
    isForex: currentMarket === MARKETS.FOREX,
    isIndianMarket: currentMarket === MARKETS.INDIAN_MARKET
  };

  return (
    <MarketContext.Provider value={value}>
      <Suspense fallback={null}>
        <MarketSync currentMarket={currentMarket} setCurrentMarket={setCurrentMarket} />
      </Suspense>
      {children}
    </MarketContext.Provider>
  );
}

// Custom hook to use market context
export function useMarket() {
  const context = useContext(MarketContext);
  if (!context) {
    throw new Error('useMarket must be used within a MarketProvider');
  }
  return context;
}

export default MarketContext;
