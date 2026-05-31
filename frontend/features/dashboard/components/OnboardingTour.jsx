"use client";

import { useEffect, useState, useCallback } from "react";
import { Joyride } from "react-joyride";
import { markWelcomeGuideSeen } from "@/services/api";

// ── Tour steps ────────────────────────────────────────────────────────────────
const STEPS = [
  {
    target: "body",
    placement: "center",
    disableBeacon: true,
    title: "Welcome to Edgecipline! 👋",
    content: "This quick tour shows you exactly where everything is. Tap Next and we'll highlight each part of the app for you.",
  },
  {
    target: "#tour-kpi-grid",
    placement: "bottom",
    disableBeacon: true,
    title: "Your Performance Stats 📊",
    content: "These 4 cards update live — Total Trades, Win Rate, Net P&L, and Win Streak. Your trading health at a glance.",
  },
  {
    target: "#tour-equity-curve",
    placement: "top",
    disableBeacon: true,
    title: "Equity Curve 📈",
    content: "This chart shows how your account value has grown or shrunk over time across all your logged trades.",
  },
  {
    target: "#tour-create-trade",
    placement: "bottom",
    disableBeacon: true,
    title: "Log a Trade ✍️",
    content: "Tap this button to manually add a trade — fill in entry, exit, P&L, psychology, and more.",
  },
  {
    target: "#tour-card-journal",
    placement: "top",
    disableBeacon: true,
    title: "Trade Journal 📓",
    content: "Your full trade history. Filter by date, pair, or result. The foundation of all your analytics.",
  },
  {
    target: "#tour-card-ai",
    placement: "top",
    disableBeacon: true,
    title: "AI Trade Extractor 🤖",
    content: "Screenshot your broker platform — our AI reads it and auto-fills the trade details. No manual typing needed.",
  },
  {
    target: "#tour-card-analytics",
    placement: "top",
    disableBeacon: true,
    title: "Analytics 📉",
    content: "Deep-dive charts — win rate by pair, session performance, psychology patterns, drawdown analysis, and more.",
  },
  {
    target: "#tour-card-checklist",
    placement: "top",
    disableBeacon: true,
    title: "Pre-Trade Checklist ✅",
    content: "Run through your rules before entering any trade. Get a confidence score so you only take high-quality setups.",
  },
  {
    target: "#tour-card-setups",
    placement: "top",
    disableBeacon: true,
    title: "Setups & Strategies 🎯",
    content: "Document your trading strategies here. Link them to checklist rules and track which setups are actually profitable.",
  },
  {
    target: "#tour-card-reports",
    placement: "top",
    disableBeacon: true,
    title: "AI Weekly Reports 🧠",
    content: "Every week, Gemini AI analyses your trades and writes a personalised coaching report with actionable tips.",
  },
  {
    target: "#tour-nav",
    placement: "bottom",
    disableBeacon: true,
    title: "Navigation Bar 🔗",
    content: "Use these links to jump between Journal, Analytics, Checklist, Setups, Profile, and Reports from any page.",
  },
  {
    target: "#tour-market-switcher",
    placement: "bottom",
    disableBeacon: true,
    title: "Switch Markets 🌐",
    content: "Toggle between Forex (MT4/MT5) and Indian Market (Zerodha, Upstox, Groww, Angel One) with one tap.",
  },
];

// ── Custom tooltip ────────────────────────────────────────────────────────────
function TourTooltip({ index, step, backProps, primaryProps, tooltipProps }) {
  const isLast  = index === STEPS.length - 1;
  const isFirst = index === 0;
  const progress = Math.round(((index + 1) / STEPS.length) * 100);

  return (
    <div
      {...tooltipProps}
      style={{
        background: "#0F1923",
        borderRadius: 16,
        width: 300,
        boxShadow: "0 20px 60px rgba(0,0,0,0.55), 0 0 0 1px rgba(34,199,142,0.25)",
        fontFamily: "'Plus Jakarta Sans', sans-serif",
        overflow: "hidden",
        animation: "tourEnter 0.28s cubic-bezier(0.34,1.56,0.64,1) both",
      }}
    >
      {/* Header */}
      <div style={{
        padding: "12px 16px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 9, color: "#22C78E", fontFamily: "monospace", letterSpacing: "0.1em", fontWeight: 700 }}>
            APP TOUR
          </span>
          <span style={{
            background: "rgba(34,199,142,0.15)", color: "#22C78E",
            fontSize: 9, fontWeight: 700, padding: "2px 7px",
            borderRadius: 20, border: "1px solid rgba(34,199,142,0.25)",
          }}>
            {index + 1} / {STEPS.length}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ height: 2, background: "rgba(255,255,255,0.05)" }}>
        <div style={{
          height: "100%", width: `${progress}%`,
          background: "linear-gradient(90deg, #22C78E, #0D9E6E)",
          transition: "width 0.35s ease",
        }} />
      </div>

      {/* Content */}
      <div style={{ padding: "14px 16px 12px" }}>
        {step.title && (
          <div style={{ fontSize: 14, fontWeight: 800, color: "#F1F5F9", marginBottom: 8, lineHeight: 1.3 }}>
            {step.title}
          </div>
        )}
        <div style={{
          fontSize: 12, color: "#94A3B8", lineHeight: 1.7,
          borderLeft: "2px solid rgba(34,199,142,0.4)", paddingLeft: 10,
        }}>
          {step.content}
        </div>
      </div>

      {/* Step dots */}
      <div style={{ display: "flex", justifyContent: "center", gap: 4, paddingBottom: 12 }}>
        {STEPS.map((_, i) => (
          <div key={i} style={{
            width: i === index ? 18 : 5, height: 5, borderRadius: 3,
            background: i === index ? "#22C78E" : i < index ? "#334155" : "#1E293B",
            transition: "all 0.3s",
          }} />
        ))}
      </div>

      {/* Buttons */}
      <div style={{
        padding: "10px 16px 14px",
        borderTop: "1px solid rgba(255,255,255,0.06)",
        display: "flex", gap: 8,
      }}>
        {!isFirst && (
          <button
            {...backProps}
            style={{
              flex: 1, padding: "9px 0",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "#94A3B8", borderRadius: 9,
              fontSize: 12, fontWeight: 700, cursor: "pointer",
            }}
          >
            ← Back
          </button>
        )}
        <button
          {...primaryProps}
          style={{
            flex: isFirst ? 1 : 2, padding: "9px 0",
            background: isLast
              ? "linear-gradient(135deg, #0D9E6E, #0a7a55)"
              : "linear-gradient(135deg, #22C78E, #0D9E6E)",
            border: "none", color: "#fff", borderRadius: 9,
            fontSize: 12, fontWeight: 800, cursor: "pointer",
            letterSpacing: "0.04em",
            boxShadow: "0 3px 12px rgba(13,158,110,0.3)",
          }}
        >
          {isLast ? "🚀 Start Journaling!" : "Next →"}
        </button>
      </div>

      <style>{`
        @keyframes tourEnter {
          from { opacity: 0; transform: scale(0.88) translateY(10px); }
          to   { opacity: 1; transform: scale(1)    translateY(0);    }
        }
      `}</style>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function OnboardingTour({ onFinish }) {
  // mounted guard — Joyride touches the DOM, never render on the server
  const [mounted, setMounted] = useState(false);
  const [run,     setRun    ] = useState(false);

  useEffect(() => {
    // Small delay so every DOM target element is fully painted before Joyride queries them
    const t = setTimeout(() => {
      setMounted(true);
      setRun(true);
    }, 800);
    return () => clearTimeout(t);
  }, []);

  const handleCallback = useCallback(
    ({ status, action }) => {
      if (status === "finished" || status === "skipped" || action === "skip") {
        setRun(false);
        localStorage.setItem("hasSeenWelcomeGuide", "true");
        markWelcomeGuideSeen().catch(() => {
          localStorage.setItem("hasSeenWelcomeGuide", "true");
        });
        onFinish?.();
      }
    },
    [onFinish]
  );

  if (!mounted) return null;

  return (
    <Joyride
      steps={STEPS}
      run={run}
      continuous
      showSkipButton={false}
      disableOverlayClose
      spotlightPadding={6}
      scrollToFirstStep
      disableScrollParentFix
      tooltipComponent={TourTooltip}
      callback={handleCallback}
      styles={{
        options: {
          zIndex: 10000,
          overlayColor: "rgba(5, 10, 18, 0.72)",
          spotlightShadow: "0 0 0 3px rgba(34,199,142,0.5), 0 0 0 8px rgba(34,199,142,0.12)",
          arrowColor: "#0F1923",
        },
      }}
    />
  );
}
