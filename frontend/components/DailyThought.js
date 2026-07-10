"use client";

import { useEffect, useMemo, useState } from "react";
import FocusTrap from "@/features/shared/components/FocusTrap";

const THOUGHTS = [
  "Trade the plan. Not the mood.",
  "One good trade is enough. You don’t need all of them.",
  "Your edge is patience with rules.",
  "Small losses are tuition. Big losses are ego.",
  "A flat day is a professional day.",
  "Protect capital first. Profits come second.",
  "If it’s not in your plan, it’s not your trade.",
  "Consistency beats intensity.",
  "Wait for price to invite you—don’t chase it.",
  "You’re not here to be right. You’re here to be profitable.",
  "Boring execution is elite execution.",
  "The best revenge on the market is discipline.",
  "Quality setups > quantity of trades.",
  "Risk is a decision. Volatility is the weather.",
  "Trade size should match your confidence and your rules.",
  "Your job is to execute. The outcome is noise.",
  "Let the trade work. Don’t suffocate it.",
  "A missed trade is better than a forced trade.",
  "Don’t average your mistakes.",
  "Your stop is your business expense.",
  "Slow is smooth. Smooth is fast.",
  "Don’t confuse activity with progress.",
  "The market pays the patient.",
  "Your next trade is independent of the last one.",
  "Trade what you see, not what you hope.",
  "If you can’t explain the setup in one sentence, skip it.",
  "The goal is perfect process, not perfect prediction.",
  "Respect the range. Earn the trend.",
  "Avoid revenge. Reset your nervous system.",
  "Cut the loss before it cuts your confidence.",
  "You don’t need to recover today. You need to follow rules today.",
  "Your edge shows up over a series, not a moment.",
  "The best trades feel obvious after they trigger—before that, they feel quiet.",
  "Every trade is a test of discipline, not intelligence.",
  "If you’re anxious, reduce size or step away.",
  "When in doubt, zoom out.",
  "Be selective. The market is infinite; your focus isn’t.",
  "Don’t trade to feel better. Trade because it fits.",
  "A good trader is a great risk manager.",
  "Winning is a side-effect of repetition done well.",
  "Make decisions before entry, not during stress.",
  "Your rules are your superpower.",
  "Leave room for randomness—size accordingly.",
  "Trade the best, ignore the rest.",
  "Execute like a machine, review like a scientist.",
  "Today’s priority: protect your A-game.",
  "You’re building a system, not chasing a score.",
  "Your calm is part of your edge.",
  "Less noise. More signal.",
  "Discipline is the highest form of self-respect.",
];

function getLocalDateKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function pickThoughtForDate(dateKey) {
  // Deterministic: same thought for same day across refreshes.
  const seed = Number(dateKey.replaceAll("-", ""));
  const idx = seed % THOUGHTS.length;
  return THOUGHTS[idx];
}

export default function DailyThought({
  accent = "#0D9E6E",
  gold = "#B8860B",
  background = "#FFFFFF",
  border = "#E2E8F0",
  ink = "#0F1923",
  muted = "#64748B",
  storageKeyPrefix = "daily_thought_dismissed",
}) {
  const dateKey = useMemo(() => getLocalDateKey(), []);
  const storageKey = useMemo(() => `${storageKeyPrefix}:${dateKey}`, [storageKeyPrefix, dateKey]);

  const thought = useMemo(() => pickThoughtForDate(dateKey), [dateKey]);

  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(storageKey) !== "1";
    } catch {
      return false;
    }
  });

  // Lock to "shown today" the moment it opens (so refresh won't re-pop).
  useEffect(() => {
    if (!open) return;
    try {
      localStorage.setItem(storageKey, "1");
      window.dispatchEvent(new Event("daily-thought"));
    } catch {
      // ignore
    }
  }, [open, storageKey]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Daily thought"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      {/* Backdrop */}
      <div
        onClick={() => setOpen(false)}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(2,6,23,0.60)",
          animation: "dtFadeIn 220ms ease-out both",
        }}
      />

      {/* Card */}
      <FocusTrap>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Daily thought"
        style={{
          width: "min(560px, 100%)",
          background,
          border: `1px solid ${border}`,
          borderRadius: 18,
          boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
          overflow: "hidden",
          position: "relative",
          animation: "dtPopIn 320ms cubic-bezier(0.22,1,0.36,1) both",
        }}
      >
        <div style={{ height: 4, background: `linear-gradient(90deg, ${accent}, ${gold})` }} />

        <div
          style={{
            padding: "22px 22px 18px",
            position: "relative",
          }}
        >
          {/* soft glow */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: -40,
              background: `radial-gradient(circle at 30% 20%, ${accent}18, transparent 55%),
                           radial-gradient(circle at 80% 0%, ${gold}14, transparent 50%),
                           radial-gradient(circle at 80% 80%, ${accent}12, transparent 55%)`,
              pointerEvents: "none",
            }}
          />

          <div style={{ position: "relative", display: "flex", gap: 14, alignItems: "flex-start" }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 14,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                background: `linear-gradient(135deg, ${accent}1C, ${gold}18)`,
                border: `1px solid ${border}`,
                color: accent,
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M9 18h6" />
                <path d="M10 22h4" />
                <path d="M12 2a7 7 0 0 0-4 12c.7.6 1 1.2 1 2v1h6v-1c0-.8.3-1.4 1-2A7 7 0 0 0 12 2z" />
              </svg>
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: "0.16em",
                  color: muted,
                  fontFamily: "'JetBrains Mono',monospace",
                  fontWeight: 800,
                  marginBottom: 8,
                }}
              >
                DAILY THOUGHT
              </div>

              <div
                style={{
                  fontSize: 18,
                  lineHeight: 1.45,
                  fontFamily: "'Plus Jakarta Sans',sans-serif",
                  fontWeight: 900,
                  color: ink,
                  letterSpacing: "-0.015em",
                }}
              >
                {thought}
              </div>

              <div
                style={{
                  marginTop: 10,
                  fontSize: 11,
                  color: muted,
                  fontFamily: "'Plus Jakarta Sans',sans-serif",
                }}
              >
                This shows once per day when you open the dashboard.
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            padding: "0 22px 18px",  
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
          }}
        >
          <button
            onClick={() => setOpen(false)}
            style={{
              border: `1px solid ${border}`,
              background: "transparent",
              borderRadius: 12,
              padding: "10px 14px",
              cursor: "pointer",
              fontFamily: "'JetBrains Mono',monospace",
              fontWeight: 800,
              fontSize: 11,
              letterSpacing: "0.08em",
              color: muted,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = `${accent}66`;
              e.currentTarget.style.color = accent;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = border;
              e.currentTarget.style.color = muted;
            }}
          >
            GOT IT
          </button>
        </div>
      </div>

      <style>{`
        @keyframes dtFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes dtPopIn {
          from { opacity: 0; transform: translateY(16px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          * { animation: none !important; transition: none !important; }
        }
      `}</style>
    </div>
      </FocusTrap>
    </div>
  );
}

