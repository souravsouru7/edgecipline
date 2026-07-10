"use client";

import { C, FONT, cardSurface } from "./tokens";
import SectionTitle from "./SectionTitle";

function Item({ entry, accent, accentBg, accentText }) {
  return (
    <div
      style={{
        padding: "14px 16px",
        borderRadius: 12,
        background: accentBg,
        border: `1px solid ${accent}33`,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          color: accentText,
          marginBottom: 6,
          letterSpacing: "0.02em",
        }}
      >
        {entry.title}
      </div>
      {entry.evidence ? (
        <div
          style={{
            fontSize: 12,
            color: "#374151",
            lineHeight: 1.6,
            marginBottom: entry.metric ? 6 : 0,
          }}
        >
          {entry.evidence}
        </div>
      ) : null}
      {entry.metric ? (
        <div
          style={{
            fontSize: 10,
            color: accent,
            fontFamily: FONT.mono,
            letterSpacing: "0.04em",
          }}
        >
          {entry.metric}
        </div>
      ) : null}
    </div>
  );
}

function Column({ title, items, accent, accentBg, accentText, emptyLabel }) {
  return (
    <div>
      <div
        style={{
          fontSize: 9,
          color: accent,
          fontWeight: 800,
          letterSpacing: "0.12em",
          marginBottom: 10,
        }}
      >
        {title}
      </div>
      {items?.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {items.map((entry, i) => (
            <Item
              key={`${entry.title || "item"}-${i}`}
              entry={entry}
              accent={accent}
              accentBg={accentBg}
              accentText={accentText}
            />
          ))}
        </div>
      ) : (
        <div
          style={{
            fontSize: 11,
            color: C.muted,
            padding: "12px 0",
          }}
        >
          {emptyLabel}
        </div>
      )}
    </div>
  );
}

export default function StrengthsWeaknessesGrid({ strengths = [], weaknesses = [] }) {
  return (
    <div style={cardSurface}>
      <SectionTitle>STRENGTHS &amp; WEAKNESSES</SectionTitle>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))",
          gap: 20,
        }}
      >
        <Column
          title="STRENGTHS"
          items={strengths}
          accent={C.bull}
          accentBg="#F0FDF4"
          accentText="#166534"
          emptyLabel="No strengths surfaced yet — log more trades to anchor your edge."
        />
        <Column
          title="WEAKNESSES"
          items={weaknesses}
          accent={C.bear}
          accentBg="#FFF8F8"
          accentText="#9B1C1C"
          emptyLabel="No weaknesses flagged for this window."
        />
      </div>
    </div>
  );
}
