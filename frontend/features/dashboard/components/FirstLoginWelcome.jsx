"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { markOnboardingStep, setPreferredMarket } from "@/services/api";
import { useMarket, MARKETS } from "@/context/MarketContext";
import FocusTrap from "@/features/shared/components/FocusTrap";

// Full-screen welcome shown only on the very first login. Three short slides:
// (1) intro, (2) market picker, (3) setup explainer — then routes the user
// into the forced setup-creation step.
const INTRO_SLIDE = {
  badge: "STEP 1",
  title: "Welcome to Edgecipline",
  body: "Let's set up your trading edge in 60 seconds. This intro starts the loop: choose your market, define a setup, log a trade, then review it in your journal.",
  bullets: [
    "🎯 Add a setup — the pattern you trade",
    "📸 Upload a broker screenshot — AI fills the trade for you",
    "📓 Review in your journal — see what works",
  ],
  cta: "Start",
};

const SETUP_SLIDE = {
  badge: "STEP 2",
  title: "First, define your setup",
  body: "A setup is the specific condition you wait for before entering. Defining it lets us measure which strategies actually make you money — and which to drop.",
  bullets: [
    "Examples: Breakout, Pullback, Opening Range",
    "Add the rules you follow for each entry",
    "Every trade you log will link to a setup",
  ],
  cta: "Add my first setup →",
};

const MARKET_OPTIONS = [
  {
    value: MARKETS.FOREX,
    emoji: "🌐",
    title: "Forex / Global",
    sub: "MT4 / MT5, OANDA, IC Markets",
    examples: "EUR/USD, XAUUSD, GBP/JPY",
  },
  {
    value: MARKETS.INDIAN_MARKET,
    emoji: "🇮🇳",
    title: "Indian Market",
    sub: "Zerodha, Upstox, Groww, Angel One",
    examples: "NIFTY options, RELIANCE, F&O",
  },
];

const overlay = {
  position: "fixed", inset: 0, zIndex: 9999,
  background: "rgba(5, 10, 18, 0.88)",
  display: "flex", alignItems: "center", justifyContent: "center",
  padding: 20,
  fontFamily: "var(--font-plus-jakarta-sans)",
  animation: "flwFadeIn 0.3s ease-out",
};

const card = {
  background: "#0F1923",
  borderRadius: 20,
  width: "100%", maxWidth: 440,
  border: "1px solid rgba(34,199,142,0.25)",
  boxShadow: "0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(34,199,142,0.15)",
  overflow: "hidden",
  animation: "flwSlideUp 0.4s cubic-bezier(0.34,1.56,0.64,1)",
};

// Step indices: 0 = intro, 1 = market picker, 2 = setup explainer.
const TOTAL_STEPS = 3;

export default function FirstLoginWelcome({ onClose }) {
  const router = useRouter();
  const { toggleMarket } = useMarket();
  const [step, setStep] = useState(0);
  const [pickedMarket, setPickedMarket] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const progress = Math.round(((step + 1) / TOTAL_STEPS) * 100);

  function handleSkip() {
    markOnboardingStep("welcomeSeen", true).catch(() => {});
    onClose?.();
  }

  function handlePickMarket(market) {
    setPickedMarket(market);
    toggleMarket(market);
    setPreferredMarket(market).catch(() => {});
  }

  async function handleNext() {
    if (step === 0) { setStep(1); return; }
    if (step === 1) {
      if (!pickedMarket) return;
      setStep(2);
      return;
    }
    // step === 2 → finish welcome and route to /setups
    setSubmitting(true);
    try { await markOnboardingStep("welcomeSeen", true); } catch {/* non-blocking */}
    onClose?.();
    router.push("/setups?onboarding=1");
  }

  function handleBack() {
    if (step > 0) setStep(step - 1);
  }

  const slide = step === 0 ? INTRO_SLIDE : step === 2 ? SETUP_SLIDE : null;
  const isMarketStep = step === 1;
  const nextDisabled = isMarketStep && !pickedMarket;

  return (
    <div style={overlay}>
      <FocusTrap>
      <div role="dialog" aria-modal="true" aria-label="Welcome onboarding" style={card}>
        {/* progress bar */}
        <div style={{ height: 3, background: "rgba(255,255,255,0.05)" }}>
          <div style={{
            height: "100%", width: `${progress}%`,
            background: "linear-gradient(90deg, #22C78E, #0D9E6E)",
            transition: "width 0.35s ease",
          }} />
        </div>

        <div style={{ padding: "24px 26px 8px" }}>
          <div style={{
            fontSize: 10, fontWeight: 800, color: "#22C78E",
            letterSpacing: "0.12em", fontFamily: "'JetBrains Mono', monospace",
          }}>
            {isMarketStep ? "PICK YOUR MARKET" : slide.badge} · {step + 1}/{TOTAL_STEPS}
          </div>
          <h2 style={{
            fontSize: 22, fontWeight: 800, color: "#F1F5F9",
            margin: "8px 0 10px", lineHeight: 1.2,
          }}>
            {isMarketStep ? "Which market do you trade?" : slide.title}
          </h2>
          <p style={{
            fontSize: 13, color: "#94A3B8",
            lineHeight: 1.65, margin: 0,
          }}>
            {isMarketStep
              ? "We'll tailor your setup form, screenshot AI, and journal to your market. You can switch any time from the top header."
              : slide.body}
          </p>
        </div>

        {/* slide body */}
        {isMarketStep ? (
          <div style={{ padding: "16px 26px 8px", display: "grid", gap: 10 }}>
            {MARKET_OPTIONS.map(opt => {
              const selected = pickedMarket === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handlePickMarket(opt.value)}
                  style={{
                    textAlign: "left", cursor: "pointer",
                    padding: "14px 14px", borderRadius: 12,
                    background: selected ? "rgba(34,199,142,0.12)" : "rgba(255,255,255,0.03)",
                    border: `1.5px solid ${selected ? "#22C78E" : "rgba(255,255,255,0.1)"}`,
                    display: "flex", gap: 12, alignItems: "center",
                    transition: "background 0.2s, border-color 0.2s",
                    fontFamily: "'Plus Jakarta Sans', sans-serif",
                  }}
                >
                  <div style={{ fontSize: 26, lineHeight: 1 }}>{opt.emoji}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: "#F1F5F9", marginBottom: 2 }}>
                      {opt.title}
                    </div>
                    <div style={{ fontSize: 11, color: "#94A3B8", marginBottom: 2 }}>
                      {opt.sub}
                    </div>
                    <div style={{ fontSize: 10, color: "#64748B", fontFamily: "'JetBrains Mono', monospace" }}>
                      e.g. {opt.examples}
                    </div>
                  </div>
                  <div style={{
                    width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                    background: selected ? "#22C78E" : "transparent",
                    border: `2px solid ${selected ? "#22C78E" : "#475569"}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "#0F1923", fontSize: 12, fontWeight: 900,
                  }}>
                    {selected ? "✓" : ""}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div style={{ padding: "16px 26px 8px", display: "grid", gap: 8 }}>
            {slide.bullets.map((b, i) => (
              <div key={i} style={{
                fontSize: 12, color: "#CBD5E1", lineHeight: 1.6,
                padding: "10px 12px", borderRadius: 10,
                background: "rgba(34,199,142,0.06)",
                border: "1px solid rgba(34,199,142,0.15)",
              }}>
                {b}
              </div>
            ))}
          </div>
        )}

        <div style={{
          padding: "16px 26px 22px",
          display: "flex", gap: 10, alignItems: "center",
        }}>
          {step > 0 ? (
            <button
              type="button"
              onClick={handleBack}
              style={{
                padding: "10px 14px", borderRadius: 10,
                background: "transparent", border: "1px solid rgba(255,255,255,0.1)",
                color: "#94A3B8", fontSize: 12, fontWeight: 700, cursor: "pointer",
              }}
            >
              ← Back
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSkip}
              style={{
                padding: "10px 14px", borderRadius: 10,
                background: "transparent", border: "1px solid rgba(255,255,255,0.1)",
                color: "#94A3B8", fontSize: 12, fontWeight: 700, cursor: "pointer",
              }}
            >
              Skip
            </button>
          )}
          <button
            type="button"
            onClick={handleNext}
            disabled={submitting || nextDisabled}
            style={{
              flex: 1, padding: "11px 18px", borderRadius: 10,
              background: nextDisabled
                ? "rgba(34,199,142,0.25)"
                : "linear-gradient(135deg, #22C78E, #0D9E6E)",
              border: "none", color: "#fff",
              fontSize: 13, fontWeight: 800,
              cursor: (submitting || nextDisabled) ? "not-allowed" : "pointer",
              letterSpacing: "0.03em",
              boxShadow: nextDisabled ? "none" : "0 6px 18px rgba(13,158,110,0.35)",
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {step === 0 ? INTRO_SLIDE.cta
              : step === 1 ? (pickedMarket ? "Continue →" : "Pick a market")
              : SETUP_SLIDE.cta}
          </button>
        </div>
      </div>

      <style jsx global>{`
        @keyframes flwFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes flwSlideUp {
          from { opacity: 0; transform: translateY(20px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
      </FocusTrap>
    </div>
  );
}
