"use client";

// Horizontal milestone strip — visualizes the goal-gradient effect. Earned
// milestones light up amber. The "next" milestone shows a progress ring
// based on how close the user is. Anti-shame: no red, no failure copy.

export default function StreakMilestones({ milestones = [], current = 0, longest = 0 }) {
  if (!milestones.length) return null;
  const nextIdx = milestones.findIndex((m) => !m.earned && m.days > current);

  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      {milestones.map((m, i) => {
        const earned = m.earned || current >= m.days;
        const isNext = i === nextIdx;
        const progress = isNext ? Math.min(1, current / m.days) : earned ? 1 : 0;
        return (
          <div
            key={m.days}
            style={{
              flex: "0 0 auto",
              padding: "10px 14px",
              borderRadius: 12,
              minWidth: 88,
              textAlign: "center",
              background: earned ? "linear-gradient(135deg, #FFF7E0 0%, #FFE2B0 100%)" : "#F8FAFC",
              border: `1px solid ${earned ? "#F59E0B" : isNext ? "#CBD5E1" : "#E2E8F0"}`,
              opacity: earned ? 1 : isNext ? 0.95 : 0.6,
              transition: "all 200ms ease",
            }}
          >
            <div style={{
              fontSize: 20, fontWeight: 800,
              color: earned ? "#7A3E0B" : "#475569",
              lineHeight: 1,
            }}>
              {m.days}
            </div>
            <div style={{
              fontSize: 9, letterSpacing: 0.1, marginTop: 4,
              color: earned ? "#7A3E0B" : "#94A3B8",
              fontWeight: 700, textTransform: "uppercase",
            }}>
              {earned ? "Earned" : isNext ? `${Math.round(progress * 100)}%` : "Next"}
            </div>
          </div>
        );
      })}
      <div style={{
        flex: "0 0 auto", padding: "10px 14px", borderRadius: 12, minWidth: 100, textAlign: "center",
        background: "#F8FAFC", border: "1px dashed #CBD5E1",
      }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: "#475569", lineHeight: 1 }}>{longest}</div>
        <div style={{ fontSize: 9, letterSpacing: 0.1, marginTop: 4, color: "#94A3B8", fontWeight: 700, textTransform: "uppercase" }}>
          Personal Best
        </div>
      </div>
    </div>
  );
}
