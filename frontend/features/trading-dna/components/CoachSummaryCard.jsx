"use client";

import { FONT } from "./tokens";

export default function CoachSummaryCard({ summary, confidenceNote }) {
  if (!summary && !confidenceNote) return null;

  return (
    <div
      style={{
        background: "linear-gradient(135deg,#0F1923 0%,#1E293B 100%)",
        borderRadius: 16,
        padding: "26px 28px",
        color: "#F8FAFC",
      }}
    >
      <div
        style={{
          fontSize: 9,
          fontWeight: 800,
          color: "#8B5CF6",
          letterSpacing: "0.14em",
          marginBottom: 12,
        }}
      >
        AI COACH SUMMARY
      </div>

      {summary ? (
        <p
          style={{
            fontSize: 14,
            color: "#E2E8F0",
            lineHeight: 1.8,
            margin: 0,
            marginBottom: 14,
            maxWidth: 640,
          }}
        >
          {summary}
        </p>
      ) : null}

      {confidenceNote ? (
        <div
          style={{
            fontSize: 11,
            color: "#94A3B8",
            fontFamily: FONT.mono,
            letterSpacing: "0.04em",
            paddingTop: 12,
            borderTop: "1px solid #1E293B",
          }}
        >
          {confidenceNote}
        </div>
      ) : null}
    </div>
  );
}
