"use client";

/** tone: "neutral" | "accent" | "profit" | "loss" | "warning" */
export default function Badge({ tone = "neutral", icon = null, className, children, ...rest }) {
  return (
    <span className={["ec-badge", tone !== "neutral" && `ec-badge--${tone}`, className].filter(Boolean).join(" ")} {...rest}>
      {icon}
      {children}
    </span>
  );
}
