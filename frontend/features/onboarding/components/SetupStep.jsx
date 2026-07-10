"use client";

import { Pencil } from "lucide-react";

// `selectedStyle` is the style object returned by the server (has id, label,
// seedSetup{name, rules}). We render the seed inline so the user can see the
// template they'll get without clicking through.
export default function SetupStep({ selectedStyle, customising, custom, onCustomToggle, onCustomChange }) {
  const seed = selectedStyle?.seedSetup;
  if (!seed) {
    return <div style={{ color: "#94A3B8", fontSize: 12 }}>Pick a trading style first.</div>;
  }
  return (
    <div>
      <div style={{
        padding: "14px 14px",
        borderRadius: 12,
        background: "rgba(34,199,142,0.06)",
        border: "1px solid rgba(34,199,142,0.18)",
        marginBottom: 12,
      }}>
        <div style={{ fontSize: 10, color: "#22C78E", letterSpacing: "0.1em", fontWeight: 800, marginBottom: 6, textTransform: "uppercase" }}>
          Default setup for {selectedStyle.label}
        </div>
        <div style={{ fontSize: 14, fontWeight: 800, color: "#F1F5F9", marginBottom: 8 }}>
          {customising ? (custom?.name || seed.name) : seed.name}
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, color: "#CBD5E1", fontSize: 12, lineHeight: 1.6 }}>
          {(customising ? (custom?.rules || []) : seed.rules).map((rule, i) => (
            <li key={i}>{rule}</li>
          ))}
        </ul>
      </div>

      {customising ? (
        <div style={{ display: "grid", gap: 10 }}>
          <input
            value={custom?.name || ""}
            onChange={(event) => onCustomChange({ ...custom, name: event.target.value.slice(0, 80) })}
            placeholder="Setup name (e.g. Daily breakout)"
            style={inputStyle}
          />
          {Array.from({ length: Math.max(3, (custom?.rules || []).length) }).map((_, i) => (
            <input
              key={i}
              value={(custom?.rules || [])[i] || ""}
              onChange={(event) => {
                const next = [...(custom?.rules || [])];
                next[i] = event.target.value.slice(0, 200);
                onCustomChange({ ...custom, rules: next.filter((value, idx) => value || idx < (custom?.rules || []).length) });
              }}
              placeholder={`Rule ${i + 1}`}
              style={inputStyle}
            />
          ))}
          <button
            type="button"
            onClick={onCustomToggle}
            style={ghostBtnStyle}
          >
            Use the default instead
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onCustomToggle}
          style={{ ...ghostBtnStyle, display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <Pencil size={12} /> Customise this setup
        </button>
      )}
    </div>
  );
}

const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.12)",
  color: "#F1F5F9",
  fontSize: 12,
  fontFamily: "inherit",
  outline: "none",
};

const ghostBtnStyle = {
  background: "transparent",
  border: "1px dashed rgba(255,255,255,0.15)",
  color: "#94A3B8",
  padding: "8px 12px",
  borderRadius: 10,
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
};
