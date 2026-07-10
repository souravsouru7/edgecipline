"use client";

const CATEGORY_COLOR = {
  risk_management: "#E53935",
  discipline:      "#F59E0B",
  psychology:      "#3B82F6",
  journal:         "#0D9E6E",
  strategy:        "#8B5CF6",
};

const CATEGORY_LABEL = {
  risk_management: "Risk",
  discipline:      "Discipline",
  psychology:      "Psychology",
  journal:         "Journal",
  strategy:        "Strategy",
};

const DIFFICULTY_LABEL = {
  beginner:     "Beginner",
  intermediate: "Intermediate",
  advanced:     "Advanced",
};

export function CategoryBadge({ category }) {
  const color = CATEGORY_COLOR[category] || "#64748B";
  const label = CATEGORY_LABEL[category] || category;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        color: "#fff",
        background: color,
        letterSpacing: "0.03em",
        textTransform: "uppercase",
      }}
    >
      {label}
    </span>
  );
}

export function DifficultyDot({ difficulty }) {
  const colors = { beginner: "#0D9E6E", intermediate: "#F59E0B", advanced: "#E53935" };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "#64748B" }}>
      <span
        style={{
          display: "inline-block",
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: colors[difficulty] || "#94A3B8",
        }}
      />
      {DIFFICULTY_LABEL[difficulty] || difficulty}
    </span>
  );
}

export function ProgressBar({ percent, color }) {
  const clampedPct = Math.min(Math.max(percent || 0, 0), 100);
  const barColor = color || "#0D9E6E";
  return (
    <div style={{ position: "relative" }}>
      <div
        style={{
          width: "100%",
          height: 6,
          background: "#E2E8F0",
          borderRadius: 3,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${clampedPct}%`,
            height: "100%",
            background: barColor,
            borderRadius: 3,
            transition: "width 0.4s ease",
          }}
        />
      </div>
    </div>
  );
}

export function ProgressLabel({ current, target, unit, progressMode }) {
  if (progressMode === "percentage") {
    return (
      <span style={{ fontSize: 12, color: "#64748B" }}>
        {current} / {target} {unit} evaluated
      </span>
    );
  }
  return (
    <span style={{ fontSize: 12, color: "#64748B" }}>
      {current} / {target} {unit}
    </span>
  );
}
