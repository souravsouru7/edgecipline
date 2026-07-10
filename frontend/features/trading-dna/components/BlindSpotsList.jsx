"use client";

import { C, cardSurface } from "./tokens";
import SectionTitle from "./SectionTitle";

export default function BlindSpotsList({ items = [] }) {
  if (!items.length) return null;

  return (
    <div style={cardSurface}>
      <SectionTitle>BLIND SPOTS</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {items.map((entry, i) => (
          <div
            key={`${entry.title || "blind"}-${i}`}
            style={{
              padding: "14px 16px",
              borderRadius: 12,
              background: "#FFFBEB",
              border: "1px solid #FDE68A",
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 800,
                color: "#92400E",
                marginBottom: 6,
                letterSpacing: "0.02em",
              }}
            >
              {entry.title}
            </div>
            {entry.why ? (
              <div
                style={{
                  fontSize: 12,
                  color: "#374151",
                  lineHeight: 1.6,
                  marginBottom: entry.watchFor ? 8 : 0,
                }}
              >
                {entry.why}
              </div>
            ) : null}
            {entry.watchFor ? (
              <div
                style={{
                  fontSize: 11,
                  color: C.gold,
                  fontWeight: 600,
                }}
              >
                Watch for: {entry.watchFor}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
