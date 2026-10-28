"use client";

import { useMemo, useState } from "react";
import { useRescueBanner } from "@/features/shared/hooks/useRescueBanner";
import useIsNarrow from "@/features/shared/hooks/useIsNarrow";
import { recordRescueEvent } from "@/services/api";
import { canShowPurchaseUI } from "@/config/payments";

// Funnel banner. Rendered below the TrialCountdownBanner in the app shell and
// fed by GET /rescue/banner, which serves two funnels in priority order:
//
//   subscription_rescue — expiring / lapsed paid users (the original)
//   free_tier           — never-paid users who used their free trades
//
// The server never returns both; `banner.funnel` says which one this is so
// the analytics beacons and the aria label stay accurate. Auto-hides when
// there is nothing to show (healthy sub, free user with trades left, admin,
// trial-only premium, or a funnel that has run its course).
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

// Event names per funnel. Both go through the same allowlisted endpoint.
const EVENTS = {
  subscription_rescue: { cta: "rescue_banner_cta_clicked", dismiss: "rescue_banner_dismissed" },
  free_tier:           { cta: "free_nudge_cta_clicked",    dismiss: "free_nudge_dismissed" },
};

// Below this width the banner stacks (see the render). 600 rather than the 640
// the trade table uses: at 620 the single row still reads fine here, and the
// stacked form is taller, so we switch as late as we can.
const STACK_BELOW_PX = 600;

// Where the dismissal lives. GET /rescue/banner carries no dismiss state and
// this funnel has no dismiss endpoint (/free-tier/sheet-dismissed belongs to
// LastFreeTradeSheet, a different surface), so the X has to be honoured on the
// client or it does nothing at all.
//
// Keyed by touchpoint on purpose: closing "3 days left" must not also close
// "expires today" once the funnel advances.
const DISMISS_KEY_PREFIX = "rescueBannerDismissed:";

// Every access is guarded. This runs inside a Capacitor WebView, where
// localStorage can throw outright rather than return null — storage disabled,
// app data cleared mid-session, quota exceeded.
function readDismissed(touchpoint) {
  if (!touchpoint || typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(`${DISMISS_KEY_PREFIX}${touchpoint}`) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(touchpoint) {
  if (!touchpoint || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${DISMISS_KEY_PREFIX}${touchpoint}`, "1");
  } catch {
    // Dismissal degrades to session-only, which still beats a dead X.
  }
}

export function bannerFunnel(banner) {
  return banner?.funnel === "free_tier" ? "free_tier" : "subscription_rescue";
}

export default function RescueBanner({ onUpgrade }) {
  const { banner, loading } = useRescueBanner();
  const stacked = useIsNarrow(STACK_BELOW_PX);
  const tone = useMemo(
    () => (banner?.tone && TONE_STYLES[banner.tone]) || TONE_STYLES.celebrate,
    [banner?.tone]
  );

  const touchpoint = banner?.touchpoint || null;

  // Read during render, not in an effect: an effect runs after paint, so a
  // dismissed banner would flash for a frame on every 5-minute poll and every
  // page transition. Re-reads only when the touchpoint changes.
  const persistedDismissed = useMemo(() => readDismissed(touchpoint), [touchpoint]);

  // Optimistic hide for this session. Holding the touchpoint instead of a
  // boolean means it clears itself when the funnel moves to a new message.
  const [dismissedTouchpoint, setDismissedTouchpoint] = useState(null);

  // Both funnels exist only to lead to a purchase; with no checkout available
  // they have nowhere to send the user.
  if (!canShowPurchaseUI()) return null;
  if (loading || !banner) return null;
  if (persistedDismissed || dismissedTouchpoint === touchpoint) return null;

  const funnel = bannerFunnel(banner);
  const events = EVENTS[funnel];

  const handleCta = () => {
    recordRescueEvent(events.cta, banner.touchpoint, {
      funnel,
      surface: "banner",
      phase: banner.phase,
      tone: banner.tone,
    });
    if (typeof onUpgrade === "function") onUpgrade();
  };

  const handleDismiss = () => {
    // Hide first, persist second, report third. recordRescueEvent swallows its
    // own failures and is deliberately not awaited — a dead network must never
    // leave the banner on screen.
    setDismissedTouchpoint(touchpoint);
    writeDismissed(touchpoint);
    recordRescueEvent(events.dismiss, banner.touchpoint, {
      funnel,
      phase: banner.phase,
    });
  };

  const iconEl = (
    <div
      style={{ fontSize: stacked ? 18 : 22, lineHeight: 1, flexShrink: 0 }}
      aria-hidden="true"
    >
      {tone.icon}
    </div>
  );

  // minWidth: 0 is what stops this column collapsing to a sliver beside the
  // flexShrink: 0 siblings. Both strings come from the server, so both are
  // clamped when stacked: the height budget has to hold for any length.
  const textEl = (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div
        className={stacked ? "rb-clamp rb-clamp-1" : undefined}
        style={{
          fontSize: 13,
          fontWeight: 800,
          letterSpacing: "-0.01em",
          lineHeight: stacked ? 1.15 : 1.3,
          overflowWrap: "anywhere",
        }}
      >
        {banner.headline}
      </div>
      <div
        // Clamped only when stacked: the single row has the width to wrap a
        // long body without hurting anything, and that is how it behaves today.
        className={stacked ? "rb-clamp rb-clamp-2" : undefined}
        style={{
          fontSize: stacked ? 11.5 : 12,
          color: `${tone.text}cc`,
          marginTop: stacked ? 1 : 2,
          lineHeight: stacked ? 1.25 : 1.4,
          overflowWrap: "anywhere",
        }}
      >
        {banner.body}
      </div>
    </div>
  );

  const metricEl = banner.metricValue ? (
    <div style={{
      display: "flex",
      flexDirection: "column",
      // Stacked, the pill sits beside the CTA. It stays label-over-value
      // rather than going inline: side by side the uppercase label is wide
      // enough to squeeze the CTA down to nothing on a 360px screen.
      alignItems: stacked ? "flex-start" : "flex-end",
      justifyContent: "center",
      padding: stacked ? "3px 9px" : "6px 12px",
      background: "rgba(255,255,255,0.55)",
      border: `1px solid ${tone.accent}33`,
      borderRadius: 10,
      flexShrink: 0,
    }}>
      <span style={{
        fontSize: "var(--fs-2xs)",
        fontWeight: 700,
        color: tone.text,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        whiteSpace: "nowrap",
        lineHeight: stacked ? 1.15 : 1.3,
      }}>
        {banner.metricLabel}
      </span>
      <span style={{
        fontSize: stacked ? 13 : 14,
        fontWeight: 800,
        color: tone.accent,
        marginTop: stacked ? 0 : 1,
        whiteSpace: "nowrap",
        lineHeight: stacked ? 1.15 : 1.3,
      }}>
        {banner.metricValue}
      </span>
    </div>
  ) : null;

  const ctaEl = (
    <button
      type="button"
      className={stacked ? "rb-cta rb-cta-stacked" : undefined}
      onClick={handleCta}
      style={{
        background: tone.accent,
        color: "#fff",
        border: "none",
        padding: stacked ? "0 14px" : "10px 18px",
        borderRadius: 99,
        fontSize: stacked ? 12.5 : 13,
        fontWeight: 800,
        cursor: "pointer",
        whiteSpace: "nowrap",
        boxShadow: "0 4px 10px rgba(0,0,0,0.12)",
        flexShrink: 0,
        // Stacked, the CTA takes whatever width the metric pill leaves.
        ...(stacked ? { flex: 1, minWidth: 0 } : null),
      }}
    >
      {/* The label, not the button, owns the clipping: overflow on the button
          would also clip its own hit overlay (see .rb-cta-stacked::after). */}
      {stacked ? <span className="rb-cta-label">{banner.ctaLabel}</span> : banner.ctaLabel}
    </button>
  );

  // A real tap target around the same 14px glyph — 48x48, the floor
  // mobile-optimizations.css puts on every button, comfortably over the 44
  // minimum. The negative margins let it overhang the banner's padding box, so
  // the bigger target costs no banner height.
  const closeEl = (
    <button
      type="button"
      className="rb-close"
      onClick={handleDismiss}
      aria-label="Dismiss"
      style={stacked
        ? { marginTop: -5, marginBottom: -5, marginRight: -6 }
        : { marginTop: -6, marginBottom: -6, marginRight: -10 }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  );

  return (
    <div
      role="region"
      aria-label={funnel === "free_tier" ? "Free plan upgrade" : "Subscription renewal"}
      style={{
        background: tone.bg,
        color: tone.text,
        display: "flex",
        fontFamily: "'Plus Jakarta Sans', sans-serif",
        borderBottom: `1px solid ${tone.accent}22`,
        // Tone colours handed to the <style jsx> rules below, which cannot read
        // the tone object. Keeps the close button's hover/active/focus states
        // tone-aware without hardcoding one palette.
        "--rb-accent": tone.accent,
        "--rb-text": tone.text,
        "--rb-text-muted": `${tone.text}99`,
        ...(stacked ? {
          flexDirection: "column",
          // The 96px budget, stacked: 10 padding + 45 of clamped copy + 4 gap
          // + a ~36 action row. Tight on purpose — the action row cannot go
          // below 36 without dropping under a comfortable tap target, so the
          // slack lives in the copy, which is what the clamps bound.
          gap: 4,
          padding: "5px 10px",
          // Hard ceiling. The clamps keep the content inside it; this is the
          // guarantee that no server string can push the sticky header off
          // screen even where -webkit-line-clamp is unsupported.
          maxHeight: 96,
          overflow: "hidden",
        } : {
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          padding: "12px 16px",
        }),
      }}
    >
      {stacked ? (
        <>
          {/* Row 1: icon + copy, close pinned to the top-right corner and well
              away from the CTA, so a mis-tap cannot open checkout. */}
          <div className="rb-row rb-row-top">
            {iconEl}
            {textEl}
            {closeEl}
          </div>
          {/* Row 2: metric then CTA. Rendered with or without a metric so the
              CTA keeps its own line and never crowds the copy. */}
          <div className="rb-row rb-row-actions">
            {metricEl}
            {ctaEl}
          </div>
        </>
      ) : (
        <>
          {iconEl}
          {textEl}
          {metricEl}
          {ctaEl}
          {closeEl}
        </>
      )}

      {/* global, not scoped: styled-jsx only stamps its scope class onto the
          JSX inside this return, and the banner's parts are built as variables
          above, so scoped rules would silently miss every one of them. The
          rb- prefix is what keeps these out of everyone else's way. */}
      <style jsx global>{`
        .rb-row {
          display: flex;
          width: 100%;
          min-width: 0;
        }
        .rb-row-top {
          align-items: flex-start;
          gap: 10px;
        }
        .rb-row-actions {
          align-items: stretch;
          gap: 8px;
        }
        /* -webkit-line-clamp needs the box display and orientation to come
           with it, and all three have to survive the inline-style round trip —
           so they live here rather than in a style object. */
        .rb-clamp {
          display: -webkit-box;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .rb-clamp-1 {
          -webkit-line-clamp: 1;
        }
        .rb-clamp-2 {
          -webkit-line-clamp: 2;
        }
        /* The global button floor (min-height: 48px, mobile-optimizations.css)
           is right for a standalone control but would spend half the banner on
           the action row. Overridden to the row height, with the target
           restored as a transparent overlay: the painted pill is ~35px tall and
           answers a ~46px tap, clearing the 44 minimum without the layout cost.
           The overlay reaches further up than down on purpose — downwards it
           would be clipped by the banner's own maxHeight. */
        .rb-cta-stacked {
          position: relative;
          min-height: 0;
          min-width: 0;
          height: auto;
        }
        .rb-cta-stacked::after {
          content: "";
          position: absolute;
          left: 0;
          right: 0;
          top: -7px;
          bottom: -4px;
        }
        .rb-cta-label {
          display: block;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .rb-close {
          /* The old 22px target read as decoration rather than a control —
             half the reason the X felt unclickable. 48 is the global floor and
             clears the 44 minimum. */
          width: 48px;
          height: 48px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          background: transparent;
          border: none;
          border-radius: 999px;
          color: var(--rb-text-muted);
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
          transition: background 140ms ease, color 140ms ease, transform 90ms ease;
        }
        .rb-close:hover {
          background: rgba(255, 255, 255, 0.6);
          color: var(--rb-text);
        }
        .rb-close:active {
          background: rgba(255, 255, 255, 0.85);
          transform: scale(0.92);
        }
        .rb-close:focus-visible {
          outline: 2px solid var(--rb-accent);
          outline-offset: 2px;
        }
      `}</style>
    </div>
  );
}
