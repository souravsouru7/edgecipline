"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";

// Shared inline error surface used by every onboarding step. We never block
// the flow on a single mutation failure — the banner offers a retry, and the
// user can always keep moving (skip / back are always available).
export default function OnboardingError({ error, onRetry, retrying }) {
  if (!error) return null;
  const message = error?.data?.message
    || error?.message
    || "Something hiccuped on our end. Try again or skip — your progress is saved.";

  return (
    <div
      role="alert"
      style={{
        marginTop: 12,
        padding: "10px 12px",
        borderRadius: 10,
        background: "rgba(214, 59, 59, 0.10)",
        border: "1px solid rgba(214, 59, 59, 0.30)",
        color: "#FCA5A5",
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
      }}
    >
      <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: "#F87171" }}>
          Couldn't save that step
        </div>
        <div style={{ fontSize: 11, color: "#FCA5A5", marginTop: 2, lineHeight: 1.5 }}>
          {message}
        </div>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          style={{
            background: "rgba(214,59,59,0.18)",
            border: "1px solid rgba(214,59,59,0.40)",
            color: "#F87171",
            padding: "5px 10px",
            borderRadius: 8,
            fontSize: 11,
            fontWeight: 800,
            cursor: retrying ? "default" : "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            flexShrink: 0,
          }}
        >
          <RefreshCw size={11} /> {retrying ? "Retrying…" : "Retry"}
        </button>
      )}
    </div>
  );
}
