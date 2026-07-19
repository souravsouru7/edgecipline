"use client";

const ROADMAP = [
  "Market",
  "Style",
  "Setup",
  "Trade",
  "AI insight",
  "Review",
];

const BULLETS = [
  { marker: "01", title: "Pick your edge", sub: "Market and style tell the coach how you trade." },
  { marker: "02", title: "Save the setup", sub: "Your setup becomes the pattern every trade is measured against." },
  { marker: "03", title: "Log one trade", sub: "Upload a screenshot or type it in, then the coach reviews it with you." },
];

export default function WelcomeStep() {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{
        padding: "12px 14px",
        borderRadius: 12,
        background: "rgba(255,255,255,0.035)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}>
        <div style={{
          fontSize: 11,
          fontWeight: 800,
          color: "#22C78E",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          marginBottom: 8,
        }}>
          What happens next
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {ROADMAP.map((step, index) => (
            <span
              key={step}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 8px",
                borderRadius: 999,
                background: "rgba(34,199,142,0.08)",
                border: "1px solid rgba(34,199,142,0.18)",
                color: "#CBD5E1",
                fontSize: 10.5,
                fontWeight: 800,
              }}
            >
              <span style={{ color: "#22C78E", fontFamily: "'JetBrains Mono', monospace" }}>{index + 1}</span>
              {step}
            </span>
          ))}
        </div>
      </div>

      {BULLETS.map((b) => (
        <div
          key={b.title}
          style={{
            display: "flex",
            gap: 12,
            alignItems: "flex-start",
            padding: "12px 14px",
            borderRadius: 12,
            background: "rgba(34,199,142,0.06)",
            border: "1px solid rgba(34,199,142,0.18)",
          }}
        >
          <span
            aria-hidden
            style={{
              minWidth: 28,
              height: 24,
              borderRadius: 8,
              background: "rgba(34,199,142,0.12)",
              color: "#22C78E",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 10,
              fontWeight: 900,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {b.marker}
          </span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#F1F5F9" }}>{b.title}</div>
            <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 2, lineHeight: 1.45 }}>{b.sub}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
