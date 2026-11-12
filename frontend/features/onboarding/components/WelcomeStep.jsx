"use client";

// The steps after this one, in the server's order (onboardingService
// FLOW_STEPS), so this list matches the progress bar above it.
const ROADMAP = [
  "Market",
  "Setup",
  "Import a trade",
  "Journal review",
];

const BULLETS = [
  { marker: "01", title: "Pick your market", sub: "Forex or Indian, so your setup and examples fit how you trade." },
  { marker: "02", title: "Save the setup", sub: "Your setup becomes the pattern every trade is measured against." },
  { marker: "03", title: "Log one trade", sub: "Upload a screenshot or type it in, then the coach reviews it with you." },
];

export default function WelcomeStep() {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{
        padding: "12px 14px",
        borderRadius: 12,
        background: "color-mix(in srgb, var(--ec-text) 4%, transparent)",
        border: "1px solid color-mix(in srgb, var(--ec-text) 8%, transparent)",
      }}>
        <div style={{
          fontSize: 13,
          fontWeight: 600,
          color: "var(--ec-text)",
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
                background: "color-mix(in srgb, var(--ec-accent) 8%, transparent)",
                border: "1px solid color-mix(in srgb, var(--ec-accent) 18%, transparent)",
                color: "var(--ec-text-2)",
                fontSize: "var(--fs-2xs)",
                fontWeight: 800,
              }}
            >
              <span style={{ color: "var(--ec-accent-text)", fontFamily: "'JetBrains Mono', monospace" }}>{index + 1}</span>
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
            background: "color-mix(in srgb, var(--ec-accent) 6%, transparent)",
            border: "1px solid color-mix(in srgb, var(--ec-accent) 18%, transparent)",
          }}
        >
          <span
            aria-hidden
            style={{
              minWidth: 28,
              height: 24,
              borderRadius: 8,
              background: "color-mix(in srgb, var(--ec-accent) 12%, transparent)",
              color: "var(--ec-accent-text)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "var(--fs-2xs)",
              fontWeight: 900,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {b.marker}
          </span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: "var(--ec-text)" }}>{b.title}</div>
            <div style={{ fontSize: 11, color: "var(--ec-text-2)", marginTop: 2, lineHeight: 1.45 }}>{b.sub}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
