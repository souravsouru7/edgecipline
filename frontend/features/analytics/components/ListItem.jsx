"use client";

const colors = { primary: "#0F1923", secondary: "#4A5568", muted: "#94A3B8", border: "#E2E8F0" };

/**
 * ListItem
 * A row with a label on the left and a value on the right, used in timing insight lists.
 */
export default function ListItem({ label, value, color = colors.primary, sub }) {
  const formattedValue = typeof value === "string" && value.startsWith("$-")
    ? "-$" + value.substring(2)
    : value;

  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${colors.border}` }}>
      <div>
        <div style={{ fontSize: 12, color: colors.secondary, fontWeight: 500 }}>{label}</div>
        {sub && <div style={{ fontSize: "var(--fs-2xs)", color: colors.muted }}>{sub}</div>}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color }}>{formattedValue}</div>
    </div>
  );
}
