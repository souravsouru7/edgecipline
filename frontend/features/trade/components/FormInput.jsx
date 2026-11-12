"use client";

import { blockInvalidNumberKeys } from "@/features/trade/lib/numericInput";

// ─── shared style constants ────────────────────────────────────────────────────
export const labelStyle = {
  display: "block", fontSize: "var(--fs-2xs)", fontWeight: 600, color: "var(--lg-sub, #4A5568)",
  letterSpacing: "0.1em", marginBottom: 7, fontFamily: "var(--lg-mono, 'JetBrains Mono', monospace)",
};

export const inputBase = {
  width: "100%", padding: "11px 14px", fontSize: 13,
  fontFamily: "var(--lg-mono, 'JetBrains Mono', monospace)", color: "var(--lg-ink, #0F1923)",
  background: "var(--lg-soft, #F8FAFC)", border: "1.5px solid var(--lg-line, #E2E8F0)",
  borderRadius: 8, outline: "none", transition: "all 0.2s ease",
};

export const onFocusGreen = e => {
  e.currentTarget.style.borderColor = "var(--lg-green, #0D9E6E)";
  e.currentTarget.style.boxShadow   = "0 0 0 3px rgba(13,158,110,0.10)";
  e.currentTarget.style.background  = "#F0FDF9";
};

export const onBlurReset = e => {
  e.currentTarget.style.borderColor = "var(--lg-line, #E2E8F0)";
  e.currentTarget.style.boxShadow   = "none";
  e.currentTarget.style.background  = "var(--lg-soft, #F8FAFC)";
};

// Block e/E/+ in number inputs — browsers allow these for scientific notation
// but they're nonsensical for trade values.
/**
 * FormInput — labelled text/number/date input field.
 */
export function FormInput({ label, name, value, onChange, placeholder, type = "text", style, ...props }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input
        type={type} name={name}
        placeholder={placeholder}
        value={value || ""}
        onChange={onChange}
        style={{ ...inputBase, ...style }}
        onFocus={onFocusGreen}
        onBlur={onBlurReset}
        onKeyDown={type === "number" ? blockInvalidNumberKeys : undefined}
        {...props}
      />
    </div>
  );
}
