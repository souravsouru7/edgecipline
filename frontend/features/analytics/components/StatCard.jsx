"use client";

import { useState } from "react";
import { Skeleton } from "@/features/shared";

const colors = {
  bull: "#0D9E6E", bear: "#D63B3B", gold: "#B8860B",
  primary: "#0F1923", secondary: "#4A5568", muted: "#94A3B8",
  bg: "#F0EEE9", card: "#FFFFFF", border: "#E2E8F0",
};

export default function StatCard({
  label,
  value,
  sub,
  color = colors.primary,
  icon,
  delay = 0,
  loading = false,
  tooltip
}) {
  const [showTip, setShowTip] = useState(false);

  if (loading) {
    return (
      <div style={{
        background: colors.card, borderRadius: 12, border: `1px solid ${colors.border}`,
        padding: "20px", boxShadow: "0 2px 8px rgba(15,25,35,0.04)",
        flex: "1 1 180px", minWidth: 160,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <Skeleton width="60px" height="10px" />
          <Skeleton width="28px" height="28px" style={{ borderRadius: 6 }} />
        </div>
        <div style={{ marginBottom: 8 }}>
          <Skeleton width="100px" height="28px" />
        </div>
        <Skeleton width="80px" height="10px" />
      </div>
    );
  }

  const formattedValue = typeof value === "string" && value.startsWith("$-")
    ? "-$" + value.substring(2)
    : value;

  const cleanValue = typeof value === "string" ? value.replace(/[$,%]/g, "") : value;
  const isInfinite = cleanValue === "∞";

  return (
    <div
      style={{
        background: colors.card, borderRadius: 12, border: `1px solid ${colors.border}`,
        padding: "20px", boxShadow: "0 2px 12px rgba(15,25,35,0.06)",
        animation: `fadeUp 0.5s ease ${delay}s both`, flex: "1 1 180px", minWidth: 160,
        transition: "transform 0.2s, box-shadow 0.2s",
        cursor: "default", position: "relative", overflow: "visible",
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = "0 8px 16px rgba(15,25,35,0.08)";
        setShowTip(true);
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "0 2px 12px rgba(15,25,35,0.06)";
        setShowTip(false);
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <span style={{ fontSize: "var(--fs-2xs)", color: colors.muted, letterSpacing: "0.12em", fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>
          {label}
          {tooltip && (
            <span style={{ width: 13, height: 13, borderRadius: "50%", background: "#E2E8F0", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "var(--fs-2xs)", fontWeight: 900, color: "#64748B", cursor: "help", flexShrink: 0 }}>?</span>
          )}
        </span>
        {icon && (
          <div style={{ width: 28, height: 28, borderRadius: 6, background: `${color}12`, display: "flex", alignItems: "center", justifyContent: "center", color }}>
            {icon}
          </div>
        )}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color, lineHeight: 1.2, marginBottom: 6 }}>
        {formattedValue}
      </div>
      {sub && (
        <div style={{ fontSize: "var(--fs-2xs)", color: label?.toLowerCase().includes("profit factor") && isInfinite ? colors.bull : colors.muted, letterSpacing: "0.06em", fontWeight: isInfinite ? 700 : 500 }}>
          {label?.toLowerCase().includes("profit factor") && isInfinite ? "Perfect Edge" : sub}
        </div>
      )}
      {tooltip && showTip && (
        <div style={{
          position: "absolute",
          bottom: "calc(100% + 8px)",
          left: "50%",
          transform: "translateX(-50%)",
          background: "#0F1923",
          color: "#E2E8F0",
          fontSize: 11,
          padding: "10px 14px",
          borderRadius: 10,
          width: 220,
          zIndex: 200,
          lineHeight: 1.6,
          pointerEvents: "none",
          boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
        }}>
          {tooltip}
          <div style={{ position: "absolute", bottom: -5, left: "50%", transform: "translateX(-50%)", width: 10, height: 10, background: "#0F1923", clipPath: "polygon(0 0, 100% 0, 50% 100%)" }} />
        </div>
      )}
    </div>
  );
}
