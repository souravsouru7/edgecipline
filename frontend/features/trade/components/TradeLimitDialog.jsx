"use client";

import SmartPaywall from "@/components/SmartPaywall";
import { canShowPurchaseUI } from "@/config/payments";
import { marketLabel } from "@/features/trade/lib/tradeLimit";

// Shown when a create is refused for exceeding the free allowance.
//
// SmartPaywall renders NOTHING when the purchase surface is compiled out
// (NEXT_PUBLIC_PAYMENTS_ENABLED=false, which the mobile store policies
// require). Routing a blocked user straight there would leave them clicking
// Save against total silence, so this component owns that fork explicitly:
// offer checkout where checkout exists, and otherwise say plainly what
// happened and what they can do instead.
export default function TradeLimitDialog({ open, onClose, quota, requested = null }) {
  if (!open) return null;

  if (canShowPurchaseUI()) {
    return <SmartPaywall isOpen={open} onClose={onClose} variant="trade-limit" />;
  }

  const label = marketLabel(quota?.market);
  const limit = quota?.limit ?? 2;
  const remaining = quota?.remaining ?? 0;
  const overAsk = requested && remaining > 0 && requested > remaining;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="trade-limit-title"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(15,25,35,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          background: "#FFFFFF", borderRadius: 20, padding: 28,
          width: "100%", maxWidth: 460,
          border: "1px solid rgba(226,232,240,0.8)",
          boxShadow: "0 40px 100px -20px rgba(0,0,0,0.35)",
          fontFamily: "'Plus Jakarta Sans',sans-serif",
        }}
      >
        <div style={{
          display: "inline-block", fontSize: 11, fontWeight: 800, letterSpacing: "0.06em",
          color: "#B8860B", background: "rgba(184,134,11,0.12)",
          borderRadius: 999, padding: "4px 10px", marginBottom: 12,
        }}>
          FREE PLAN LIMIT
        </div>

        <h2 id="trade-limit-title" style={{ fontSize: 19, fontWeight: 800, color: "#0F1923", margin: "0 0 8px" }}>
          {overAsk
            ? `That import needs ${requested} entries`
            : `You've used your ${limit} free ${label} trades`}
        </h2>

        <p style={{ fontSize: 13, color: "#475569", lineHeight: 1.65, margin: "0 0 8px" }}>
          {overAsk
            ? `Only ${remaining} free ${label} ${remaining === 1 ? "entry" : "entries"} remain, so none of them were saved — nothing is half-imported.`
            : `Free accounts can log ${limit} ${label} trades. Your existing trades and analytics stay fully available to read.`}
        </p>

        <p style={{ fontSize: 13, color: "#475569", lineHeight: 1.65, margin: "0 0 20px" }}>
          Upgrades aren&apos;t available in this build. Open Edgecipline on the web to upgrade,
          or contact support if you think this is wrong.
        </p>

        <button
          type="button"
          onClick={onClose}
          style={{
            width: "100%", padding: 14,
            background: "linear-gradient(135deg, #0F1923 0%, #1e293b 100%)",
            color: "#FFFFFF", border: "none", borderRadius: 12,
            fontSize: 14, fontWeight: 800, cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Got it
        </button>
      </div>
    </div>
  );
}
