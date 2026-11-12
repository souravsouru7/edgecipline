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
      background: "var(--lg-card, #FFFFFF)", borderRadius: 14,
      border: "1px solid var(--lg-line, #E2E8F0)", overflow: "hidden",
      boxShadow: "0 2px 12px rgba(15,25,35,0.06)",
      animation: `fadeUp 0.5s ease ${delay}s both`,
      marginBottom: 20,
      ...style,
    }}>
      <div style={{ height: 3, background: `linear-gradient(90deg,${accentColor},color-mix(in srgb, ${accentColor} 20%, transparent))` }} />
      <div style={{ padding: "22px 24px" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--lg-ink, #0F1923)", fontFamily: "var(--lg-sans, 'Plus Jakarta Sans', sans-serif)", marginBottom: 2 }}>{title}</div>
        {subtitle && (
          <div style={{ fontSize: "var(--fs-2xs)", color: "var(--lg-muted, #94A3B8)", fontFamily: "var(--lg-mono, 'JetBrains Mono', monospace)", letterSpacing: "0.06em", marginBottom: 18 }}>
            {subtitle}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
