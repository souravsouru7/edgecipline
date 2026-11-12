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
              background: selected ? "color-mix(in srgb, var(--ec-accent) 12%, transparent)" : "color-mix(in srgb, var(--ec-text) 3%, transparent)",
              border: `1.5px solid ${selected ? "var(--ec-accent-text)" : "color-mix(in srgb, var(--ec-text) 10%, transparent)"}`,
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
              <div style={{ fontSize: 14, fontWeight: 800, color: "var(--ec-text)", marginBottom: 2 }}>{opt.title}</div>
              <div style={{ fontSize: 11, color: "var(--ec-text-2)" }}>{opt.sub}</div>
              <div style={{ fontSize: "var(--fs-2xs)", color: "var(--ec-text-3)", marginTop: 2, fontFamily: "'JetBrains Mono', monospace" }}>e.g. {opt.examples}</div>
            </div>
            <span style={{
              width: 22, height: 22, borderRadius: "50%",
              border: `2px solid ${selected ? "var(--ec-accent-text)" : "var(--ec-text-3)"}`,
              background: selected ? "var(--ec-accent-text)" : "transparent",
              color: "var(--ec-text)", fontSize: 12, fontWeight: 900,
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
