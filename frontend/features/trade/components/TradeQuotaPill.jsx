"use client";

import { useTradeQuota } from "@/features/trade/hooks/useTradeQuota";
import { marketLabel } from "@/features/trade/lib/tradeLimit";

// "1 free trade left" chip for the add / upload screens. Server-driven: it
// renders nothing for premium accounts and for builds where the free limit is
// not enforced, because in both cases the quota endpoint reports no limit.
// Market-scoped — the hook's key includes the market, so the Forex form
// never shows the Indian count.
export function quotaPillLabel(quota) {
  if (!quota || quota.premium || quota.limit == null) return null;
  const remaining = Number(quota.remaining) || 0;
  if (remaining <= 0) return "No free trades left";
  return `${remaining} free ${remaining === 1 ? "trade" : "trades"} left`;
}

export default function TradeQuotaPill({ marketType, style }) {
  const { quota } = useTradeQuota(marketType);
  const label = quotaPillLabel(quota);
  if (!label) return null;

  const exhausted = (Number(quota.remaining) || 0) <= 0;
  const low = !exhausted && Number(quota.remaining) === 1;
  const colour = exhausted ? "#D63B3B" : low ? "#B8860B" : "#0D9E6E";

  return (
    <span
      role="status"
      aria-live="polite"
      title={`Free accounts can log ${quota.limit} ${marketLabel(quota.market)} trades`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 11px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: colour,
        background: `${colour}14`,
        border: `1px solid ${colour}33`,
        fontFamily: "'Plus Jakarta Sans', sans-serif",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 999, background: colour }} />
      {label}
    </span>
  );
}
