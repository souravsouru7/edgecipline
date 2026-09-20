"use client";

import React from "react";
import { useMarket } from "@/context/MarketContext";

export default function LoadingSpinner({
  message = "Loading...",
  fullPage = false,
  showProgress = false,
  currentStep = 0,
  totalSteps = 3,
}) {
  const { getThemeColors } = useMarket();
  const colors = getThemeColors();
  const accent = colors.primary || "#0D9E6E";

  const containerStyle = fullPage
    ? {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "70vh",
        width: "100%",
        gap: 20,
      }
    : {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "48px 24px",
        gap: 20,
        width: "100%",
      };

  return (
    <div style={containerStyle}>
      <style>{`
        @keyframes ls-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes ls-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.55; }
        }
        @keyframes ls-dot {
          0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
          40%            { opacity: 1; transform: scale(1); }
        }
      `}</style>

      {/* Spinner */}
      <div style={{ position: "relative", width: 64, height: 64 }}>
        {/* Rotating wrapper div — avoids SVG transform-origin issues */}
        <div style={{
          position: "absolute", inset: 0,
          animation: "ls-spin 1s linear infinite",
          transformOrigin: "50% 50%",
        }}>
          <svg width="64" height="64" viewBox="0 0 64 64" style={{ display: "block" }}>
            {/* Track */}
            <circle cx="32" cy="32" r="26" fill="none" stroke={accent} strokeWidth="3.5" strokeOpacity="0.15" />
            {/* Arc */}
            <circle
              cx="32" cy="32" r="26"
              fill="none"
              stroke={accent}
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeDasharray="55 108"
            />
          </svg>
        </div>

        {/* Center logo — fixed, not rotating */}
        <div style={{
          position: "absolute",
          top: "50%", left: "50%",
          transform: "translate(-50%, -50%)",
          width: 26, height: 26,
          animation: "ls-pulse 2s ease-in-out infinite",
        }}>
          <img
            src="/logo.webp"
            alt=""
            loading="eager"
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
            onError={(e) => {
              e.target.style.display = "none";
              const dot = e.target.parentNode;
              dot.style.width = "10px";
              dot.style.height = "10px";
              dot.style.borderRadius = "50%";
              dot.style.background = accent;
            }}
          />
        </div>
      </div>

      {/* Message */}
      <div style={{
        fontSize: 11,
        fontWeight: 700,
        color: "#64748B",
        letterSpacing: "0.12em",
        fontFamily: "'JetBrains Mono', monospace",
        textTransform: "uppercase",
      }}>
        {message}
      </div>

      {/* Animated dots */}
      <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            width: 5, height: 5, borderRadius: "50%",
            background: accent,
            animation: `ls-dot 1.2s ease-in-out ${i * 0.2}s infinite`,
          }} />
        ))}
      </div>

      {/* Progress bar */}
      {showProgress && totalSteps > 0 && (
        <div style={{ width: 140 }}>
          <div style={{ height: 3, background: `${accent}20`, borderRadius: 2, overflow: "hidden" }}>
            <div style={{
              height: "100%",
              width: `${Math.round(((currentStep + 1) / totalSteps) * 100)}%`,
              background: accent,
              borderRadius: 2,
              transition: "width 0.5s ease",
            }} />
          </div>
          <div style={{
            marginTop: 6, fontSize: "var(--fs-2xs)", color: "#94A3B8",
            fontFamily: "'JetBrains Mono',monospace",
            textAlign: "center", letterSpacing: "0.06em",
          }}>
            {currentStep + 1} / {totalSteps}
          </div>
        </div>
      )}
    </div>
  );
}
