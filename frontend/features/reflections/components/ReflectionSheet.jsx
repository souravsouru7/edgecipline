
"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Check, MinusCircle, Smile, Loader2 } from "lucide-react";
import {
  useSubmitReflection,
  useSkipReflection,
  useTodayReflection,
} from "@/features/reflections/hooks/useReflection";

// One mounted form for any of three entry points:
//   - Dashboard card "Start reflection"
//   - Bottom-nav reflection icon
//   - Evening push notification deep-link
//
// The form must respect the 30-second promise: every field is optional, mood
// + plan adherence are one-tap each, and Submit fires even with a single
// answer. Skip is always available without confusion.

const FOLLOWED_OPTIONS = [
  { value: "yes",       label: "Yes",        emoji: "✅", color: "#0D9E6E" },
  { value: "partly",    label: "Partly",     emoji: "↔️", color: "#F59E0B" },
  { value: "no",        label: "No",         emoji: "🚫", color: "#D63B3B" },
];

const REPEAT_OPTIONS = [
  { value: "yes",    label: "Yes",    color: "#0D9E6E" },
  { value: "partly", label: "Partly", color: "#F59E0B" },
  { value: "no",     label: "No",     color: "#D63B3B" },
];

// Each level carries its own word. The emoji alone left users guessing what
// the middle of the scale meant, and confidence used to render only the first
// letter of each label — which showed "S L S C O", with Shaken and Steady both
// collapsing to an indistinguishable "S".
const MOOD_LEVELS = [
  { emoji: "😩", label: "Rough" },
  { emoji: "😕", label: "Off" },
  { emoji: "😐", label: "Flat" },
  { emoji: "🙂", label: "Good" },
  { emoji: "😎", label: "Great" },
];
const CONF_LEVELS = [
  { label: "Shaken" },
  { label: "Low" },
  { label: "Steady" },
  { label: "Confident" },
  { label: "On fire" },
];

function pillStyle(active, color) {
  return {
    flex: 1,
    minWidth: 0,
    padding: "10px 8px",
    borderRadius: 10,
    border: `1px solid ${active ? color : "#E2E8F0"}`,
    background: active ? `${color}14` : "#FFFFFF",
    color: active ? color : "#475569",
    fontSize: 12,
    fontWeight: active ? 800 : 600,
    cursor: "pointer",
    transition: "background 0.12s ease, border 0.12s ease",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  };
}

/**
 * Five-point scale where every option shows its own word, so the meaning does
 * not depend on reading an emoji or on a caption that only appears after you
 * have already chosen.
 */
function Slider({ label, value, onChange, levels, accent }) {
  const selected = value ? levels[value - 1] : null;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#0F1923" }}>{label}</span>
        <span style={{ fontSize: 11, color: selected ? accent : "#94A3B8", fontWeight: 700 }}>
          {selected ? selected.label : "Tap to choose"}
        </span>
      </div>
      <div style={{ display: "flex", gap: 5 }}>
        {levels.map((level, idx) => {
          const n = idx + 1;
          const active = value === n;
          return (
            <button
              key={level.label}
              type="button"
              onClick={() => onChange(active ? null : n)}
              aria-pressed={active}
              aria-label={`${label}: ${level.label}`}
              style={{
                flex: 1,
                minWidth: 0,
                minHeight: 56,
                padding: "6px 2px",
                borderRadius: 10,
                border: `1px solid ${active ? accent : "#E2E8F0"}`,
                background: active ? `${accent}1A` : "#FFFFFF",
                color: active ? accent : "#64748B",
                cursor: "pointer",
                touchAction: "manipulation",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 2,
                transition: "transform 0.1s ease, background 0.12s ease",
                transform: active ? "translateY(-1px)" : "translateY(0)",
              }}
            >
              {level.emoji && <span aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>{level.emoji}</span>}
              <span style={{
                fontSize: 9.5,
                fontWeight: active ? 800 : 600,
                lineHeight: 1.15,
                textAlign: "center",
                letterSpacing: "-0.01em",
              }}>
                {level.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function ReflectionSheet({ open, onClose }) {
  const today = useTodayReflection();
  const submit = useSubmitReflection();
  const skip = useSkipReflection();

  const existing = today.data?.reflection || null;
  const hadTrades = today.data?.context?.hadTrades;
  const skipped = today.data?.skipped;

  const [followedPlan, setFollowedPlan] = useState(null);
  const [mood, setMood] = useState(null);
  const [confidence, setConfidence] = useState(null);
  const [wouldRepeat, setWouldRepeat] = useState(null);
  const [improvement, setImprovement] = useState("");

  // Hydrate from an existing reflection so editing today's answer reuses the
  // prior values instead of looking like a fresh form.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      setFollowedPlan(existing?.followedPlan || null);
      setMood(existing?.mood ?? null);
      setConfidence(existing?.confidence ?? null);
      setWouldRepeat(existing?.wouldRepeat || null);
      setImprovement(existing?.improvement || "");
    });
    return () => cancelAnimationFrame(id);
  }, [open, existing]);

  const planOptions = useMemo(() => {
    // Hide the "no" option when there were no trades — discipline doesn't
    // mean the same thing on a quiet day. We still allow editing manually
    // if the user already saved 'no_trades'.
    if (hadTrades === false) {
      return FOLLOWED_OPTIONS.concat([
        { value: "no_trades", label: "Sat out", emoji: "🧘", color: "#0EA5E9" },
      ]).filter((opt) => opt.value !== "no");
    }
    return FOLLOWED_OPTIONS;
  }, [hadTrades]);

  if (!open) return null;

  const canSubmit =
    followedPlan != null ||
    mood != null ||
    confidence != null ||
    wouldRepeat != null ||
    improvement.trim().length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    const payload = {
      ...(followedPlan ? { followedPlan } : {}),
      ...(mood ? { mood } : {}),
      ...(confidence ? { confidence } : {}),
      ...(wouldRepeat ? { wouldRepeat } : {}),
      ...(improvement.trim() ? { improvement: improvement.trim() } : {}),
      source: "manual",
    };
    try {
      await submit.mutateAsync(payload);
      onClose?.();
    } catch (error) {
      console.warn("[Reflection] submit failed", error?.message);
    }
  };

  const handleSkip = async () => {
    try {
      await skip.mutateAsync({ source: "manual" });
      onClose?.();
    } catch (error) {
      console.warn("[Reflection] skip failed", error?.message);
    }
  };

  const isLoading = today.isLoading;
  const isBusy = submit.isPending || skip.isPending;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="End of day reflection"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1100,
        background: "rgba(15, 25, 35, 0.55)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        padding: 0,
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 540,
          background: "#FFFFFF",
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          boxShadow: "0 -16px 40px rgba(15,25,35,0.18)",
          maxHeight: "92vh",
          overflowY: "auto",
          padding: "20px 22px 28px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#94A3B8", letterSpacing: "0.1em", textTransform: "uppercase" }}>
              End of day
            </div>
            <h2 style={{ margin: "2px 0 0", fontSize: 18, fontWeight: 800, color: "#0F1923" }}>
              30-second reflection
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close reflection"
            style={{
              background: "transparent", border: "none", padding: 6, borderRadius: 8,
              cursor: "pointer", color: "#64748B",
            }}
          >
            <X size={20} />
          </button>
        </div>

        {isLoading ? (
          <div style={{ padding: "32px 0", textAlign: "center", color: "#94A3B8" }}>
            <Loader2 size={18} className="spin" />
          </div>
        ) : (
          <>
            <p style={{ margin: "0 0 14px", color: "#475569", fontSize: 13, lineHeight: 1.55 }}>
              {hadTrades
                ? `${today.data?.context?.tradeCount || 0} trade${(today.data?.context?.tradeCount || 0) === 1 ? "" : "s"} logged today. Lock in one lesson before tomorrow.`
                : "No trades today — still worth a 20-second check-in."}
            </p>

            <section style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#0F1923", marginBottom: 6 }}>
                Did you follow your trading plan?
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {planOptions.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setFollowedPlan(followedPlan === opt.value ? null : opt.value)}
                    aria-pressed={followedPlan === opt.value}
                    style={pillStyle(followedPlan === opt.value, opt.color)}
                  >
                    <span aria-hidden style={{ fontSize: 14 }}>{opt.emoji}</span>
                    {opt.label}
                  </button>
                ))}
              </div>
            </section>

            <section style={{ marginBottom: 16 }}>
              <Slider
                label="How did today feel?"
                value={mood}
                onChange={setMood}
                levels={MOOD_LEVELS}
                accent="#8B5CF6"
              />
            </section>

            <section style={{ marginBottom: 16 }}>
              <Slider
                label="Confidence level"
                value={confidence}
                onChange={setConfidence}
                levels={CONF_LEVELS}
                accent="#0D9E6E"
              />
            </section>

            {hadTrades && (
              <section style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#0F1923", marginBottom: 6 }}>
                  {"Would you repeat today's execution?"}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {REPEAT_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setWouldRepeat(wouldRepeat === opt.value ? null : opt.value)}
                      aria-pressed={wouldRepeat === opt.value}
                      style={pillStyle(wouldRepeat === opt.value, opt.color)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section style={{ marginBottom: 18 }}>
              <label htmlFor="reflection-improvement" style={{ fontSize: 12, fontWeight: 700, color: "#0F1923", display: "block", marginBottom: 6 }}>
                One thing to improve tomorrow
                <span style={{ fontWeight: 500, color: "#94A3B8", marginLeft: 6 }}>(optional)</span>
              </label>
              <textarea
                id="reflection-improvement"
                value={improvement}
                onChange={(event) => setImprovement(event.target.value.slice(0, 280))}
                rows={2}
                placeholder="Wait for the second confirmation before entering."
                style={{
                  width: "100%",
                  border: "1px solid #E2E8F0",
                  borderRadius: 10,
                  padding: "10px 12px",
                  fontSize: 13,
                  fontFamily: "inherit",
                  resize: "vertical",
                  outline: "none",
                  color: "#0F1923",
                  background: "#FFFFFF",
                }}
              />
              <div style={{ textAlign: "right", marginTop: 2, fontSize: 10, color: "#94A3B8" }}>
                {improvement.length}/280
              </div>
            </section>

            {skipped && (
              <div style={{ fontSize: 11, color: "#94A3B8", marginBottom: 12 }}>
                You skipped earlier — submit now to overwrite.
              </div>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
              <button
                type="button"
                onClick={handleSkip}
                disabled={isBusy}
                style={{
                  flex: "0 0 auto",
                  padding: "12px 16px",
                  borderRadius: 12,
                  background: "transparent",
                  border: "1px solid #E2E8F0",
                  color: "#475569",
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: isBusy ? "default" : "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <MinusCircle size={16} />
                Skip today
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit || isBusy}
                style={{
                  flex: 1,
                  padding: "12px 16px",
                  borderRadius: 12,
                  background: canSubmit ? "#0D9E6E" : "#CBD5E1",
                  border: "none",
                  color: "#FFFFFF",
                  fontWeight: 800,
                  fontSize: 14,
                  cursor: canSubmit && !isBusy ? "pointer" : "default",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  boxShadow: canSubmit ? "0 8px 18px rgba(13,158,110,0.25)" : "none",
                }}
              >
                {submit.isPending ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
                Lock it in
              </button>
            </div>

            <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 6, color: "#94A3B8", fontSize: 11 }}>
              <Smile size={13} />
              <span>Reflection takes less than 30 seconds. You can edit later from /reflection.</span>
            </div>
          </>
        )}

        <style jsx>{`
          @keyframes spinkey {
            from { transform: rotate(0deg); }
            to   { transform: rotate(360deg); }
          }
          .spin {
            animation: spinkey 0.9s linear infinite;
          }
        `}</style>
      </div>
    </div>
  );
}
