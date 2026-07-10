"use client";

import { Sparkles } from "lucide-react";

export default function InsightStep({ insight, loading }) {
  if (loading) {
    return (
      <div style={{
        height: 160, borderRadius: 12,
        background: "linear-gradient(120deg, rgba(255,255,255,0.04), rgba(255,255,255,0.07))",
        animation: "obShimmer 1.4s infinite",
      }}>
        <style jsx>{`
          @keyframes obShimmer {
            0%   { opacity: 0.6; }
            50%  { opacity: 1; }
            100% { opacity: 0.6; }
          }
        `}</style>
      </div>
    );
  }

  if (!insight) {
    return (
      <div style={{ padding: "16px 14px", borderRadius: 12, border: "1px dashed rgba(255,255,255,0.12)", color: "#94A3B8", fontSize: 12, textAlign: "center" }}>
        Generating your first insight…
      </div>
    );
  }

  return (
    <article
      style={{
        padding: "16px 16px",
        borderRadius: 14,
        background: "rgba(139, 92, 246, 0.08)",
        border: "1px solid rgba(139, 92, 246, 0.30)",
        boxShadow: "0 12px 28px rgba(139, 92, 246, 0.18)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ width: 26, height: 26, borderRadius: 8, background: "rgba(139,92,246,0.20)", color: "#C4B5FD", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
          <Sparkles size={14} />
        </span>
        <span style={{ fontSize: 11, fontWeight: 800, color: "#C4B5FD", letterSpacing: "0.06em", textTransform: "uppercase" }}>
          Your first insight
        </span>
      </div>

      <h3 style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 800, color: "#F1F5F9" }}>
        {insight.title}
      </h3>
      <p style={{ margin: 0, fontSize: 12.5, color: "#CBD5E1", lineHeight: 1.65 }}>
        {insight.body}
      </p>

      {insight.evidence && (
        <div style={{ marginTop: 10, fontSize: 10, color: "#94A3B8", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.04em" }}>
          {insight.evidence}
        </div>
      )}

      {insight.action && (
        <div style={{
          marginTop: 12, padding: "10px 12px",
          background: "rgba(34,199,142,0.10)",
          border: "1px solid rgba(34,199,142,0.25)",
          borderRadius: 10,
        }}>
          <div style={{ fontSize: 10, color: "#22C78E", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 2 }}>Next move</div>
          <div style={{ fontSize: 12, color: "#F1F5F9", lineHeight: 1.55 }}>{insight.action}</div>
        </div>
      )}
    </article>
  );
}
