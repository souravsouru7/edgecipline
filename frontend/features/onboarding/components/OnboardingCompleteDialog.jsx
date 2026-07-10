"use client";

import FocusTrap from "@/features/shared/components/FocusTrap";

export default function OnboardingCompleteDialog({ onDashboard, onClose }) {
  return (
    <div style={{
      position: "fixed",
      inset: 0,
      zIndex: 10000,
      background: "rgba(5, 10, 18, 0.72)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 20,
      fontFamily: "var(--font-plus-jakarta-sans)",
    }}>
      <FocusTrap>
        <div role="dialog" aria-modal="true" aria-label="Onboarding complete" style={{
          width: "100%",
          maxWidth: 420,
          borderRadius: 16,
          background: "#FFFFFF",
          border: "1px solid rgba(15,25,35,0.08)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.28)",
          overflow: "hidden",
        }}>
          <div style={{ height: 4, background: "linear-gradient(90deg, #22C78E, #0D9E6E)" }} />
          <div style={{ padding: "24px 24px 22px", textAlign: "center" }}>
            <div style={{
              width: 52,
              height: 52,
              borderRadius: "50%",
              margin: "0 auto 14px",
              background: "rgba(34,199,142,0.12)",
              border: "1px solid rgba(34,199,142,0.32)",
              color: "#0D9E6E",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              fontWeight: 900,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}>
              Done
            </div>
            <div style={{
              fontSize: 10,
              fontWeight: 800,
              color: "#0D9E6E",
              letterSpacing: "0.12em",
              fontFamily: "'JetBrains Mono', monospace",
              textTransform: "uppercase",
              marginBottom: 8,
            }}>
              Setup finished
            </div>
            <h2 style={{ margin: 0, color: "#0F1923", fontSize: 22, lineHeight: 1.2, fontWeight: 900 }}>
              Your journal is ready.
            </h2>
            <p style={{
              margin: "10px 0 20px",
              color: "#64748B",
              fontSize: 13,
              lineHeight: 1.65,
            }}>
              You finished the activation path: market, style, setup, first trade, AI insight, and journal. Open dashboard to see your live stats and keep building from real data.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  flex: "0 0 auto",
                  padding: "11px 14px",
                  borderRadius: 10,
                  border: "1px solid #E2E8F0",
                  background: "#FFFFFF",
                  color: "#475569",
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                Stay here
              </button>
              <button
                type="button"
                onClick={onDashboard}
                style={{
                  flex: 1,
                  padding: "11px 16px",
                  borderRadius: 10,
                  border: "none",
                  background: "linear-gradient(135deg, #22C78E, #0D9E6E)",
                  color: "#FFFFFF",
                  fontSize: 13,
                  fontWeight: 900,
                  cursor: "pointer",
                  boxShadow: "0 8px 22px rgba(13,158,110,0.28)",
                }}
              >
                Open dashboard
              </button>
            </div>
          </div>
        </div>
      </FocusTrap>
    </div>
  );
}
