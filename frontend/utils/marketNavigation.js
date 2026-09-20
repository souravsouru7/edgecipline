import { MARKETS } from "@/context/MarketContext";

/**
 * Market-aware routes. Indian Market pages live under /indian-market; Forex
 * pages are at the root. Keep every "which URL for this market" decision here
 * so the two trees cannot drift.
 */
const marketRoot = (market) => (market === MARKETS.INDIAN_MARKET ? "/indian-market" : "");

export const getDashboardUrl = (market) => `${marketRoot(market)}/dashboard`;
export const getAddTradeUrl = (market) => `${marketRoot(market)}/add-trade`;
export const getUploadTradeUrl = (market) => `${marketRoot(market)}/upload-trade`;
export const getAnalyticsUrl = (market) => `${marketRoot(market)}/analytics`;
export const getTradesUrl = (market) => `${marketRoot(market)}/trades`;
export const getSetupsUrl = (market) => `${marketRoot(market)}/setups`;
export const getEditTradeUrl = (id, market) => `${getTradesUrl(market)}/edit?id=${id}`;
export const getTradeDetailUrl = (id, market) => `${getTradesUrl(market)}/view?id=${id}`;

// First-run flow: after picking a market the user is sent to build their
// first setup, with the flag that tells the setups page to run its tour.
export const getOnboardingSetupsUrl = (market) => `${getSetupsUrl(market)}?onboarding=1`;

/**
 * Check if current path is for Indian Market
 */
export const isIndianMarketPath = (pathname) => Boolean(pathname?.startsWith("/indian-market"));

/**
 * Convert a Forex path to its Indian Market equivalent
 */
export const toIndianMarketPath = (pathname) => {
  if (!pathname || pathname.startsWith("/indian-market")) return pathname;
  return `/indian-market${pathname}`;
};

/**
 * Convert an Indian Market path to its Forex equivalent
 */
export const toForexPath = (pathname) => {
  if (!pathname || !pathname.startsWith("/indian-market")) return pathname;
  return pathname.replace("/indian-market", "") || "/dashboard";
};
