"use client";

import { useState } from "react";
import { C, FONT } from "./tokens";

export default function RegenerateButton({ onClick, isRegenerating, disabled }) {
  const [hover, setHover] = useState(false);

  const label = isRegenerating ? "Regenerating…" : "Regenerate";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || isRegenerating}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: "9px 18px",
        borderRadius: 10,
        border: `1px solid ${C.border}`,
        background: disabled ? C.rowDivider : hover ? C.primary : C.surface,
        color: disabled ? C.muted : hover ? "#F8FAFC" : C.primary,
        fontSize: 12,
        fontWeight: 700,
        fontFamily: FONT.body,
        cursor: disabled || isRegenerating ? "not-allowed" : "pointer",
        letterSpacing: "0.02em",
        transition: "background 0.15s, color 0.15s",
      }}
    >
      {label}
    </button>
  );
}
