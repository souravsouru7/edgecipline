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
              background: earned ? "var(--lg-gold-soft, #FFF1D0)" : "var(--lg-soft, #F8FAFC)",
              border: `1px solid ${earned ? "var(--lg-gold, #F59E0B)" : isNext ? "var(--lg-line-strong, #CBD5E1)" : "var(--lg-line, #E2E8F0)"}`,
              opacity: earned ? 1 : isNext ? 0.95 : 0.6,
              transition: "all 200ms ease",
            }}
          >
            <div style={{
              fontSize: 20, fontWeight: 800,
              color: earned ? "var(--lg-gold, #7A3E0B)" : "var(--lg-sub, #475569)",
              lineHeight: 1,
            }}>
              {m.days}
            </div>
            <div style={{
              fontSize: "var(--fs-2xs)", letterSpacing: 0.1, marginTop: 4,
              color: earned ? "var(--lg-gold, #7A3E0B)" : "var(--lg-muted, #94A3B8)",
              fontWeight: 700, textTransform: "uppercase",
            }}>
              {earned ? "Earned" : isNext ? `${Math.round(progress * 100)}%` : "Next"}
            </div>
          </div>
        );
      })}
      <div style={{
        flex: "0 0 auto", padding: "10px 14px", borderRadius: 12, minWidth: 100, textAlign: "center",
        background: "var(--lg-soft, #F8FAFC)", border: "1px dashed var(--lg-line-strong, #CBD5E1)",
      }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: "var(--lg-ink, #475569)", lineHeight: 1 }}>{longest}</div>
        <div style={{ fontSize: "var(--fs-2xs)", letterSpacing: 0.1, marginTop: 4, color: "var(--lg-muted, #94A3B8)", fontWeight: 700, textTransform: "uppercase" }}>
          Personal best
        </div>
      </div>
    </div>
  );
}
