"use client";

const STYLE_BADGES = {
  scalper:  "Fast",
  intraday: "Active",
  swing:    "Patient",
  position: "Strategic",
  investor: "Long",
};

export default function StyleStep({ styles = [], value, onChange }) {
  if (!styles.length) {
    return <div style={{ color: "#94A3B8", fontSize: 12 }}>Loading styles…</div>;
  }
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {styles.map((style) => {
        const selected = value === style.id;
        return (
          <button
            key={style.id}
            type="button"
            onClick={() => onChange(style.id)}
            aria-pressed={selected}
            style={{
              textAlign: "left",
              padding: "12px 14px",
              borderRadius: 12,
              cursor: "pointer",
              background: selected ? "rgba(34,199,142,0.12)" : "rgba(255,255,255,0.03)",
              border: `1.5px solid ${selected ? "#22C78E" : "rgba(255,255,255,0.1)"}`,
              display: "flex",
              alignItems: "center",
              gap: 12,
              color: "inherit",
              fontFamily: "inherit",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: "#F1F5F9" }}>{style.label}</span>
                <span style={{
                  fontSize: 9, fontWeight: 800, color: "#22C78E",
                  background: "rgba(34,199,142,0.18)", padding: "2px 6px", borderRadius: 999,
                  letterSpacing: "0.06em", textTransform: "uppercase",
                }}>
                  {STYLE_BADGES[style.id] || ""}
                </span>
              </div>
              <div style={{ fontSize: 11, color: "#94A3B8", lineHeight: 1.5 }}>{style.sub}</div>
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
