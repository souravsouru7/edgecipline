"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Moon, Sparkles, ChevronRight, ChevronDown, HelpCircle } from "lucide-react";
import ReflectionScoreRing from "./ReflectionScoreRing";
import ReflectionSheet from "./ReflectionSheet";
import AskCoachButton from "@/features/coach-chat/components/AskCoachButton";

// Dashboard widget anchoring the End-of-Day Reflection loop.
//
// State machine:
//   - completed   → show today's answers + AI insight + weekly score
//   - skipped     → muted state, "Add reflection anyway"
//   - pending     → primary CTA to open the sheet
//   - loading     → skeleton shell (driven by parent)
//
// Parent passes `data` straight from the dashboard snapshot's `reflection`
// field, so this component never fetches — the dashboard query is the source
// of truth, and the sheet mutates that cache on submit.
const GUIDE_DISMISSED_KEY = "edgecipline:reflection-guide-dismissed";

function readGuideDismissed() {
  try { return window.localStorage.getItem(GUIDE_DISMISSED_KEY) === "1"; } catch { return false; }
}

function writeGuideDismissed(value) {
  try { window.localStorage.setItem(GUIDE_DISMISSED_KEY, value ? "1" : "0"); } catch { /* storage unavailable */ }
}

// localStorage never notifies within the same tab, and the user's own toggle
// is tracked in state, so the subscription is a no-op. The server snapshot is
// always `false` so SSR and the first client render agree.
const noopSubscribe = () => () => {};
const readGuideDismissedOnServer = () => false;

export default function ReflectionCard({ data, loading }) {
  const [sheetOpen, setSheetOpen] = useState(false);

  const today = data?.today;
  const weekly = data?.weekly;
  const latestInsight = data?.latestInsight;
  const score = weekly?.score ?? 0;

  // First-time treatment: pre-existing accounts (and brand-new users on their
  // first dashboard load) have zero reflections submitted. The card stays —
  // it's part of the "never empty" promise — but the copy explains the
  // feature instead of acting like the user is mid-habit.
  const isFirstTime =
    !today?.completed &&
    !today?.skipped &&
    (!weekly || (weekly.submittedDays || 0) === 0);

  // The guide opens itself for first-timers (nobody knew what the card was
  // for) and stays reachable behind a toggle once the habit has started.
  // `guideChoice` is null until the user toggles, so the auto-open follows the
  // snapshot as it loads.
  const [guideChoice, setGuideChoice] = useState(null);
  const guideDismissed = useSyncExternalStore(noopSubscribe, readGuideDismissed, readGuideDismissedOnServer);
  const guideOpen = guideChoice ?? (!loading && isFirstTime && !guideDismissed);
  const toggleGuide = () => {
    writeGuideDismissed(guideOpen);
    setGuideChoice(!guideOpen);
  };

  const ctaLabel =
    today?.completed ? "Update reflection" :
    today?.skipped   ? "Reflect anyway"    :
    isFirstTime     ? "Try your first reflection" :
    today?.hadTrades ? "Close the day"     :
    "Quick check-in";

  return (
    <>
      <section
        aria-label="End of day reflection"
        style={{
          background: "#FFFFFF",
          borderRadius: 14,
          border: "1px solid #E2E8F0",
          boxShadow: "0 2px 12px rgba(15,25,35,0.05)",
          overflow: "hidden",
          marginBottom: 20,
        }}
      >
        <div style={{ height: 3, background: "linear-gradient(90deg, #8B5CF6, transparent)" }} />
        <div style={{ padding: "16px 20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                <Moon size={14} color="#8B5CF6" />
                <span style={{ fontSize: 14, fontWeight: 800, color: "#0F1923" }}>End-of-Day Reflection</span>
              </div>
              <div style={{ fontSize: 11, color: "#94A3B8" }}>
                Morning prepares · Evening reflects
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
              <button
                type="button"
                onClick={toggleGuide}
                aria-expanded={guideOpen}
                aria-controls="reflection-guide"
                style={{ fontSize: 11, fontWeight: 800, color: "#64748B", background: "none", border: "none", padding: 0, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}
              >
                <HelpCircle size={12} /> How it works <ChevronDown size={12} style={{ transform: guideOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
              </button>
              <Link
                href="/reflection"
                style={{ fontSize: 11, fontWeight: 800, color: "#8B5CF6", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 2, whiteSpace: "nowrap" }}
              >
                History <ChevronRight size={12} />
              </Link>
            </div>
          </div>

          {guideOpen && <ReflectionGuide onStart={() => setSheetOpen(true)} />}

          {loading ? (
            <div style={{ height: 86, borderRadius: 10, background: "#F1F5F9" }} />
          ) : (
            <div style={{ display: "flex", gap: 14, alignItems: "stretch", flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flex: "1 1 240px", minWidth: 0 }}>
                <ReflectionScoreRing score={score} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: "var(--fs-2xs)", color: "#94A3B8", letterSpacing: "0.08em", fontWeight: 700, textTransform: "uppercase" }}>
                    Weekly score
                  </div>
                  <div style={{ fontSize: 13, color: "#0F1923", fontWeight: 700, marginTop: 2 }}>
                    {weekly?.submittedDays ?? 0}/7 days reflected
                  </div>
                  <div style={{ fontSize: 11, color: "#64748B", marginTop: 2 }}>
                    {today?.completed
                      ? `Today: ${prettyPlan(today.followedPlan)}.`
                      : today?.skipped
                        ? "Skipped today — easy to add later."
                        : isFirstTime
                          ? "30-second daily check-in. Builds the weekly score."
                          : today?.hadTrades
                            ? `${today.tradeCount} trade${today.tradeCount === 1 ? "" : "s"} waiting for a 30-sec review.`
                            : "Quiet day. Worth a check-in?"}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSheetOpen(true)}
                style={{
                  flex: "1 1 160px",
                  minWidth: 0,
                  padding: "12px 14px",
                  borderRadius: 12,
                  background: today?.completed ? "#F1F5F9" : "#0D9E6E",
                  color: today?.completed ? "#0F1923" : "#FFFFFF",
                  border: "none",
                  fontWeight: 800,
                  fontSize: 13,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  boxShadow: today?.completed ? "none" : "0 8px 16px rgba(13,158,110,0.25)",
                }}
              >
                {ctaLabel}
                <ChevronRight size={15} />
              </button>
            </div>
          )}

          {latestInsight?.insight && (
            <div
              style={{
                marginTop: 14,
                padding: "10px 12px",
                borderRadius: 10,
                background: "rgba(139, 92, 246, 0.06)",
                border: "1px solid rgba(139, 92, 246, 0.18)",
                display: "flex",
                gap: 10,
                alignItems: "flex-start",
              }}
            >
              <div style={{ width: 26, height: 26, borderRadius: 8, background: "rgba(139, 92, 246, 0.18)", color: "#7C3AED", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Sparkles size={14} />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: "var(--fs-2xs)", color: "#7C3AED", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 2 }}>
                  AI coach{latestInsight.fallback ? " · offline" : ""}
                </div>
                <div style={{ fontSize: 12, color: "#1E293B", lineHeight: 1.55, fontWeight: 600, marginBottom: 8 }}>
                  {latestInsight.insight}
                </div>
                <AskCoachButton
                  variant="ghost"
                  size="sm"
                  label="Ask coach about this"
                  anchor={{ kind: "reflection", refId: latestInsight.day, label: `Reflection · ${latestInsight.day}` }}
                  defaultPrompt={`You just told me: "${latestInsight.insight}". Walk me through the evidence and what to do tomorrow.`}
                />
              </div>
            </div>
          )}
        </div>
      </section>

      <ReflectionSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </>
  );
}

// Three-step walkthrough of the daily loop. Copy mirrors what ReflectionSheet
// actually asks and how reflectionService weights the weekly score, so the
// guide never promises something the feature doesn't do.
const GUIDE_STEPS = [
  {
    n: "1",
    title: "Trade your day as usual",
    body: "Log trades like normal — or sit out. Either way counts. The card tracks how many trades are waiting for review.",
    accent: "#2563EB",
  },
  {
    n: "2",
    title: "Close the day in 30 seconds",
    body: "In the evening tap the green button and answer 5 quick taps: followed your plan? · how did it feel? · confidence · would you repeat it? · one thing to improve tomorrow.",
    accent: "#0D9E6E",
  },
  {
    n: "3",
    title: "Do it 7 days, get a score + a coach",
    body: "Each day builds the weekly score (plan adherence 40%, would-repeat 20%, mood & confidence 20%, showing up 20%). The AI coach reads your answers with your trades and tells you what to fix tomorrow.",
    accent: "#8B5CF6",
  },
];

function ReflectionGuide({ onStart }) {
  return (
    <div
      id="reflection-guide"
      style={{
        marginBottom: 14,
        padding: "12px 14px",
        borderRadius: 12,
        background: "#F8FAFC",
        border: "1px solid #E2E8F0",
      }}
    >
      <div style={{ fontSize: "var(--fs-2xs)", color: "#64748B", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>
        How to use this in your trading journey
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
        {GUIDE_STEPS.map((step) => (
          <div key={step.n} style={{ display: "flex", gap: 10, alignItems: "flex-start", minWidth: 0 }}>
            <div style={{ width: 22, height: 22, borderRadius: 7, background: `${step.accent}18`, color: step.accent, fontSize: 11, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              {step.n}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#0F1923", marginBottom: 2 }}>{step.title}</div>
              <div style={{ fontSize: 11, color: "#475569", lineHeight: 1.55 }}>{step.body}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 12, paddingTop: 10, borderTop: "1px dashed #E2E8F0" }}>
        <div style={{ fontSize: 11, color: "#64748B", lineHeight: 1.5 }}>
          Tip: honesty beats a high score. Logging &ldquo;broke the plan&rdquo; is what lets the coach catch the pattern. Skipping a quiet day is fine — it won&rsquo;t drag you down like a broken plan does.
        </div>
        <button
          type="button"
          onClick={onStart}
          style={{ fontSize: 11, fontWeight: 800, color: "#0D9E6E", background: "none", border: "1px solid #0D9E6E55", borderRadius: 8, padding: "6px 10px", cursor: "pointer", whiteSpace: "nowrap" }}
        >
          Start now →
        </button>
      </div>
    </div>
  );
}

function prettyPlan(value) {
  switch (value) {
    case "yes":       return "followed the plan";
    case "partly":    return "partly followed plan";
    case "no":        return "broke the plan";
    case "no_trades": return "sat out today";
    default:          return "answered";
  }
}
