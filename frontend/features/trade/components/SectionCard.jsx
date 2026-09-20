"use client";

/**
 * SectionCard
 * Reusable card container with a coloured accent bar, title, and optional subtitle.
 *
 * @param {string}          accentColor - Left/top accent gradient colour (default green)
 * @param {string}          title       - Card title
 * @param {string}          [subtitle]  - Optional subtitle
 * @param {React.ReactNode} children    - Card body
 * @param {number}          [delay]     - Animation delay in seconds
 * @param {Object}          [style]     - Additional style overrides
 */
export default function SectionCard({ accentColor = "#0D9E6E", title, subtitle, children, delay = 0, style = {}, cardRef = null }) {
  return (
    <div ref={cardRef} style={{
      background: "#FFFFFF", borderRadius: 14,
      border: "1px solid #E2E8F0", overflow: "hidden",
      boxShadow: "0 2px 12px rgba(15,25,35,0.06)",
      animation: `fadeUp 0.5s ease ${delay}s both`,
      marginBottom: 20,
      ...style,
    }}>
      <div style={{ height: 3, background: `linear-gradient(90deg,${accentColor},${accentColor}33)` }} />
      <div style={{ padding: "22px 24px" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#0F1923", fontFamily: "'Plus Jakarta Sans',sans-serif", marginBottom: 2 }}>{title}</div>
        {subtitle && (
          <div style={{ fontSize: "var(--fs-2xs)", color: "#94A3B8", fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.06em", marginBottom: 18 }}>
            {subtitle}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
