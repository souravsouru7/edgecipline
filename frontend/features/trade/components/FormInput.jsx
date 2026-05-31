"use client";

// ─── shared style constants ────────────────────────────────────────────────────
export const labelStyle = {
  display: "block", fontSize: 10, fontWeight: 600, color: "#4A5568",
  letterSpacing: "0.1em", marginBottom: 7, fontFamily: "'JetBrains Mono',monospace",
};

export const inputBase = {
  width: "100%", padding: "11px 14px", fontSize: 13,
  fontFamily: "'JetBrains Mono',monospace", color: "#0F1923",
  background: "#F8FAFC", border: "1.5px solid #E2E8F0",
  borderRadius: 8, outline: "none", transition: "all 0.2s ease",
};

export const onFocusGreen = e => {
  e.currentTarget.style.borderColor = "#0D9E6E";
  e.currentTarget.style.boxShadow   = "0 0 0 3px rgba(13,158,110,0.10)";
  e.currentTarget.style.background  = "#F0FDF9";
};

export const onBlurReset = e => {
  e.currentTarget.style.borderColor = "#E2E8F0";
  e.currentTarget.style.boxShadow   = "none";
  e.currentTarget.style.background  = "#F8FAFC";
};

// Block e/E/+ in number inputs — browsers allow these for scientific notation
// but they're nonsensical for trade values.
const blockInvalidNumberKeys = (e) => {
  if (["e", "E", "+"].includes(e.key)) e.preventDefault();
};

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
