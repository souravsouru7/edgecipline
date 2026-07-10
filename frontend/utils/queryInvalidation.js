const TRADE_DEPENDENT_QUERY_KEYS = [
  ["trades"],
  ["dashboard"],
  ["analytics"],
  ["tradingDNA"],
  ["psychologyTimeline"],
  ["discipline"],
  ["patterns"],
  ["aiCoach"],
  ["coachFeed"],
  ["weeklyReports"],
  ["reports"],
];

const TRADE_QUERY_FRESHNESS_OPTIONS = Object.freeze({
  staleTime: 0,
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
});

function invalidateQueryKeys(queryClient, queryKeys) {
  if (!queryClient) return [];

  return queryKeys.map((queryKey) =>
    queryClient.invalidateQueries({ queryKey, exact: false })
  );
}

export function invalidateTradeDependentQueries(queryClient) {
  return invalidateQueryKeys(queryClient, TRADE_DEPENDENT_QUERY_KEYS);
}

export function invalidateSetupDependentQueries(queryClient) {
  return invalidateQueryKeys(queryClient, [
    ["setups"],
    ...TRADE_DEPENDENT_QUERY_KEYS,
  ]);
}

export { TRADE_DEPENDENT_QUERY_KEYS, TRADE_QUERY_FRESHNESS_OPTIONS };
