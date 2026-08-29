"use client";

import { useMemo } from "react";
import { useTrialStatus } from "@/features/shared/hooks/useTrialStatus";
import { recordTrialEvent } from "@/services/api";
import { canShowPurchaseUI } from "@/config/payments";

// Sticky top banner that surfaces trial state. Renders only for users who
// are actively in a trial — paid users, admins, and users whose trial has
// already expired see nothing here (expired users get the SmartPaywall
// instead). Visuals adapt as the trial nears expiry:
//   days 7..4  → calm green (no urgency)
//   days 3..2  → amber (gentle nudge)
//   day  1     → red (last call)
//
// Props:
//   initial  — optional seed payload from server-rendered dashboard
//   onUpgrade — invoked when CTA is tapped (open SmartPaywall)
function pickTone(daysRemaining) {
  if (daysRemaining <= 1) return { bg: "linear-gradient(90deg, #FEE2E2 0%, #FECACA 100%)", text: "#991B1B", accent: "#DC2626", urgency: "Last day" };
  if (daysRemaining <= 3) return { bg: "linear-gradient(90deg, #FEF3C7 0%, #FDE68A 100%)", text: "#92400E", accent: "#D97706", urgency: "Ending soon" };
  return { bg: "linear-gradient(90deg, #D1FAE5 0%, #A7F3D0 100%)", text: "#065F46", accent: "#059669", urgency: "Premium trial" };
}

export default function TrialCountdownBanner({ initial = null, onUpgrade }) {
  const { trial, planSource, loading } = useTrialStatus({ initial });

  const tone = useMemo(
    () => pickTone(trial?.daysRemaining ?? 7),
    [trial?.daysRemaining]
  );

  // Hide for: loading, no trial, paid users, admins, expired trial.
  // No purchase surface -> no upgrade prompt. A countdown whose only CTA is
  // dead is worse than no countdown at all.
  if (!canShowPurchaseUI()) return null;
  if (loading) return null;
  if (planSource !== "trial") return null;
  if (!trial?.active) return null;

  const daysLeft = Math.max(0, trial.daysRemaining || 0);
  const totalDays = 7;
  const elapsed = Math.max(0, Math.min(totalDays, totalDays - daysLeft));
  const progressPct = Math.round((elapsed / totalDays) * 100);

  const handleClick = () => {
    recordTrialEvent("trial_banner_clicked", { daysRemaining: daysLeft });
    if (typeof onUpgrade === "function") onUpgrade();
  };

  return (
    <div
      role="region"
      aria-label="Premium trial status"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: tone.bg,
        color: tone.text,
        padding: "10px 16px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        fontFamily: "'Plus Jakarta Sans', sans-serif",
        fontSize: 13,
        fontWeight: 600,
        boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
        <span aria-hidden="true" style={{ fontSize: 16, lineHeight: 1 }}>
          {daysLeft <= 1 ? "⏰" : daysLeft <= 3 ? "⌛" : "🎁"}
        </span>
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 800, letterSpacing: "-0.01em" }}>
              {tone.urgency}
            </span>
            <span style={{ color: tone.accent, fontWeight: 800 }}>
              {daysLeft === 1 ? "1 day left" : `${daysLeft} days left`}
            </span>
          </div>
          <div
            aria-hidden="true"
            style={{
              marginTop: 6,
              height: 4,
              width: 160,
              maxWidth: "30vw",
              background: "rgba(0,0,0,0.08)",
              borderRadius: 99,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${progressPct}%`,
                background: tone.accent,
                transition: "width 400ms ease-out",
              }}
            />
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={handleClick}
        style={{
          background: tone.accent,
          color: "#fff",
          border: "none",
          padding: "8px 16px",
          borderRadius: 99,
          fontSize: 13,
          fontWeight: 800,
          cursor: "pointer",
          whiteSpace: "nowrap",
          boxShadow: "0 4px 10px rgba(0,0,0,0.12)",
          flexShrink: 0,
        }}
      >
        Upgrade ₹199/mo
      </button>
    </div>
  );
}
