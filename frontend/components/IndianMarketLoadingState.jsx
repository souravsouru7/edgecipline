import AppLoadingShell from "@/components/AppLoadingShell";

export default function IndianMarketLoadingState({
  title = "Loading Indian Market",
  subtitle = "Preparing NSE / BSE workspace",
  showHeader = false,
  showTicker = false,
  dense = false,
}) {
  return (
    <AppLoadingShell
      title={title}
      subtitle={subtitle}
      market="indian"
      showHeader={showHeader}
      showTicker={showTicker}
      dense={dense}
      fullPage={showHeader}
    />
  );
}
