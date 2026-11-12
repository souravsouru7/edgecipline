"use client";

const colors = { bull: "var(--lg-green, #0D9E6E)", secondary: "var(--lg-sub, #4A5568)", muted: "var(--lg-muted, #94A3B8)", bg: "var(--lg-soft, #F0EEE9)" };

/**
 * ProgressBar
 * Horizontal bar showing a ratio/percentage value.
 */
export default function ProgressBar({ value, max = 100, color = colors.bull, label, showPercent = true }) {
  const percent = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: colors.secondary, fontFamily: "var(--lg-mono, 'JetBrains Mono', monospace)" }}>{label}</span>
        {showPercent && !label?.includes("%") && (
          <span style={{ fontSize: 11, color, fontWeight: 600, fontFamily: "var(--lg-mono, 'JetBrains Mono', monospace)" }}>{percent.toFixed(1)}%</span>
        )}
      </div>
      <div style={{ height: 8, background: colors.bg, borderRadius: 4, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${percent}%`, background: `linear-gradient(90deg, ${color}, color-mix(in srgb, ${color} 53%, transparent))`, borderRadius: 4, transition: "width 0.8s ease" }} />
      </div>
    </div>
  );
}
