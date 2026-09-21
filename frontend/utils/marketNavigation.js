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

/**
 * Where the market switcher sends the user when they flip markets while on
 * `pathname`. Mirrors each page onto its counterpart in the other tree; pages
 * with no counterpart (checklist, coach, intelligence) keep their path and
 * rely on MarketContext instead.
 */
export const getMarketSwitchPath = (pathname, targetMarket) => {
  let newPath = pathname || "/dashboard";

  if (targetMarket === MARKETS.FOREX) {
    if (newPath.startsWith("/indian-market")) {
      newPath = newPath.replace("/indian-market", "");
    }
    if (newPath === "" || newPath === "/") newPath = "/dashboard";
    if (newPath === "/weekly-reports") {
      newPath = "/weekly-reports?market=Forex";
    }
    return newPath;
  }

  if (newPath === "/" || newPath === "/dashboard") {
    return "/indian-market/dashboard";
  }
  if (
    newPath === "/trades" ||
    newPath.startsWith("/trades/") ||
    newPath === "/add-trade" ||
    newPath === "/upload-trade" ||
    newPath === "/setups" ||
    newPath === "/discipline"
  ) {
    return `/indian-market${newPath}`;
  }
  if (newPath === "/analytics" || newPath.startsWith("/analytics/")) {
    return "/indian-market/analytics";
  }
  if (newPath === "/weekly-reports") {
    return "/weekly-reports?market=Indian_Market";
  }
  return newPath;
};

/**
 * Both dashboard routes render the same component (MarketDashboardPage), which
 * reads its market from the URL. A switch between them therefore needs no
 * route transition at all: updating the URL in place is enough, and nothing
 * above the market-specific content has to remount. Every other page pair is
 * a separate implementation and still needs a real navigation.
 */
export const isShallowMarketSwitchRoute = (pathname) =>
  pathname === "/dashboard" || pathname === "/indian-market/dashboard";
