"use client";

import Link from "next/link";

/**
 * TradeRow — desktop table row for a single trade.
 */
export default function TradeRow({ trade, onDelete, idx, isDeleting }) {
  const bull = parseFloat(trade.profit) >= 0;
  const tradeDate = new Date(trade.tradeDate || trade.createdAt);
  return (
    <tr
      style={{ borderBottom: "1px solid #E2E8F0", animation: isDeleting ? "tradeExit 0.28s ease forwards" : `fadeUp 0.4s ease ${idx * 0.05}s both`, transition: "background 0.2s", pointerEvents: isDeleting ? "none" : "auto" }}
      onMouseEnter={e => e.currentTarget.style.background = "#F8F6F2"}
      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
    >
      <td style={{ padding: "14px 16px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "#64748B" }}>
          <span>{tradeDate.toLocaleDateString()}</span>
          <span>{tradeDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
      </td>
      {/* Pair */}
      <td style={{ padding: "14px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: bull ? "#0D9E6E" : "#D63B3B", boxShadow: bull ? "0 0 6px #0D9E6E" : "0 0 6px #D63B3B", flexShrink: 0 }} />
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: trade.pair ? "#0F1923" : "#94A3B8", fontWeight: 600 }}>{trade.pair || "—"}</span>
        </div>
      </td>

      {/* Type */}
      <td style={{ padding: "14px 16px" }}>
        {(() => {
          const isLong = trade.type?.toUpperCase() === "BUY" || trade.type?.toUpperCase() === "LONG";
          return (
            <span style={{
              fontSize: 9, letterSpacing: "0.12em",
              color: isLong ? "#0D9E6E" : "#D63B3B",
              background: isLong ? "rgba(13,158,110,0.1)" : "rgba(214,59,59,0.1)",
              border: `1px solid ${isLong ? "rgba(13,158,110,0.3)" : "rgba(214,59,59,0.3)"}`,
              borderRadius: 20, padding: "3px 10px", fontFamily: "'JetBrains Mono',monospace",
            }}>
              {isLong ? "▲ LONG" : "▼ SHORT"}
            </span>
          );
        })()}
      </td>

      {/* Entry Basis */}
      <td style={{ padding: "14px 16px" }}>
        <span style={{
          fontSize: 9, letterSpacing: "0.08em",
          color: trade.entryBasis === "Plan" ? "#4A5568" : trade.entryBasis === "Emotion" ? "#D63B3B" : "#B8860B",
          fontFamily: "'JetBrains Mono',monospace", fontWeight: 600, textTransform: "uppercase",
        }}>
          {trade.entryBasis === "Custom" ? trade.entryBasisCustom : trade.entryBasis || "Plan"}
        </span>
      </td>

      {/* P&L */}
      <td style={{ padding: "14px 16px" }}>
        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, fontWeight: 700, color: bull ? "#0D9E6E" : "#D63B3B" }}>
          {bull ? "+" : ""}{trade.profit}
        </span>
      </td>

      {/* Actions */}
      <td style={{ padding: "14px 16px" }}>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Link
            href={`/trades/view?id=${trade._id}`}
            style={{ fontSize: 9, letterSpacing: "0.1em", fontFamily: "'JetBrains Mono',monospace", color: "#0D9E6E", border: "1px solid rgba(13,158,110,0.3)", background: "rgba(13,158,110,0.05)", borderRadius: 4, padding: "5px 12px", textDecoration: "none", transition: "all 0.2s" }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(13,158,110,0.12)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(13,158,110,0.05)"; }}
          >VIEW →</Link>
          <button
            onClick={() => onDelete(trade)}
            style={{ fontSize: 9, letterSpacing: "0.1em", fontFamily: "'JetBrains Mono',monospace", color: "#D63B3B", border: "1px solid rgba(214,59,59,0.3)", background: "rgba(214,59,59,0.05)", borderRadius: 4, padding: "5px 12px", cursor: "pointer", transition: "all 0.2s" }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(214,59,59,0.12)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(214,59,59,0.05)"; }}
          >DELETE</button>
        </div>
      </td>
    </tr>
  );
}
