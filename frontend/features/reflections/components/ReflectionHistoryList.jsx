"use client";

import { Sparkles, Minus } from "lucide-react";

const PLAN_COLOR = {
  yes:       "#0D9E6E",
  partly:    "#F59E0B",
  no:        "#D63B3B",
  no_trades: "#0EA5E9",
};

const PLAN_LABEL = {
  yes:       "Followed plan",
  partly:    "Partly followed",
  no:        "Broke plan",
  no_trades: "No trades",
};

function formatDay(dayKey) {
  // dayKey is YYYY-MM-DD in user-local TZ; parse as UTC so the calendar day
  // never shifts when re-rendered.
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default function ReflectionHistoryList({ items = [], loading }) {
  if (loading) {
    return (
      <div style={{ display: "grid", gap: 10 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} style={{ height: 78, borderRadius: 12, background: "#F1F5F9" }} />
        ))}
      </div>
    );
  }

  if (!items.length) {
    return (
      <div style={{
        padding: "20px 16px",
        border: "1px dashed #CBD5E1",
        borderRadius: 12,
        textAlign: "center",
        color: "#64748B",
        fontSize: 13,
      }}>
        {"No reflections yet. Tonight's the night to start."}
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {items.map((r) => {
        const planColor = PLAN_COLOR[r.followedPlan] || "#94A3B8";
        const planLabel = PLAN_LABEL[r.followedPlan] || (r.skipped ? "Skipped" : "Reflected");

        return (
          <article
            key={r._id || r.day}
            style={{
              padding: "12px 14px",
              background: "#FFFFFF",
              borderRadius: 12,
              border: "1px solid #E2E8F0",
              boxShadow: "0 1px 4px rgba(15,25,35,0.04)",
            }}
          >
            <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#0F1923" }}>
                {formatDay(r.day)}
              </div>
              <span style={{
                fontSize: 10,
                fontWeight: 800,
                padding: "3px 8px",
                borderRadius: 99,
                background: r.skipped ? "#F1F5F9" : `${planColor}18`,
                color: r.skipped ? "#64748B" : planColor,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}>
                {r.skipped ? <Minus size={10} style={{ verticalAlign: -1, marginRight: 3 }} /> : null}
                {planLabel}
              </span>
            </header>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11, color: "#475569" }}>
              {Number.isFinite(r.mood) && <span>Mood {r.mood}/5</span>}
              {Number.isFinite(r.confidence) && <span>Confidence {r.confidence}/5</span>}
              {r.wouldRepeat && <span>Repeat: {r.wouldRepeat}</span>}
              {Number.isFinite(r.context?.tradeCount) && r.context.tradeCount > 0 && (
                <span>{r.context.tradeCount} trade{r.context.tradeCount === 1 ? "" : "s"}</span>
              )}
            </div>

            {r.improvement && (
              <p style={{ margin: "8px 0 0", fontSize: 12, color: "#0F1923", lineHeight: 1.5 }}>
                <strong style={{ color: "#64748B", fontWeight: 700, marginRight: 4 }}>Tomorrow:</strong>
                {r.improvement}
              </p>
            )}

            {r.aiInsight && (
              <div style={{
                marginTop: 10,
                padding: "8px 10px",
                background: "rgba(139, 92, 246, 0.07)",
                border: "1px solid rgba(139, 92, 246, 0.18)",
                borderRadius: 8,
                display: "flex",
                gap: 8,
                alignItems: "flex-start",
              }}>
                <Sparkles size={13} color="#7C3AED" style={{ marginTop: 1, flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: "#1E293B", lineHeight: 1.5 }}>
                  {r.aiInsight}
                </span>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
