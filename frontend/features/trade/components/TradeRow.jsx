"use client";

import { memo, useCallback, useMemo } from "react";
import Link from "next/link";

const getDirection = (type) => {
  const normalized = type?.toUpperCase();
  const isLong = normalized === "BUY" || normalized === "LONG";

  return {
    label: isLong ? "LONG" : "SHORT",
    color: isLong ? "#0D9E6E" : "#D63B3B",
    background: isLong ? "rgba(13,158,110,0.1)" : "rgba(214,59,59,0.1)",
    border: isLong ? "rgba(13,158,110,0.3)" : "rgba(214,59,59,0.3)",
  };
};

function TradeRow({ trade, onDelete, idx, isDeleting }) {
  const bull = useMemo(() => parseFloat(trade.profit) >= 0, [trade.profit]);
  const tradeDate = useMemo(() => new Date(trade.tradeDate || trade.createdAt), [trade.tradeDate, trade.createdAt]);
  const direction = useMemo(() => getDirection(trade.type), [trade.type]);
  const entryBasis = useMemo(
    () => trade.entryBasis === "Custom" ? trade.entryBasisCustom : trade.entryBasis || "Plan",
    [trade.entryBasis, trade.entryBasisCustom],
  );
  const entryBasisColor = useMemo(
    () => trade.entryBasis === "Plan" ? "#4A5568" : trade.entryBasis === "Emotion" ? "#D63B3B" : "#B8860B",
    [trade.entryBasis],
  );
  const handleDelete = useCallback(() => onDelete(trade), [onDelete, trade]);

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
      <td style={{ padding: "14px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: bull ? "#0D9E6E" : "#D63B3B", boxShadow: bull ? "0 0 6px #0D9E6E" : "0 0 6px #D63B3B", flexShrink: 0 }} />
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: trade.pair ? "#0F1923" : "#94A3B8", fontWeight: 600 }}>{trade.pair || "-"}</span>
        </div>
      </td>
      <td style={{ padding: "14px 16px" }}>
        <span style={{
          fontSize: 9,
          letterSpacing: "0.12em",
          color: direction.color,
          background: direction.background,
          border: `1px solid ${direction.border}`,
          borderRadius: 20,
          padding: "3px 10px",
          fontFamily: "'JetBrains Mono',monospace",
        }}>
          {direction.label}
        </span>
      </td>
      <td style={{ padding: "14px 16px" }}>
        <span style={{
          fontSize: 9,
          letterSpacing: "0.08em",
          color: entryBasisColor,
          fontFamily: "'JetBrains Mono',monospace",
          fontWeight: 600,
          textTransform: "uppercase",
        }}>
          {entryBasis}
        </span>
      </td>
      <td style={{ padding: "14px 16px" }}>
        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, fontWeight: 700, color: bull ? "#0D9E6E" : "#D63B3B" }}>
          {bull ? "+" : ""}{trade.profit}
        </span>
      </td>
      <td style={{ padding: "14px 16px" }}>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Link
            href={`/trades/view?id=${trade._id}`}
            style={{ fontSize: 9, letterSpacing: "0.1em", fontFamily: "'JetBrains Mono',monospace", color: "#0D9E6E", border: "1px solid rgba(13,158,110,0.3)", background: "rgba(13,158,110,0.05)", borderRadius: 4, padding: "5px 12px", textDecoration: "none", transition: "all 0.2s" }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(13,158,110,0.12)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(13,158,110,0.05)"; }}
          >VIEW -&gt;</Link>
          <button
            onClick={handleDelete}
            style={{ fontSize: 9, letterSpacing: "0.1em", fontFamily: "'JetBrains Mono',monospace", color: "#D63B3B", border: "1px solid rgba(214,59,59,0.3)", background: "rgba(214,59,59,0.05)", borderRadius: 4, padding: "5px 12px", cursor: "pointer", transition: "all 0.2s" }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(214,59,59,0.12)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(214,59,59,0.05)"; }}
          >DELETE</button>
        </div>
      </td>
    </tr>
  );
}

export default memo(TradeRow);
