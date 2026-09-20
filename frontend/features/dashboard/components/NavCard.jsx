"use client";

import Link from "next/link";

const colors = {
  primary: "#0F1923",
  muted: "#94A3B8",
  border: "#E2E8F0",
  card: "#FFFFFF",
};

/**
 * NavCard
 * A navigation tile for the dashboard with an icon, title, and subtitle.
 */
export default function NavCard({ href, emoji, label, sub, color, bg, delay = 0 }) {
  return (
    <Link
      href={href}
      style={{
        background: colors.card,
        borderRadius: 12,
        border: `1px solid ${colors.border}`,
        padding: "18px 16px",
        textDecoration: "none",
        boxShadow: "0 2px 8px rgba(15,25,35,0.04)",
        transition: "all 0.25s",
        animation: `fadeUp 0.4s ease ${delay}s both`,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-3px)";
        e.currentTarget.style.boxShadow = "0 8px 24px rgba(15,25,35,0.1)";
        e.currentTarget.style.borderColor = `${color}44`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "0 2px 8px rgba(15,25,35,0.04)";
        e.currentTarget.style.borderColor = "#E2E8F0";
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          background: bg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 20,
          marginBottom: 12,
        }}
      >
        {emoji}
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: colors.primary, marginBottom: 3 }}>
        {label}
      </div>
      <div style={{ fontSize: "var(--fs-2xs)", color: colors.muted }}>{sub}</div>
    </Link>
  );
}
