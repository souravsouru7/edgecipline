"use client";

const TYPE_COLORS = {
  info:    { bg: "var(--lg-soft, #EFF6FF)", border: "var(--lg-line, #93C5FD)", text: "var(--lg-ink, #1D4ED8)" },
  success: { bg: "var(--lg-green-soft, #ECFDF5)", border: "var(--lg-green, #6EE7B7)", text: "var(--lg-green, #059669)" },
  warning: { bg: "var(--lg-gold-soft, #FEF3C7)", border: "var(--lg-gold, #FCD34D)", text: "#D97706" },
  danger:  { bg: "var(--lg-red-soft, #FEE2E2)", border: "var(--lg-red-soft, #FCA5A5)", text: "var(--lg-red, #DC2626)" },
};

/**
 * InsightTag
 * A coloured callout bubble for AI-generated insights.
 * @param {string} text - Insight text to display
 * @param {"info"|"success"|"warning"|"danger"} type - Colour theme
 */
export default function InsightTag({ text, type = "info" }) {
  const c = TYPE_COLORS[type] || TYPE_COLORS.info;
  return (
    <div style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 8, padding: "10px 14px", display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
      <div style={{ width: 6, height: 6, borderRadius: "50%", background: c.text, marginTop: 5, flexShrink: 0 }} />
      <span style={{ fontSize: 12, color: c.text, lineHeight: 1.5 }}>{text}</span>
    </div>
  );
}
