"use client";

import { useState } from "react";

// ── Tour steps covering every major feature ──────────────────────────────────
const STEPS = [
  {
    id: "welcome",
    icon: "🚀",
    title: "Welcome to Edgecipline AI",
    subtitle: "YOUR PREMIUM TRADING COMPANION",
    desc: "This quick guide walks you through every feature so you can start trading smarter. It only takes a minute — let's go!",
    features: [
      { icon: "📊", text: "Track every trade with full analytics" },
      { icon: "🤖", text: "AI-powered screenshot trade extraction" },
      { icon: "🧠", text: "Weekly AI coaching reports" },
      { icon: "🇮🇳", text: "Supports Forex & Indian Market" },
    ],
  },
  {
    id: "dashboard",
    icon: "📊",
    title: "Dashboard",
    subtitle: "YOUR TRADING COMMAND CENTER",
    desc: "The dashboard gives you an instant snapshot of your trading performance every time you log in.",
    features: [
      { icon: "📈", text: "Total Trades — how many trades you've logged" },
      { icon: "🎯", text: "Win Rate — % of profitable trades" },
      { icon: "💰", text: "Net P&L — your total profit or loss" },
      { icon: "🔥", text: "Win Streak — consecutive winning trades" },
      { icon: "📉", text: "Equity Curve — visual account growth chart" },
    ],
  },
  {
    id: "journal",
    icon: "📓",
    title: "Trade Log",
    subtitle: "LOG EVERY TRADE YOU TAKE",
    desc: "Your complete trading diary. Add trades manually with full details — psychology, mistakes, strategy, and more.",
    features: [
      { icon: "✍️", text: "Add pair, direction, entry, exit & P&L" },
      { icon: "😤", text: "Log your emotions & psychology each trade" },
      { icon: "❌", text: "Tag mistakes to identify recurring errors" },
      { icon: "🔍", text: "Filter & search trades by date, pair, result" },
      { icon: "✏️", text: "Edit or delete trades to keep data clean" },
    ],
  },
  {
    id: "ai-extractor",
    icon: "🤖",
    title: "AI Trade Extractor",
    subtitle: "IMPORT TRADES FROM SCREENSHOTS",
    desc: "Take a screenshot from your trading platform, upload it, and our AI automatically reads and fills in all the trade details.",
    features: [
      { icon: "📸", text: "Upload MT4 / MT5 screenshots for Forex" },
      { icon: "🇮🇳", text: "Supports Zerodha, Upstox, Groww, Angel One" },
      { icon: "⚡", text: "AI auto-fills pair, entry, exit & P&L" },
      { icon: "🎯", text: "Select your strategy before saving" },
      { icon: "✅", text: "Review & confirm extracted data before logging" },
    ],
  },
  {
    id: "analytics",
    icon: "📈",
    title: "Analytics",
    subtitle: "DEEP PERFORMANCE INSIGHTS",
    desc: "Go beyond basic stats. Understand exactly what's working and what's costing you money.",
    features: [
      { icon: "📊", text: "P&L trend charts over any time period" },
      { icon: "🏆", text: "Best & worst performing currency pairs" },
      { icon: "⏰", text: "Session analysis — Asia, London, New York" },
      { icon: "🧠", text: "Psychological pattern detection from your data" },
      { icon: "📅", text: "Calendar heatmap of daily P&L" },
    ],
  },
  {
    id: "checklist",
    icon: "✅",
    title: "Pre-Trade Checklist",
    subtitle: "SCORE YOUR TRADE CONFIDENCE",
    desc: "Before you enter a trade, run through your setup rules and get an objective confidence score. Avoid low-quality trades.",
    features: [
      { icon: "🅰️", text: "A+ Rating — all rules met, maximum confidence" },
      { icon: "🟡", text: "Moderate — most rules met, proceed carefully" },
      { icon: "🔴", text: "Low Rating — key rules missing, skip the trade" },
      { icon: "📋", text: "Fully custom rules per strategy" },
      { icon: "📊", text: "Track your checklist adherence over time" },
    ],
  },
  {
    id: "setups",
    icon: "🎯",
    title: "Setups & Strategies",
    subtitle: "DEFINE YOUR TRADING PLAYBOOKS",
    desc: "Create named strategies with their own rules and reference chart images. Link them to your checklist and trade entries.",
    features: [
      { icon: "📖", text: "Name your setups (e.g. 'Breakout', 'Reversal')" },
      { icon: "📏", text: "Add specific entry rules & trade conditions" },
      { icon: "🖼️", text: "Upload reference chart images for each setup" },
      { icon: "🔗", text: "Link setups to pre-trade checklist scoring" },
      { icon: "📊", text: "See performance stats for each strategy" },
    ],
  },
  {
    id: "reports",
    icon: "🧠",
    title: "AI Weekly Reports",
    subtitle: "PERSONALIZED COACHING EVERY WEEK",
    desc: "Gemini AI analyses all your trade data and generates a tailored coaching report every week to help you improve.",
    features: [
      { icon: "📝", text: "Full summary of your week's performance" },
      { icon: "💡", text: "Actionable insights on what to improve" },
      { icon: "⏰", text: "Best trading time windows based on your data" },
      { icon: "📊", text: "Risk management & position sizing suggestions" },
      { icon: "🔄", text: "Fresh new report generated every Monday" },
    ],
  },
  {
    id: "markets",
    icon: "🌐",
    title: "Forex & Indian Market",
    subtitle: "SWITCH MARKETS INSTANTLY",
    desc: "Edgecipline supports both global Forex and Indian stock & F&O markets. Switch between them any time from the top navigation bar.",
    features: [
      { icon: "💱", text: "Forex — MT4/MT5 global currency pairs" },
      { icon: "🇮🇳", text: "Indian Market — NSE/BSE stocks & F&O" },
      { icon: "🔀", text: "Tap the market switcher in the header" },
      { icon: "📊", text: "Separate analytics & trade logs per market" },
      { icon: "🤖", text: "AI extraction tailored to each broker's UI" },
    ],
  },
  {
    id: "done",
    icon: "🎉",
    title: "You're All Set!",
    subtitle: "START BUILDING YOUR EDGE",
    desc: "You now know everything Edgecipline has to offer. Start by logging your first trade — manually or via AI screenshot extraction.",
    callout: "💡 Tip: Add your trading setups first, then use the checklist before every trade to stay disciplined!",
  },
];

// ─────────────────────────────────────────────────────────────────────────────

export default function WelcomeGuide({ onClose }) {
  const [step, setStep]         = useState(0);
  const [animDir, setAnimDir]   = useState("forward"); // "forward" | "back"
  const [animKey, setAnimKey]   = useState(0);

  const current = STEPS[step];
  const isLast  = step === STEPS.length - 1;
  const isFirst = step === 0;
  const progress = ((step + 1) / STEPS.length) * 100;

  const goTo = (next, dir = "forward") => {
    setAnimDir(dir);
    setAnimKey(k => k + 1);
    setStep(next);
  };

  const handleNext = () => {
    if (isLast) { onClose(); return; }
    goTo(step + 1, "forward");
  };

  const handlePrev = () => {
    if (isFirst) return;
    goTo(step - 1, "back");
  };

  const handleDotClick = (i) => {
    goTo(i, i > step ? "forward" : "back");
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 2000,
      background: "rgba(10,18,26,0.92)",
      backdropFilter: "blur(10px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "16px",
    }}>
      <div style={{
        background: "#FFFFFF",
        width: "100%", maxWidth: 500,
        borderRadius: 24,
        overflow: "hidden",
        border: "1px solid #E2E8F0",
        boxShadow: "0 32px 80px rgba(0,0,0,0.4)",
        animation: "guideEnter 0.45s cubic-bezier(0.34,1.56,0.64,1) both",
        display: "flex", flexDirection: "column",
        maxHeight: "92vh",
      }}>

        {/* ── Top bar ── */}
        <div style={{
          background: "#0F1923",
          padding: "14px 20px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{
              fontSize: 10, color: "#22C78E", fontFamily: "monospace",
              letterSpacing: "0.12em", fontWeight: 700,
            }}>
              EDGECIPLINE GUIDE
            </span>
            <span style={{
              background: "rgba(34,199,142,0.15)", color: "#22C78E",
              fontSize: 10, fontWeight: 700, padding: "2px 9px",
              borderRadius: 20, border: "1px solid rgba(34,199,142,0.25)",
            }}>
              {step + 1} / {STEPS.length}
            </span>
          </div>
        </div>

        {/* ── Progress bar ── */}
        <div style={{ height: 3, background: "#E2E8F0", flexShrink: 0 }}>
          <div style={{
            height: "100%",
            background: "linear-gradient(90deg, #22C78E, #0D9E6E)",
            width: `${progress}%`,
            transition: "width 0.4s ease",
          }} />
        </div>

        {/* ── Scrollable content ── */}
        <div
          key={animKey}
          style={{
            padding: "24px 24px 20px",
            flex: 1, overflowY: "auto",
            animation: `${animDir === "forward" ? "slideInRight" : "slideInLeft"} 0.3s ease both`,
          }}
        >
          {/* Icon + Title */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 16 }}>
            <div style={{
              width: 52, height: 52, borderRadius: 14,
              background: "linear-gradient(135deg, #F0FDF4 0%, #ECFDF5 100%)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 26, flexShrink: 0,
              border: "1px solid rgba(13,158,110,0.15)",
              boxShadow: "0 2px 8px rgba(13,158,110,0.1)",
            }}>
              {current.icon}
            </div>
            <div style={{ paddingTop: 2 }}>
              <h2 style={{
                fontSize: 19, fontWeight: 800, color: "#0F1923",
                margin: 0, lineHeight: 1.25,
                fontFamily: "'Plus Jakarta Sans', sans-serif",
              }}>
                {current.title}
              </h2>
              <p style={{
                fontSize: 10, color: "#22C78E", margin: "5px 0 0",
                fontWeight: 700, letterSpacing: "0.1em",
              }}>
                {current.subtitle}
              </p>
            </div>
          </div>

          {/* Description */}
          <div style={{
            fontSize: 13, color: "#475569", lineHeight: 1.7,
            margin: "0 0 18px",
            padding: "11px 14px",
            background: "#F8FAFC",
            borderRadius: 10,
            borderLeft: "3px solid #22C78E",
          }}>
            {current.desc}
          </div>

          {/* Feature list */}
          {current.features && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {current.features.map((f, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "9px 13px",
                  borderRadius: 9,
                  background: i % 2 === 0 ? "#F8FAFC" : "#FFFFFF",
                  border: "1px solid #F1F5F9",
                  transition: "background 0.15s",
                }}>
                  <span style={{ fontSize: 16, flexShrink: 0, lineHeight: 1 }}>{f.icon}</span>
                  <span style={{ fontSize: 13, color: "#334155", lineHeight: 1.4 }}>{f.text}</span>
                </div>
              ))}
            </div>
          )}

          {/* Last step callout */}
          {current.callout && (
            <div style={{
              marginTop: 18,
              padding: "14px 16px",
              background: "linear-gradient(135deg, #F0FDF4 0%, #ECFDF5 100%)",
              borderRadius: 12,
              border: "1px solid rgba(13,158,110,0.2)",
              fontSize: 13, color: "#166534", lineHeight: 1.6,
              fontWeight: 500,
            }}>
              {current.callout}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div style={{
          padding: "16px 24px 20px",
          borderTop: "1px solid #F1F5F9",
          flexShrink: 0,
          background: "#FAFBFC",
        }}>
          {/* Step dots */}
          <div style={{ display: "flex", justifyContent: "center", gap: 5, marginBottom: 14 }}>
            {STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => handleDotClick(i)}
                aria-label={`Go to step ${i + 1}`}
                style={{
                  width: i === step ? 22 : 7,
                  height: 7,
                  borderRadius: 4,
                  background: i === step ? "#22C78E" : i < step ? "#94A3B8" : "#E2E8F0",
                  border: "none", cursor: "pointer", padding: 0,
                  transition: "all 0.3s ease",
                  outline: "none",
                }}
              />
            ))}
          </div>

          {/* Nav buttons */}
          <div style={{ display: "flex", gap: 10 }}>
            {!isFirst && (
              <button
                onClick={handlePrev}
                style={{
                  flex: 1, padding: "12px",
                  background: "#FFFFFF", color: "#475569",
                  border: "1px solid #E2E8F0",
                  borderRadius: 11, fontSize: 13, fontWeight: 700,
                  cursor: "pointer", transition: "all 0.2s",
                }}
                onMouseEnter={e => { e.currentTarget.style.background = "#F1F5F9"; e.currentTarget.style.borderColor = "#CBD5E0"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "#FFFFFF"; e.currentTarget.style.borderColor = "#E2E8F0"; }}
              >
                ← Back
              </button>
            )}

            <button
              onClick={handleNext}
              style={{
                flex: isFirst ? 1 : 2,
                padding: "12px",
                background: isLast
                  ? "linear-gradient(135deg, #0D9E6E 0%, #0a7a55 100%)"
                  : "linear-gradient(135deg, #0F1923 0%, #1a2d3d 100%)",
                color: "#FFFFFF",
                border: isLast ? "1px solid rgba(13,158,110,0.4)" : "1px solid rgba(34,199,142,0.3)",
                borderRadius: 11, fontSize: 13, fontWeight: 800,
                cursor: "pointer", letterSpacing: "0.06em",
                transition: "all 0.2s",
                boxShadow: isLast ? "0 4px 14px rgba(13,158,110,0.25)" : "0 4px 14px rgba(0,0,0,0.15)",
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = isLast ? "0 6px 20px rgba(13,158,110,0.35)" : "0 6px 20px rgba(0,0,0,0.2)"; }}
              onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = isLast ? "0 4px 14px rgba(13,158,110,0.25)" : "0 4px 14px rgba(0,0,0,0.15)"; }}
            >
              {isLast
                ? "🚀 START BUILDING DISCIPLINE"
                : `NEXT: ${STEPS[step + 1].title} →`}
            </button>
          </div>

        </div>
      </div>

      <style>{`
        @keyframes guideEnter {
          from { opacity: 0; transform: scale(0.92) translateY(20px); }
          to   { opacity: 1; transform: scale(1)    translateY(0);    }
        }
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(24px); }
          to   { opacity: 1; transform: translateX(0);    }
        }
        @keyframes slideInLeft {
          from { opacity: 0; transform: translateX(-24px); }
          to   { opacity: 1; transform: translateX(0);     }
        }
      `}</style>
    </div>
  );
}
