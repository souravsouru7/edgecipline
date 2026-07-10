"use client";

import { C, cardSurface } from "./tokens";
import SectionTitle from "./SectionTitle";

export default function BehaviorPatternsCard({ items = [] }) {
  if (!items.length) return null;

  return (
    <div style={cardSurface}>
      <SectionTitle>BEHAVIOR PATTERNS</SectionTitle>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))",
          gap: 12,
        }}
      >
        {items.map((entry, i) => (
          <div
            key={`${entry.pattern || "pattern"}-${i}`}
            style={{
              padding: "14px 16px",
              borderRadius: 12,
              background: "#F0F7FF",
              border: "1px solid #BFDBFE",
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 800,
                color: "#1E40AF",
                marginBottom: 8,
              }}
            >
              {entry.pattern}
            </div>
            {entry.trigger ? (
              <div
                style={{
                  fontSize: 11,
                  color: "#374151",
                  lineHeight: 1.5,
                  marginBottom: 4,
                }}
              >
                <span style={{ color: C.muted, fontWeight: 700 }}>Trigger:</span>{" "}
                {entry.trigger}
              </div>
            ) : null}
            {entry.consequence ? (
              <div
                style={{
                  fontSize: 11,
                  color: "#374151",
                  lineHeight: 1.5,
                }}
              >
                <span style={{ color: C.muted, fontWeight: 700 }}>Result:</span>{" "}
                {entry.consequence}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
