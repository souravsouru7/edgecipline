"use client";

import { C, FONT, cardSurface } from "./tokens";
import SectionTitle from "./SectionTitle";

export default function ImprovementPrioritiesList({ items = [] }) {
  if (!items.length) return null;

  return (
    <div style={cardSurface}>
      <SectionTitle>IMPROVEMENT PRIORITIES</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {items.map((entry, i) => (
          <div
            key={`${entry.priority || "priority"}-${i}`}
            style={{
              padding: "16px 18px",
              borderRadius: 12,
              background: C.surfaceAlt,
              border: `1px solid ${C.border}`,
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: 16,
              alignItems: "start",
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                background: C.primary,
                color: "#F8FAFC",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 13,
                fontWeight: 900,
                fontFamily: FONT.mono,
              }}
            >
              {i + 1}
            </div>
            <div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 800,
                  color: C.primary,
                  marginBottom: 6,
                }}
              >
                {entry.priority}
              </div>
              {entry.action ? (
                <div
                  style={{
                    fontSize: 12,
                    color: "#374151",
                    lineHeight: 1.6,
                    marginBottom: entry.expectedImpact ? 6 : 0,
                  }}
                >
                  <span style={{ color: C.muted, fontWeight: 700 }}>
                    Action:
                  </span>{" "}
                  {entry.action}
                </div>
              ) : null}
              {entry.expectedImpact ? (
                <div
                  style={{
                    fontSize: 11,
                    color: C.bull,
                    fontWeight: 600,
                  }}
                >
                  Expected impact: {entry.expectedImpact}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
