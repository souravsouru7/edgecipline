"use client";

import React, { useState } from "react";
import { AlertCircle } from "lucide-react";
import IssueReportModal from "./IssueReportModal";

const theme = {
  text: "#0F1923",
  textSecondary: "#4A5568",
  border: "#E2E8F0",
  primary: "#0D9E6E",
  primaryBg: "rgba(13,158,110,0.08)",
};

/**
 * Inline "Report Issue" / "Need Help?" trigger button.
 * Pass the same context props (category, market, module, OCR snapshot) as
 * IssueReportModal — they are forwarded.
 *
 * Variants:
 *   "inline"   — small ghost button suitable for inside cards
 *   "primary"  — solid CTA
 *   "subtle"   — text-only link style
 */
export default function IssueReporterButton({
  label = "Report Issue",
  variant = "inline",
  defaultCategory = "OTHER",
  defaultModule = "",
  marketType = "Unknown",
  ocrDataSnapshot = null,
  tradeId = null,
  onSubmitted,
  style: extraStyle,
}) {
  const [open, setOpen] = useState(false);

  const baseStyle = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    cursor: "pointer",
    fontSize: 13,
    borderRadius: 8,
    fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
    transition: "background 120ms ease, border-color 120ms ease",
  };

  let style;
  if (variant === "primary") {
    style = {
      ...baseStyle,
      background: `linear-gradient(135deg, ${theme.primary}, ${theme.text})`,
      color: "#FFFFFF",
      border: "none",
      padding: "10px 18px",
      fontWeight: 800,
    };
  } else if (variant === "subtle") {
    style = {
      ...baseStyle,
      background: "transparent",
      color: theme.primary,
      border: "none",
      padding: "4px 6px",
      textDecoration: "underline",
      textUnderlineOffset: 2,
      fontWeight: 700,
    };
  } else {
    style = {
      ...baseStyle,
      background: theme.primaryBg,
      color: theme.primary,
      border: `1px solid rgba(13,158,110,0.3)`,
      padding: "8px 14px",
      fontWeight: 700,
    };
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={{ ...style, ...extraStyle }}>
        <AlertCircle size={14} />
        {label}
      </button>
      <IssueReportModal
        open={open}
        onClose={() => setOpen(false)}
        defaultCategory={defaultCategory}
        defaultModule={defaultModule}
        marketType={marketType}
        ocrDataSnapshot={ocrDataSnapshot}
        tradeId={tradeId}
        onSubmitted={onSubmitted}
      />
    </>
  );
}
