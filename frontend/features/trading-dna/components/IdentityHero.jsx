"use client";

import { C, FONT } from "./tokens";

// Maps archetype → accent colour. Falls back to purple for unknowns and grey
// for the null archetype (low-sample case).
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

export default function IdentityHero({ identity, sample, generatedAt }) {
  const archetype = identity?.archetype || null;
  const accent = archetype
    ? ARCHETYPE_ACCENTS[archetype] || C.purple
    : C.muted;

  return (
    <div
      style={{
        background: C.bgDeep,
        borderRadius: 18,
        padding: "28px 28px",
        color: "#F8FAFC",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(circle at 100% 0%, ${accent}40 0%, transparent 55%)`,
          pointerEvents: "none",
        }}
      />
      <div style={{ position: "relative" }}>
        <div
          style={{
            fontSize: 9,
            fontWeight: 800,
            color: accent,
            letterSpacing: "0.18em",
            marginBottom: 12,
          }}
        >
          YOUR TRADING IDENTITY
        </div>

        <div
          style={{
            fontSize: 32,
            fontWeight: 900,
            color: "#F8FAFC",
            letterSpacing: "-0.02em",
            marginBottom: 8,
            lineHeight: 1.1,
          }}
        >
          {archetype || "Building your DNA…"}
        </div>

        {identity?.tagline ? (
          <div
            style={{
              fontSize: 12,
              color: accent,
              fontFamily: FONT.mono,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              marginBottom: 18,
            }}
          >
            {identity.tagline}
          </div>
        ) : null}

        {identity?.oneLiner ? (
          <p
            style={{
              fontSize: 14,
              color: "#CBD5E1",
              lineHeight: 1.7,
              margin: 0,
              marginBottom: 18,
              maxWidth: 640,
            }}
          >
            {identity.oneLiner}
          </p>
        ) : null}

        <div
          style={{
            display: "flex",
            gap: 18,
            flexWrap: "wrap",
            fontSize: 10,
            color: "#64748B",
            letterSpacing: "0.05em",
          }}
        >
          {sample?.totalTrades != null ? (
            <span>
              SAMPLE:{" "}
              <strong style={{ color: "#E2E8F0" }}>
                {sample.totalTrades} trades
              </strong>
            </span>
          ) : null}
          {sample?.lowSample ? (
            <span style={{ color: "#F59E0B" }}>PRELIMINARY</span>
          ) : null}
          {generatedAt ? (
            <span>
              GENERATED:{" "}
              <strong style={{ color: "#E2E8F0" }}>
                {new Date(generatedAt).toLocaleDateString()}
              </strong>
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
