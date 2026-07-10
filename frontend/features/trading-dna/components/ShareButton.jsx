"use client";

import { useState } from "react";
import { C, FONT } from "./tokens";

export default function ShareButton({ onClick, disabled }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: "9px 18px",
        borderRadius: 10,
        border: `1px solid ${C.primary}`,
        background: disabled ? C.rowDivider : hover ? "#1E293B" : C.primary,
        color: disabled ? C.muted : "#F8FAFC",
        fontSize: 12,
        fontWeight: 800,
        fontFamily: FONT.body,
        cursor: disabled ? "not-allowed" : "pointer",
        letterSpacing: "0.04em",
        transition: "background 0.15s",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      <span aria-hidden style={{ fontSize: 13 }}>↗</span>
      Share
    </button>
  );
}
