"use client";

import { memo, useCallback, useState } from "react";
import { Skeleton } from "@/features/shared";

function StatCard({ label, value, sub, accentColor, icon, delay = 0, loading = false, tooltip }) {
  const [showTip, setShowTip] = useState(false);
  const handleEnter = useCallback(() => setShowTip(true), []);
  const handleLeave = useCallback(() => setShowTip(false), []);

  if (loading) {
    return (
      <div style={{
        background: "#FFFFFF", borderRadius: 12, border: "1px solid #E2E8F0",
        flex: "1 1 160px", overflow: "hidden",
        boxShadow: "0 2px 12px rgba(15,25,35,0.06), 0 1px 3px rgba(15,25,35,0.04)",
      }}>
        <div style={{ height: 3, background: `linear-gradient(90deg,${accentColor},${accentColor}22)` }} />
        <div style={{ padding: "20px 20px 16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
            <Skeleton width="60px" height="10px" />
            <Skeleton width="32px" height="32px" style={{ borderRadius: 8 }} />
          </div>
          <div style={{ marginBottom: 6 }}>
            <Skeleton width="90px" height="28px" />
          </div>
          <Skeleton width="70px" height="10px" />
        </div>
      </div>
    );
  }

  const displayValue = (value !== undefined && value !== null && !Number.isNaN(value)) ? value : (value || 0);
  return (
    <div
      style={{
        background: "#FFFFFF", borderRadius: 12, border: "1px solid #E2E8F0",
        flex: "1 1 160px", overflow: "visible",
        boxShadow: "0 2px 12px rgba(15,25,35,0.06), 0 1px 3px rgba(15,25,35,0.04)",
        animation: `fadeUp 0.5s ease ${delay}s both`, position: "relative",
      }}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <div style={{ height: 3, background: `linear-gradient(90deg,${accentColor},${accentColor}22)`, borderRadius: "12px 12px 0 0" }} />
      <div style={{ padding: "20px 20px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <span style={{ fontSize: 10, color: "#94A3B8", letterSpacing: "0.12em", fontFamily: "'JetBrains Mono',monospace", fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}>
            {label}
            {tooltip && (
              <span style={{ width: 13, height: 13, borderRadius: "50%", background: "#E2E8F0", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 900, color: "#64748B", cursor: "help", flexShrink: 0 }}>?</span>
            )}
          </span>
          {icon && (
            <div style={{ width: 32, height: 32, borderRadius: 8, background: `${accentColor}12`, display: "flex", alignItems: "center", justifyContent: "center", color: accentColor }}>
              {icon}
            </div>
          )}
        </div>
        <div style={{ fontSize: 30, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: accentColor, lineHeight: 1, marginBottom: 6 }}>
          {displayValue}
        </div>
        {sub && <div style={{ fontSize: 10, color: "#94A3B8", letterSpacing: "0.06em", fontFamily: "'Plus Jakarta Sans',sans-serif" }}>{sub}</div>}
      </div>
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

export default memo(StatCard);
