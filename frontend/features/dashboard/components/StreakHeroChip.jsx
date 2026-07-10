"use client";

import Link from "next/link";

// Hero-area chip that anchors the user's identity as a disciplined trader.
// Tap to open the streak detail page. Three visual states:
//   - alive   : warm amber, flame icon, "N day discipline streak"
//   - at-risk : muted amber, gentle "Don't lose it today" sub
//   - dormant : neutral grey, encouraging restart copy (no shame)
export default function StreakHeroChip({ streaks }) {
  const journal = streaks?.journal;
  const current = journal?.current ?? 0;
  const atRisk = journal?.atRisk ?? false;

  let label;
  let sub;
  let palette;

  if (current >= 1 && !atRisk) {
    label = `${current}-day discipline streak`;
    sub = current === 1 ? "Day one — keep going" : "Tap to view streak";
    palette = ALIVE;
  } else if (current >= 1 && atRisk) {
    label = `${current}-day streak — at risk`;
    sub = "Log today or mark Sat Out";
    palette = AT_RISK;
  } else {
    label = "Start a new streak";
    sub = "Log one trade to begin";
    palette = DORMANT;
  }

  return (
    <Link
      href="/streaks"
      aria-label={`Discipline streak: ${label}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 14px",
        borderRadius: 999,
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        textDecoration: "none",
        color: palette.fg,
        transition: "transform 120ms ease, box-shadow 120ms ease",
      }}
    >
      <span aria-hidden style={{ fontSize: 16, lineHeight: 1 }}>{palette.icon}</span>
      <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
        <span style={{ fontSize: 12, fontWeight: 900, letterSpacing: 0.2 }}>{label}</span>
        <span style={{ fontSize: 10, opacity: 0.75 }}>{sub}</span>
      </span>
    </Link>
  );
}

const ALIVE = {
  bg:     "linear-gradient(135deg, #FFF7E0 0%, #FFE2B0 100%)",
  border: "#F59E0B",
  fg:     "#7A3E0B",
  icon:   "🔥",
};
const AT_RISK = {
  bg:     "linear-gradient(135deg, #FFF1E0 0%, #FFD9B0 100%)",
  border: "#FB923C",
  fg:     "#7C2D12",
  icon:   "🔥",
};
const DORMANT = {
  bg:     "#F1F5F9",
  border: "#CBD5E1",
  fg:     "#475569",
  icon:   "✨",
};
