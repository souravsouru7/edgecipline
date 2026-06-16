"use client";

import React, { useState } from "react";
import { AlertCircle } from "lucide-react";
import IssueReportModal from "./IssueReportModal";

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
    transition: "background 120ms ease, border-color 120ms ease",
  };

  let style;
  if (variant === "primary") {
    style = {
      ...baseStyle,
      background: "linear-gradient(135deg, #2563eb, #1d4ed8)",
      color: "white",
      border: "none",
      padding: "9px 16px",
      fontWeight: 600,
    };
  } else if (variant === "subtle") {
    style = {
      ...baseStyle,
      background: "transparent",
      color: "#60a5fa",
      border: "none",
      padding: "4px 6px",
      textDecoration: "underline",
      textUnderlineOffset: 2,
    };
  } else {
    style = {
      ...baseStyle,
      background: "rgba(96, 165, 250, 0.10)",
      color: "#93c5fd",
      border: "1px solid rgba(96, 165, 250, 0.35)",
      padding: "7px 12px",
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
