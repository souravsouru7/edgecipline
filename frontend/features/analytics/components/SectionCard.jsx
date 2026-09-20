"use client";

const colors = { primary: "#0F1923", muted: "#94A3B8", card: "#FFFFFF", border: "#E2E8F0" };

/**
 * SectionCard (Analytics)
 * Container card with accent bar, title, subtitle, and body slot.
 */
export default function SectionCard({ title, subtitle, children, delay = 0, accentColor = colors.primary }) {
  return (
    <div style={{
      background: colors.card, borderRadius: 14, border: `1px solid ${colors.border}`,
      overflow: "hidden", boxShadow: "0 2px 12px rgba(15,25,35,0.05)",
      animation: `fadeUp 0.5s ease ${delay}s both`, flex: "1 1 350px", minWidth: 300,
    }}>
      <div style={{ height: 3, background: `linear-gradient(90deg, ${accentColor}, ${accentColor}22)` }} />
      <div style={{ padding: "16px 20px", borderBottom: `1px solid ${colors.border}` }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: colors.primary, fontFamily: "'Plus Jakarta Sans',sans-serif" }}>{title}</div>
        {subtitle && <div style={{ fontSize: "var(--fs-2xs)", color: colors.muted, marginTop: 2, fontFamily: "'JetBrains Mono',monospace" }}>{subtitle}</div>}
      </div>
      <div style={{ padding: "16px 20px" }}>{children}</div>
    </div>
  );
}
