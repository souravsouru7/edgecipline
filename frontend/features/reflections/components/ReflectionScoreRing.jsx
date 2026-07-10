"use client";

import { memo } from "react";

// Compact SVG ring used in the dashboard card. Stroke is the same colour as
// the dashboard greens/ambers so the card reads as part of the design system.
function ReflectionScoreRing({ score = 0, size = 60, stroke = 6 }) {
  const safeScore = Math.max(0, Math.min(100, Number(score) || 0));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (safeScore / 100) * circumference;
  const color = safeScore >= 70 ? "#0D9E6E" : safeScore >= 40 ? "#F59E0B" : "#D63B3B";

  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} role="img" aria-label={`Weekly reflection score ${safeScore} of 100`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#E2E8F0"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dashoffset 0.5s ease" }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          color,
          fontWeight: 800,
          fontFamily: "'JetBrains Mono',monospace",
        }}
      >
        <span style={{ fontSize: size / 4, lineHeight: 1 }}>{safeScore}</span>
        <span style={{ fontSize: 8, opacity: 0.7, marginTop: 2 }}>/100</span>
      </div>
    </div>
  );
}

export default memo(ReflectionScoreRing);
