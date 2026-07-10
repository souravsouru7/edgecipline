"use client";

const MARKETS = [
  {
    value: "Forex",
    emoji: "🌐",
    title: "Forex / Global",
    sub: "MT4 / MT5, OANDA, IC Markets",
    examples: "EUR/USD · XAUUSD · GBP/JPY",
  },
  {
    value: "Indian_Market",
    emoji: "🇮🇳",
    title: "Indian Market",
    sub: "Zerodha · Upstox · Groww · Angel One",
    examples: "NIFTY options · RELIANCE · F&O",
  },
];

export default function MarketStep({ value, onChange }) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {MARKETS.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={selected}
            style={{
              textAlign: "left",
              padding: "14px 14px",
              borderRadius: 12,
              cursor: "pointer",
              background: selected ? "rgba(34,199,142,0.12)" : "rgba(255,255,255,0.03)",
              border: `1.5px solid ${selected ? "#22C78E" : "rgba(255,255,255,0.1)"}`,
              display: "flex",
              alignItems: "center",
              gap: 12,
              transition: "background 0.2s, border-color 0.2s",
              fontFamily: "inherit",
              color: "inherit",
            }}
          >
            <span aria-hidden style={{ fontSize: 24, lineHeight: 1 }}>{opt.emoji}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#F1F5F9", marginBottom: 2 }}>{opt.title}</div>
              <div style={{ fontSize: 11, color: "#94A3B8" }}>{opt.sub}</div>
              <div style={{ fontSize: 10, color: "#64748B", marginTop: 2, fontFamily: "'JetBrains Mono', monospace" }}>e.g. {opt.examples}</div>
            </div>
            <span style={{
              width: 22, height: 22, borderRadius: "50%",
              border: `2px solid ${selected ? "#22C78E" : "#475569"}`,
              background: selected ? "#22C78E" : "transparent",
              color: "#0F1923", fontSize: 12, fontWeight: 900,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>
              {selected ? "✓" : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}
