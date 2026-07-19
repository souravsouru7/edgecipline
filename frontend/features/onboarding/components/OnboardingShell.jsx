"use client";

import { Sparkles, Check } from "lucide-react";

// Step labels are rendered top-of-stepper as a horizontal progress trail. We
// take the funnel array straight from the backend so the labels and order can
// be tuned server-side without redeploying the frontend.
export default function OnboardingShell({
  funnel,
  title,
  subtitle,
  primaryLabel,
  primaryDisabled,
  primaryLoading,
  onPrimary,
  secondaryLabel,
  onSecondary,
  skipLabel,
  onSkip,
  children,
}) {
  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(180deg, #0F1923 0%, #182333 100%)",
      color: "#F1F5F9",
      fontFamily: "var(--font-plus-jakarta-sans)",
      display: "flex",
      flexDirection: "column",
    }}>
      <header style={{
        padding: "20px 24px 0",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{
            width: 30, height: 30, borderRadius: 10,
            background: "rgba(34,199,142,0.18)",
            color: "#22C78E",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
          }}>
            <Sparkles size={16} />
          </span>
          <div>
            <div style={{ fontSize: 11, color: "#94A3B8", letterSpacing: "0.1em", fontWeight: 700, textTransform: "uppercase" }}>
              Onboarding
            </div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#F1F5F9" }}>
              5-minute setup
            </div>
          </div>
        </div>

        {skipLabel && (
          <button
            type="button"
            onClick={onSkip}
            style={{
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "#94A3B8",
              padding: "8px 12px",
              borderRadius: 10,
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {skipLabel}
          </button>
        )}
      </header>

      <div style={{ padding: "16px 24px 0" }}>
        <FunnelTrail funnel={funnel} />
      </div>

      <main style={{
        flex: 1,
        padding: "20px 20px 32px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}>
        <section style={{
          width: "100%",
          maxWidth: 520,
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 18,
          padding: "26px 24px 24px",
          boxShadow: "0 16px 40px rgba(0,0,0,0.25)",
        }}>
          <div style={{ marginBottom: 16 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#F1F5F9", lineHeight: 1.2 }}>
              {title}
            </h1>
            {subtitle && (
              <p style={{ margin: "6px 0 0", fontSize: 13, color: "#94A3B8", lineHeight: 1.6 }}>
                {subtitle}
              </p>
            )}
          </div>

          <div>{children}</div>

          <div style={{
            marginTop: 22,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}>
            {secondaryLabel && (
              <button
                type="button"
                onClick={onSecondary}
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.12)",
                  color: "#94A3B8",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {secondaryLabel}
              </button>
            )}
            <button
              type="button"
              onClick={onPrimary}
              disabled={primaryDisabled || primaryLoading}
              style={{
                flex: 1,
                padding: "12px 18px",
                borderRadius: 12,
                background: primaryDisabled
                  ? "rgba(34,199,142,0.25)"
                  : "linear-gradient(135deg, #22C78E, #0D9E6E)",
                color: "#FFFFFF",
                border: "none",
                fontWeight: 800,
                fontSize: 13,
                cursor: primaryDisabled ? "not-allowed" : "pointer",
                boxShadow: primaryDisabled ? "none" : "0 8px 20px rgba(13,158,110,0.35)",
                opacity: primaryLoading ? 0.7 : 1,
              }}
            >
              {primaryLoading ? "Working…" : primaryLabel}
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}

function FunnelTrail({ funnel }) {
  const steps = funnel?.steps || [];
  if (steps.length === 0) return null;
  return (
    <div
      role="list"
      aria-label="Onboarding progress"
      style={{
        display: "flex",
        gap: 6,
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {steps.map((step) => (
        <div
          key={step.key}
          role="listitem"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 10px",
            borderRadius: 999,
            border: `1px solid ${step.completed ? "rgba(34,199,142,0.45)" : "rgba(255,255,255,0.08)"}`,
            background: step.completed ? "rgba(34,199,142,0.12)" : "rgba(255,255,255,0.03)",
            color: step.completed ? "#22C78E" : "#94A3B8",
            fontSize: 10.5,
            fontWeight: 800,
            letterSpacing: "0.02em",
          }}
        >
          {step.completed ? (
            <Check size={11} />
          ) : (
            <span style={{ width: 11, height: 11, borderRadius: "50%", border: "1.5px solid currentColor" }} />
          )}
          {step.label}
        </div>
      ))}
    </div>
  );
}
