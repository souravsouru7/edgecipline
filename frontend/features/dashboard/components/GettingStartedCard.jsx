"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { markOnboardingStep } from "@/services/api";

const DISMISS_STORAGE_KEY = "edgecipline:activation-card-dismissed";

// Dashboard resume nudge for users who leave /onboarding mid-flow.
// Keep this order in sync with frontend/app/onboarding/page.js and
// onboardingService.FLOW_STEPS.
function getItems(routes = {}) {
  return [
    {
      key: "welcomeSeen",
      label: "Start onboarding",
      sub: "Quick setup for your trading workspace",
      href: "/onboarding?step=welcomeSeen",
    },
    {
      key: "setupAdded",
      label: "Create your first setup",
      sub: "Strategy name, rules, and examples",
      href: "/setups?onboarding=1",
    },
    {
      key: "tradeAdded",
      label: "Import your first trade",
      sub: "Screenshot import or manual entry",
      href: `${routes.uploadTrade || "/upload-trade"}?onboarding=1`,
    },
  ];
}

function rowDone(item, onboarding) {
  if (onboarding[item.key]) return true;
  if (item.key === "tradeAdded" && onboarding.tradeSkipped) return true;
  return false;
}

export default function GettingStartedCard({ onboarding, onMutate, routes, userId }) {
  const [dismissing, setDismissing] = useState(false);
  const storageKey = userId ? `${DISMISS_STORAGE_KEY}:${userId}` : DISMISS_STORAGE_KEY;
  const [locallyDismissed, setLocallyDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(storageKey) === "1";
    } catch {
      return false;
    }
  });
  const items = getItems(routes);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(storageKey) === "1") {
        setLocallyDismissed(true);
      }
    } catch {
      // Storage can be unavailable in restricted WebViews.
    }
  }, [storageKey]);

  useEffect(() => {
    if (!onboarding?.checklistDismissed && !onboarding?.tourCompleted && !onboarding?.completedAt) return;
    try {
      window.localStorage.setItem(storageKey, "1");
    } catch {
      // Storage can be unavailable in restricted WebViews.
    }
  }, [onboarding?.checklistDismissed, onboarding?.tourCompleted, onboarding?.completedAt, storageKey]);

  if (
    !onboarding ||
    locallyDismissed ||
    onboarding.checklistDismissed ||
    onboarding.tourCompleted ||
    onboarding.completedAt
  ) return null;

  const done = items.filter((item) => rowDone(item, onboarding)).length;
  const allDone = done === items.length;
  const pct = Math.round((done / items.length) * 100);
  const nextItem = items.find((item) => !rowDone(item, onboarding));

  async function dismiss() {
    if (dismissing) return;
    setDismissing(true);
    setLocallyDismissed(true);
    const optimisticOnboarding = {
      checklistDismissed: true,
      ...(allDone ? { tourCompleted: true } : null),
    };
    try {
      window.localStorage.setItem(storageKey, "1");
    } catch {
      // Non-critical fallback only.
    }
    onMutate?.(optimisticOnboarding);
    try {
      await markOnboardingStep("checklistDismissed", true);
      if (allDone) {
        markOnboardingStep("tourCompleted", true).catch(() => {});
      }
      onMutate?.(optimisticOnboarding);
    } catch {
      onMutate?.(optimisticOnboarding);
    } finally {
      setDismissing(false);
    }
  }

  return (
    <section style={{
      background: allDone
        ? "linear-gradient(135deg, #14352A 0%, #0F1923 80%)"
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
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: 14,
          gap: 12,
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: 10,
              fontWeight: 800,
              color: "#22C78E",
              letterSpacing: "0.12em",
              fontFamily: "'JetBrains Mono', monospace",
              marginBottom: 4,
            }}>
              ACTIVATION &middot; {done}/{items.length}
            </div>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#F1F5F9" }}>
              {allDone
                ? "You're activated. Edgecipline is fully tuned to you."
                : nextItem
                  ? `Next: ${nextItem.label}`
                  : "Finish activation to unlock the full coach."}
            </div>
            {!allDone && (
              <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 4 }}>
Start, setup, import. Your progress saves after every step.
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
          height: 4,
          borderRadius: 99,
          background: "rgba(255,255,255,0.06)",
          overflow: "hidden",
          marginBottom: 14,
        }}>
          <div style={{
            height: "100%",
            width: `${pct}%`,
            background: allDone
              ? "linear-gradient(90deg, #22C78E, #F59E0B)"
              : "linear-gradient(90deg, #22C78E, #0D9E6E)",
            transition: "width 0.4s ease",
          }} />
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          {items.map((item) => {
            const isDone = rowDone(item, onboarding);
            const labelText = item.label;
            const subText = item.sub;
            const linkHref = item.href;

            return (
              <Link
                key={item.key}
                href={linkHref}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 12px",
                  borderRadius: 10,
                  background: isDone ? "rgba(34,199,142,0.06)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${isDone ? "rgba(34,199,142,0.2)" : "rgba(255,255,255,0.06)"}`,
                  textDecoration: "none",
                  color: "inherit",
                  transition: "background 0.2s",
                }}
              >
                <div style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  flexShrink: 0,
                  background: isDone ? "#22C78E" : "transparent",
                  border: `2px solid ${isDone ? "#22C78E" : "#475569"}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#0F1923",
                  fontSize: 12,
                  fontWeight: 900,
                }}>
                  {isDone ? <span aria-hidden="true">&#10003;</span> : ""}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 12,
                    fontWeight: 800,
                    color: isDone ? "#94A3B8" : "#F1F5F9",
                    textDecoration: isDone ? "line-through" : "none",
                  }}>
                    {labelText}
                  </div>
                  <div style={{ fontSize: 10, color: "#64748B", marginTop: 2 }}>
                    {subText}
                  </div>
                </div>
                {!isDone && (
                  <span style={{ fontSize: 16, color: "#22C78E", fontWeight: 700 }}>&rarr;</span>
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
