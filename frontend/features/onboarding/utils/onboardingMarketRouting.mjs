const INDIAN_MARKET = "Indian_Market";

export function getCanonicalOnboardingPath(pathname, preferredMarket) {
  const basePath = pathname.startsWith("/indian-market")
    ? pathname.slice("/indian-market".length) || "/dashboard"
    : pathname;

  return preferredMarket === INDIAN_MARKET
    ? `/indian-market${basePath}`
    : basePath;
}

export function getOnboardingUploadPath(market, { demo = false } = {}) {
  const normalizedMarket = market === INDIAN_MARKET ? INDIAN_MARKET : "Forex";
  const marketRoot = normalizedMarket === INDIAN_MARKET ? "/indian-market" : "";
  const params = new URLSearchParams({
    onboarding: "1",
    market: normalizedMarket,
  });
  if (demo) params.set("demo", "1");
  return `${marketRoot}/upload-trade?${params.toString()}`;
}
