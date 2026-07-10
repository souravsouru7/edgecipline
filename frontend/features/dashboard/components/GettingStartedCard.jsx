"use client";

import Link from "next/link";
import { useState } from "react";
import { markOnboardingStep } from "@/services/api";

// New 6-step model that mirrors the backend activation funnel. Each item links
// to the dedicated step inside /onboarding so a user who bounced mid-flow can
// resume exactly where they left off — and one-off items (analytics, journal)
// still link to their pages.
//
// Reward: when every step is complete, we render the celebratory state with
// the date the user activated. We do NOT auto-dismiss — the user gets the
// satisfaction of tapping "Done".
//
// Edge: a user who explicitly chose "I haven't traded yet" gets the trade row
// rendered as completed-but-skipped (no strikethrough, "explorer mode" tag,
// link still points at upload-trade). This matches the backend's `isStepDone`
// helper exactly.
function rowDone(item, onboarding) {
  if (onboarding[item.key]) return true;
  if (item.key === "tradeAdded" && onboarding.tradeSkipped) return true;
  return false;
}

const ITEMS = [
  { key: "marketSelected",  label: "Choose your market",       sub: "Forex or Indian market",              href: "/onboarding?step=marketSelected" },
  { key: "styleSelected",   label: "Pick a trading style",     sub: "Scalper, intraday, swing, position",   href: "/onboarding?step=styleSelected" },
  { key: "setupAdded",      label: "Save a default setup",     sub: "Style-matched template, 1 tap",       href: "/onboarding?step=setupAdded" },
  { key: "tradeAdded",      label: "Log your first trade",     sub: "Upload a screenshot — AI fills it",    href: "/upload-trade?onboarding=1" },
  { key: "firstInsightSeen", label: "See your first AI insight", sub: "Grounded in your real data",       href: "/onboarding?step=firstInsightSeen" },
  { key: "journalSeen",     label: "Open your journal",        sub: "Every trade in one place",            href: "/trades?onboarding=1" },
];

export default function GettingStartedCard({ onboarding, onMutate }) {
  const [dismissing, setDismissing] = useState(false);

  if (
    !onboarding ||
    onboarding.checklistDismissed ||
    onboarding.tourCompleted ||
    onboarding.completedAt
  ) return null;

  const done = ITEMS.filter((item) => rowDone(item, onboarding)).length;
  const allDone = done === ITEMS.length;
  const pct = Math.round((done / ITEMS.length) * 100);
  const nextItem = ITEMS.find((item) => !rowDone(item, onboarding));

  async function dismiss() {
    setDismissing(true);
    try {
      await markOnboardingStep("checklistDismissed", true);
      onMutate?.();
    } catch { /* non-blocking */ }
  }

  return (
    <section style={{
      background: allDone
        ? "linear-gradient(135deg, rgba(34,199,142,0.25), rgba(15,25,35,1) 80%)"
        : "linear-gradient(135deg, #0F1923 0%, #1a2937 100%)",
      borderRadius: 14,
      border: `1px solid ${allDone ? "rgba(34,199,142,0.45)" : "rgba(34,199,142,0.2)"}`,
      boxShadow: "0 4px 20px rgba(15,25,35,0.08)",
      overflow: "hidden",
      marginBottom: 20,
      color: "#F1F5F9",
    }}>
      <div style={{ height: 3, background: "linear-gradient(90deg, #22C78E, transparent)" }} />
      <div style={{ padding: "18px 22px" }}>
        <div style={{
          display: "flex", alignItems: "flex-start", justifyContent: "space-between",
          marginBottom: 14, gap: 12,
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: 10, fontWeight: 800, color: "#22C78E",
              letterSpacing: "0.12em", fontFamily: "'JetBrains Mono', monospace",
              marginBottom: 4,
            }}>
              ACTIVATION · {done}/{ITEMS.length}
            </div>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#F1F5F9" }}>
              {allDone
                ? "You're activated. 🎉 Edgecipline is fully tuned to you."
                : nextItem
                  ? `Next: ${nextItem.label}`
                  : "Finish activation to unlock the full coach."}
            </div>
            {!allDone && (
              <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 4 }}>
                Market, style, setup, trade, AI insight, journal. Your progress saves after every step.
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={dismiss}
            disabled={dismissing}
            style={{
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "#94A3B8",
              borderRadius: 8,
              padding: "5px 10px",
              fontSize: 10,
              fontWeight: 700,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {allDone ? "Done" : "Hide"}
          </button>
        </div>

        <div style={{
          height: 4, borderRadius: 99, background: "rgba(255,255,255,0.06)",
          overflow: "hidden", marginBottom: 14,
        }}>
          <div style={{
            height: "100%", width: `${pct}%`,
            background: allDone
              ? "linear-gradient(90deg, #22C78E, #F59E0B)"
              : "linear-gradient(90deg, #22C78E, #0D9E6E)",
            transition: "width 0.4s ease",
          }} />
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          {ITEMS.map((item) => {
            const isDone = rowDone(item, onboarding);
            const isSkipped =
              item.key === "tradeAdded" &&
              !onboarding.tradeAdded &&
              Boolean(onboarding.tradeSkipped);
            const labelText = isSkipped ? "Log a trade when you have one" : item.label;
            const subText = isSkipped
              ? "You marked yourself as exploring — come back any time."
              : item.sub;
            const linkHref = isSkipped ? "/upload-trade?onboarding=1" : item.href;

            return (
              <Link
                key={item.key}
                href={linkHref}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "10px 12px", borderRadius: 10,
                  background: isDone ? "rgba(34,199,142,0.06)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${isDone ? "rgba(34,199,142,0.2)" : "rgba(255,255,255,0.06)"}`,
                  textDecoration: "none",
                  color: "inherit",
                  transition: "background 0.2s",
                }}
              >
                <div style={{
                  width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                  background: isDone ? "#22C78E" : "transparent",
                  border: `2px solid ${isDone ? "#22C78E" : "#475569"}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#0F1923", fontSize: 12, fontWeight: 900,
                }}>
                  {isDone ? "✓" : ""}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 12, fontWeight: 800,
                    color: isDone ? "#94A3B8" : "#F1F5F9",
                    textDecoration: isDone && !isSkipped ? "line-through" : "none",
                  }}>
                    {labelText}
                    {isSkipped && (
                      <span style={{
                        marginLeft: 6, fontSize: 9, fontWeight: 800,
                        color: "#22C78E", letterSpacing: "0.06em",
                        textTransform: "uppercase",
                      }}>
                        · explorer mode
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: "#64748B", marginTop: 2 }}>
                    {subText}
                  </div>
                </div>
                {(!isDone || isSkipped) && (
                  <span style={{ fontSize: 16, color: "#22C78E", fontWeight: 700 }}>→</span>
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
