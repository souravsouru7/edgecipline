"use client";

import Link from "next/link";
import { C, cardSurface } from "./tokens";

export default function EmptyState({ onGenerate, isGenerating }) {
  return (
    <div
      style={{
        ...cardSurface,
        textAlign: "center",
        padding: "44px 28px",
      }}
    >
      <div style={{ fontSize: 32, marginBottom: 16 }}>🧬</div>
      <div
        style={{
          fontSize: 16,
          fontWeight: 800,
          color: C.primary,
          marginBottom: 8,
        }}
      >
        Generate your Trading DNA
      </div>
      <div
        style={{
          fontSize: 12,
          color: C.muted,
          lineHeight: 1.7,
          maxWidth: 360,
          margin: "0 auto",
          marginBottom: 24,
        }}
      >
        Your behavioral fingerprint, distilled from every trade you have logged
        — identity, strengths, blind spots, and the single highest-leverage
        change to make next.
      </div>
      <button
        type="button"
        onClick={onGenerate}
        disabled={isGenerating}
        style={{
          padding: "12px 26px",
          background: isGenerating ? C.muted : C.primary,
          color: "#F8FAFC",
          borderRadius: 10,
          fontWeight: 800,
          fontSize: 12,
          letterSpacing: "0.04em",
          border: "none",
          cursor: isGenerating ? "not-allowed" : "pointer",
        }}
      >
        {isGenerating ? "Generating…" : "Generate Trading DNA"}
      </button>
      <div
        style={{
          fontSize: 11,
          color: C.muted,
          marginTop: 18,
        }}
      >
        Or{" "}
        <Link
          href="/upload-trade"
          style={{ color: C.purple, textDecoration: "underline" }}
        >
          log a few more trades
        </Link>{" "}
        first for a richer report.
      </div>
    </div>
  );
}
