import IndianMarketLoadingState from "@/components/IndianMarketLoadingState";

export default function Loading() {
  return (
    <IndianMarketLoadingState
      title="Loading Indian Market"
      subtitle="Preparing NSE / BSE workspace"
      showHeader
      showTicker
    />
  );
}
