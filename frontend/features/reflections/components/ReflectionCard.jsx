"use client";

import { useState } from "react";
import Link from "next/link";
import { Moon, Sparkles, ChevronRight } from "lucide-react";
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
            <Link
              href="/reflection"
              style={{ fontSize: 11, fontWeight: 800, color: "#8B5CF6", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 2, whiteSpace: "nowrap" }}
            >
              History <ChevronRight size={12} />
            </Link>
          </div>

          {loading ? (
            <div style={{ height: 86, borderRadius: 10, background: "#F1F5F9" }} />
          ) : (
            <div style={{ display: "flex", gap: 14, alignItems: "stretch", flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flex: "1 1 240px", minWidth: 0 }}>
                <ReflectionScoreRing score={score} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 10, color: "#94A3B8", letterSpacing: "0.08em", fontWeight: 700, textTransform: "uppercase" }}>
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
                <div style={{ fontSize: 10, color: "#7C3AED", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 2 }}>
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

function prettyPlan(value) {
  switch (value) {
    case "yes":       return "followed the plan";
    case "partly":    return "partly followed plan";
    case "no":        return "broke the plan";
    case "no_trades": return "sat out today";
    default:          return "answered";
  }
}
