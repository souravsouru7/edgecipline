"use client";

import Link from "next/link";
import { Crown } from "lucide-react";

// Compact quota indicator. Premium users see a quiet "Unlimited" badge so they
// know the feature is on; free users see the remaining count with a path to
// upgrade once they're near the wall.
export default function CoachQuotaPill({ quota }) {
  if (!quota) return null;

  if (quota.premium) {
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        fontSize: 10, fontWeight: 800, color: "#7C3AED",
        background: "rgba(139, 92, 246, 0.12)", padding: "3px 8px",
        borderRadius: 999, letterSpacing: "0.04em", textTransform: "uppercase",
      }}>
        <Crown size={11} /> Unlimited
      </span>
    );
  }

  const low = quota.remaining <= 1;
  return (
    <Link
      href="/profile?section=billing"
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        fontSize: 10, fontWeight: 800,
        color: low ? "#D63B3B" : "#475569",
        background: low ? "rgba(214,59,59,0.08)" : "#F1F5F9",
        padding: "3px 8px", borderRadius: 999,
        letterSpacing: "0.04em", textTransform: "uppercase",
        textDecoration: "none",
      }}
    >
      {quota.remaining}/{quota.limit} this week
    </Link>
  );
}
