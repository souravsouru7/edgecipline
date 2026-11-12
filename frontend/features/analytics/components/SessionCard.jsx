"use client";

const colors = {
  bull: "var(--lg-green, #0D9E6E)",
  bear: "var(--lg-red, #D63B3B)",
  gold: "var(--lg-gold, #B8860B)",
  primary: "var(--lg-ink, #0F1923)",
  muted: "var(--lg-muted, #94A3B8)",
  border: "var(--lg-line, #E2E8F0)",
  card: "var(--lg-card, #FFFFFF)",
};

/**
 * SessionCard
 * Highlights a specific trading session's performance (e.g. Best Session).
 */
export default function SessionCard({ label, data, color, delay = 0 }) {
  if (!data || !data.trades) return null;

  const profit = parseFloat(data.profit || 0);
  const isProfit = profit >= 0;

  return (
    <div style={{
      flex: "1 1 180px",
      background: colors.card,
      borderRadius: 12,
      border: `2px solid color-mix(in srgb, ${color} 20%, transparent)`,
      padding: "16px",
      boxShadow: "0 2px 8px rgba(15,25,35,0.04)",
      animation: `fadeUp 0.5s ease ${delay}s both`,
    }}>
      <div style={{
        fontSize: "var(--fs-2xs)",
        color: color,
        fontWeight: 700,
        letterSpacing: "0.1em",
        marginBottom: 10,
        fontFamily: "var(--lg-mono, 'JetBrains Mono', monospace)",
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 20,
        fontWeight: 700,
        fontFamily: "var(--lg-mono, 'JetBrains Mono', monospace)",
        color: colors.primary,
        marginBottom: 6,
      }}>
        {data.name || "Need more data"}
      </div>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        fontSize: 12,
        fontFamily: "var(--lg-mono, 'JetBrains Mono', monospace)",
      }}>
        <div>
          <div style={{ fontSize: "var(--fs-2xs)", color: colors.muted }}>P&L</div>
          <div style={{ color: isProfit ? colors.bull : colors.bear, fontWeight: 700 }}>
            {data.profit}
          </div>
        </div>
        <div>
          <div style={{ fontSize: "var(--fs-2xs)", color: colors.muted }}>W/R</div>
          <div style={{ color: data.winRate >= 50 ? colors.bull : colors.bear, fontWeight: 700 }}>
            {data.winRate}%
          </div>
        </div>
        <div>
          <div style={{ fontSize: "var(--fs-2xs)", color: colors.muted }}>TRADES</div>
          <div style={{ color: colors.primary, fontWeight: 700 }}>
            {data.trades}
          </div>
        </div>
      </div>
    </div>
  );
}
