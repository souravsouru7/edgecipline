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

export function invalidateTradeDependentQueries(queryClient) {
  if (!queryClient) return [];

  return TRADE_DEPENDENT_QUERY_KEYS.map((queryKey) =>
    queryClient.invalidateQueries({ queryKey, exact: false })
  );
}

export { TRADE_DEPENDENT_QUERY_KEYS };
