"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import CoachChat from "./CoachChat";

// Drop-in trigger that opens the Coach chat in a modal, anchored to whatever
// surface the button lives on (insight card, trade row, reflection card,
// dashboard, etc.). Variants tune the visual weight without changing
// behaviour.
//
// Usage:
//   <AskCoachButton anchor={{ kind: "insight", refId: insight.id, label: insight.title }} />
//   <AskCoachButton variant="ghost" anchor={{ kind: "reflection", label: "Today's reflection" }} defaultPrompt="Coach me on today." />
export default function AskCoachButton({
  anchor,
  market,
  defaultPrompt,
  label = "Ask Coach",
  variant = "primary",
  size = "sm",
}) {
  const [open, setOpen] = useState(false);

  const style = stylesFor(variant, size);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={anchor?.label ? `Ask coach about ${anchor.label}` : "Ask coach"}
        style={style}
      >
        <Sparkles size={size === "lg" ? 14 : 12} />
        {label}
      </button>

      <CoachChat
        open={open}
        onClose={() => setOpen(false)}
        mode="modal"
        anchor={anchor}
        market={market}
        defaultPrompt={defaultPrompt}
      />
    </>
  );
}

function stylesFor(variant, size) {
  const base = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    border: "none",
    cursor: "pointer",
    fontWeight: 800,
    letterSpacing: "0.02em",
    fontFamily: "inherit",
  };
  const sizeMap = {
    sm: { padding: "6px 10px", borderRadius: 999, fontSize: 11 },
    md: { padding: "8px 12px", borderRadius: 10, fontSize: 12 },
    lg: { padding: "10px 16px", borderRadius: 12, fontSize: 13 },
  };
  const variantMap = {
    primary: { background: "#7C3AED", color: "#FFFFFF" },
    ghost:   { background: "transparent", color: "#7C3AED", border: "1px solid rgba(139,92,246,0.35)" },
    link:    { background: "transparent", color: "#7C3AED", padding: 0, border: "none" },
  };
  return { ...base, ...sizeMap[size], ...variantMap[variant] };
}
