"use client";

import { forwardRef } from "react";
import { C, FONT } from "./tokens";

const ARCHETYPE_ACCENTS = {
  "Patient Sniper": "#A855F7",
  "Momentum Rider": "#F97316",
  "Disciplined Grinder": "#0D9E6E",
  "Volatility Surfer": "#06B6D4",
  "Reactive Improviser": "#F43F5E",
  "Range Hunter": "#10B981",
  "Breakout Hunter": "#F59E0B",
  "Risk Curator": "#3B82F6",
  "Mean Reversion Specialist": "#8B5CF6",
  "Trend Follower": "#0EA5E9",
  Scalper: "#EC4899",
  "Swing Builder": "#22C55E",
};

// The canvas that gets converted to PNG. Fixed dimensions so the export is
// predictable across devices — and styled with inline values only (no Tailwind
// classes) so html-to-image captures it faithfully without resolving a
// stylesheet at capture time.
const ShareableCard = forwardRef(function ShareableCard(
  { identity, coachSummary, topStrengths = [], sample, brand = "Edgecipline" },
  ref
) {
  const archetype = identity?.archetype || "Trader";
  const accent = ARCHETYPE_ACCENTS[archetype] || C.purple;

  return (
    <div
      ref={ref}
      data-shareable-card
      style={{
        width: 1080,
        height: 1080,
        boxSizing: "border-box",
        padding: 80,
        background:
          "linear-gradient(135deg,#0F1923 0%,#1A2538 55%,#0F1923 100%)",
        color: "#F8FAFC",
        fontFamily: FONT.body,
        position: "relative",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: -200,
          right: -200,
          width: 700,
          height: 700,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${accent}55 0%, transparent 60%)`,
          pointerEvents: "none",
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          bottom: -240,
          left: -240,
          width: 600,
          height: 600,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${accent}25 0%, transparent 70%)`,
          pointerEvents: "none",
        }}
      />

      <div style={{ position: "relative" }}>
        <div
          style={{
            fontSize: 22,
            fontWeight: 800,
            color: accent,
            letterSpacing: "0.32em",
            marginBottom: 28,
          }}
        >
          MY TRADING DNA
        </div>

        <div
          style={{
            fontSize: 88,
            fontWeight: 900,
            color: "#F8FAFC",
            letterSpacing: "-0.03em",
            lineHeight: 1.05,
            marginBottom: 24,
            maxWidth: 880,
          }}
        >
          {archetype}
        </div>

        {identity?.tagline ? (
          <div
            style={{
              fontSize: 22,
              color: accent,
              fontFamily: FONT.mono,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              marginBottom: 36,
            }}
          >
            {identity.tagline}
          </div>
        ) : null}

        {identity?.oneLiner ? (
          <p
            style={{
              fontSize: 28,
              color: "#CBD5E1",
              lineHeight: 1.5,
              maxWidth: 880,
              margin: 0,
              marginBottom: 36,
              fontWeight: 500,
            }}
          >
            {identity.oneLiner}
          </p>
        ) : null}

        {topStrengths?.length ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
              marginBottom: 36,
            }}
          >
            {topStrengths.slice(0, 2).map((s, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  fontSize: 24,
                  color: "#E2E8F0",
                  fontWeight: 600,
                }}
              >
                <span
                  style={{
                    color: accent,
                    fontSize: 28,
                    fontWeight: 900,
                  }}
                >
                  ✓
                </span>
                {s.title}
              </div>
            ))}
          </div>
        ) : null}

        {coachSummary ? (
          <div
            style={{
              fontSize: 20,
              color: "#94A3B8",
              lineHeight: 1.55,
              maxWidth: 880,
              fontStyle: "italic",
              borderLeft: `3px solid ${accent}`,
              paddingLeft: 20,
            }}
          >
            “{coachSummary}”
          </div>
        ) : null}
      </div>

      <div
        style={{
          position: "relative",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          paddingTop: 32,
          borderTop: `1px solid ${accent}33`,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 14,
              color: "#64748B",
              fontFamily: FONT.mono,
              letterSpacing: "0.18em",
              marginBottom: 8,
            }}
          >
            BASED ON
          </div>
          <div
            style={{
              fontSize: 30,
              fontWeight: 900,
              color: "#F8FAFC",
              fontFamily: FONT.mono,
            }}
          >
            {sample?.totalTrades ?? 0} trades
          </div>
        </div>

        <div style={{ textAlign: "right" }}>
          <div
            style={{
              fontSize: 14,
              color: "#64748B",
              fontFamily: FONT.mono,
              letterSpacing: "0.18em",
              marginBottom: 8,
            }}
          >
            GENERATED BY
          </div>
          <div
            style={{
              fontSize: 30,
              fontWeight: 900,
              color: accent,
              letterSpacing: "-0.01em",
            }}
          >
            {brand}
          </div>
        </div>
      </div>
    </div>
  );
});

export default ShareableCard;
