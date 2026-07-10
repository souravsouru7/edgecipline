"use client";

import { Sparkles } from "lucide-react";

export default function CoachQuickPrompts({ prompts = [], onSelect, disabled }) {
  if (!prompts.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {prompts.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onSelect?.(p)}
          disabled={disabled}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 10px",
            borderRadius: 999,
            border: "1px solid #E2E8F0",
            background: "#FFFFFF",
            color: "#0F1923",
            fontSize: 11.5,
            fontWeight: 700,
            cursor: disabled ? "default" : "pointer",
            opacity: disabled ? 0.6 : 1,
            transition: "background 0.12s ease, border 0.12s ease",
          }}
        >
          <Sparkles size={11} color="#7C3AED" />
          {p.label}
        </button>
      ))}
    </div>
  );
}
