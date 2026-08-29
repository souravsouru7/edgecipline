// The backend refuses a create past the free allowance with 402
// TRADE_LIMIT_REACHED. Detecting it here keeps every call site from
// re-deriving the shape of an apiClient error.
export const TRADE_LIMIT_ERROR_CODE = "TRADE_LIMIT_REACHED";

export function isTradeLimitError(error) {
  return error?.status === 402 && error?.data?.errorCode === TRADE_LIMIT_ERROR_CODE;
}

// { market, premium, limit, used, remaining } — present on the 402 body and on
// the GET /quota response.
export function tradeLimitQuota(error) {
  return error?.data?.details?.quota || null;
}

export function tradeLimitRequested(error) {
  return error?.data?.details?.requested ?? null;
}

export function marketLabel(market) {
  return market === "Indian_Market" ? "Indian market" : "Forex";
}
