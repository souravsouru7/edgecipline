"use client";

import { useMemo } from "react";
import { useRescueBanner } from "@/features/shared/hooks/useRescueBanner";
import { recordRescueEvent } from "@/services/api";
import { canShowPurchaseUI } from "@/config/payments";

// Subscription Rescue Funnel banner. Rendered below the TrialCountdownBanner
// in the app shell; auto-hides when the user has nothing to rescue (healthy
// sub, never-paid free user, admin, or trial-only premium).
//
// Tone styling:
//   celebrate / we_miss_you      → calm green
//   loss_aversion                → gentle amber
//   urgent / graceful            → red-orange (high contrast for the
//                                   1-day-left + expiry-day moments)
//   dna_fading                   → muted blue (informational)
//   last_call                    → soft slate (no pressure)

const TONE_STYLES = {
  celebrate:     { bg: "linear-gradient(90deg,#D1FAE5 0%,#A7F3D0 100%)", accent: "#059669", text: "#065F46", icon: "🎯" },
  loss_aversion: { bg: "linear-gradient(90deg,#FEF3C7 0%,#FDE68A 100%)", accent: "#D97706", text: "#92400E", icon: "⌛" },
  urgent:        { bg: "linear-gradient(90deg,#FEE2E2 0%,#FECACA 100%)", accent: "#DC2626", text: "#991B1B", icon: "⏰" },
  graceful:      { bg: "linear-gradient(90deg,#FFE4D6 0%,#FED7AA 100%)", accent: "#EA580C", text: "#9A3412", icon: "🪄" },
  we_miss_you:   { bg: "linear-gradient(90deg,#E0F2FE 0%,#BAE6FD 100%)", accent: "#0284C7", text: "#075985", icon: "👋" },
  dna_fading:    { bg: "linear-gradient(90deg,#E0E7FF 0%,#C7D2FE 100%)", accent: "#4F46E5", text: "#3730A3", icon: "🧬" },
  last_call:     { bg: "linear-gradient(90deg,#F1F5F9 0%,#E2E8F0 100%)", accent: "#475569", text: "#1E293B", icon: "✉️" },
};

export default function RescueBanner({ onUpgrade }) {
  const { banner, loading } = useRescueBanner();
  const tone = useMemo(
    () => (banner?.tone && TONE_STYLES[banner.tone]) || TONE_STYLES.celebrate,
    [banner?.tone]
  );

  // The rescue funnel exists only to recover a lapsed subscription; with no
  // checkout available it has nowhere to send the user.
  if (!canShowPurchaseUI()) return null;
  if (loading || !banner) return null;

  const handleCta = () => {
    recordRescueEvent("rescue_banner_cta_clicked", banner.touchpoint, {
      phase: banner.phase,
      tone: banner.tone,
    });
    if (typeof onUpgrade === "function") onUpgrade();
  };

  const handleDismiss = () => {
    recordRescueEvent("rescue_banner_dismissed", banner.touchpoint, {
      phase: banner.phase,
    });
    // No client-side hide — server decides whether to keep showing on next
    // poll. Dismiss is purely an analytics signal (users who close every
    // touchpoint are different from users who renew).
  };

  return (
    <div
      role="region"
      aria-label="Subscription renewal"
      style={{
        background: tone.bg,
        color: tone.text,
        padding: "12px 16px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        fontFamily: "'Plus Jakarta Sans', sans-serif",
        borderBottom: `1px solid ${tone.accent}22`,
      }}
    >
      <div style={{ fontSize: 22, lineHeight: 1, flexShrink: 0 }} aria-hidden="true">
        {tone.icon}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13,
          fontWeight: 800,
          letterSpacing: "-0.01em",
          lineHeight: 1.3,
        }}>
          {banner.headline}
        </div>
        <div style={{
          fontSize: 12,
          color: `${tone.text}cc`,
          marginTop: 2,
          lineHeight: 1.4,
        }}>
          {banner.body}
        </div>
      </div>

      {banner.metricValue && (
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          padding: "6px 12px",
          background: "rgba(255,255,255,0.55)",
          border: `1px solid ${tone.accent}33`,
          borderRadius: 10,
          flexShrink: 0,
        }}>
          <span style={{
            fontSize: 10,
            fontWeight: 700,
            color: tone.text,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}>
            {banner.metricLabel}
          </span>
          <span style={{
            fontSize: 14,
            fontWeight: 800,
            color: tone.accent,
            marginTop: 1,
          }}>
            {banner.metricValue}
          </span>
        </div>
      )}

      <button
        type="button"
        onClick={handleCta}
        style={{
          background: tone.accent,
          color: "#fff",
          border: "none",
          padding: "10px 18px",
          borderRadius: 99,
          fontSize: 13,
          fontWeight: 800,
          cursor: "pointer",
          whiteSpace: "nowrap",
          boxShadow: "0 4px 10px rgba(0,0,0,0.12)",
          flexShrink: 0,
        }}
      >
        {banner.ctaLabel}
      </button>

      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss"
        style={{
          background: "transparent",
          border: "none",
          color: `${tone.text}99`,
          cursor: "pointer",
          padding: 4,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
