"use client";

// Category hues stay fixed (they identify the mission type in both themes);
// everything neutral follows the theme through the --lg-* bridge.
export const CATEGORY_COLOR = {
  risk_management: "#E5534B",
  discipline: "#E0A030",
  psychology: "#4C8DF6",
  journal: "var(--lg-green, #0D9E6E)",
  strategy: "#8B6CF6",
};

const CATEGORY_LABEL = {
  risk_management: "Risk",
  discipline: "Discipline",
  psychology: "Psychology",
  journal: "Journal",
  strategy: "Strategy",
};

const DIFFICULTY_LABEL = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" };
const DIFFICULTY_COLOR = { beginner: "var(--lg-green, #0D9E6E)", intermediate: "var(--lg-gold, #F59E0B)", advanced: "var(--lg-red, #E53935)" };

export function CategoryBadge({ category }) {
  const color = CATEGORY_COLOR[category] || "var(--lg-sub, #64748B)";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 600,
        color,
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
      }}
    >
      {CATEGORY_LABEL[category] || category}
    </span>
  );
}

export function DifficultyDot({ difficulty }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--lg-sub, #64748B)" }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: DIFFICULTY_COLOR[difficulty] || "var(--lg-muted, #94A3B8)" }} />
      {DIFFICULTY_LABEL[difficulty] || difficulty}
    </span>
  );
}

export function ProgressBar({ percent, color }) {
  const pct = Math.min(Math.max(Number(percent) || 0, 0), 100);
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      style={{ width: "100%", height: 6, background: "var(--lg-soft-2, #E2E8F0)", borderRadius: 3, overflow: "hidden" }}
    >
      <div style={{ width: `${pct}%`, height: "100%", background: color || "var(--lg-green, #0D9E6E)", borderRadius: 3, transition: "width 0.4s ease" }} />
    </div>
  );
}

export function ProgressLabel({ current, target, unit, progressMode }) {
  return (
    <span style={{ fontSize: 12, color: "var(--lg-sub, #64748B)" }}>
      {current ?? 0} / {target} {unit}{progressMode === "percentage" ? " evaluated" : ""}
    </span>
  );
}
