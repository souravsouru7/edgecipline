"use client";

import React from "react";
import { Info } from "lucide-react";
import IssueReporterButton from "./IssueReporterButton";

/**
 * Displayed inside upload-trade pages after OCR extraction. Reminds the user
 * to verify the extracted values before saving and gives them a one-tap path
 * to report any OCR mistake — the form ships the extracted values alongside
 * the report so the training set keeps growing.
 *
 * Props:
 *   ocrData       — extracted values, used both for the snapshot and for the
 *                   summary chips rendered to the user
 *   marketType    — "Forex" | "Indian_Market"
 *   module        — e.g. "upload-trade-forex"
 */
export default function OcrConfirmationBanner({ ocrData, marketType, module }) {
  if (!ocrData) return null;

  const chips = [
    ["Symbol", ocrData.symbol || ocrData.pair],
    ["Entry", ocrData.entry ?? ocrData.entryPrice],
    ["Exit", ocrData.exit ?? ocrData.exitPrice],
    ["Stop Loss", ocrData.stopLoss],
    ["Quantity", ocrData.quantity],
    ["P/L", ocrData.profit],
    ["Date", ocrData.date || ocrData.tradeDate],
    ["Type", ocrData.tradeType || ocrData.type],
  ].filter(([, v]) => v !== undefined && v !== null && v !== "");

  return (
    <div
      style={{
        background: "linear-gradient(135deg, rgba(96, 165, 250, 0.08), rgba(34, 197, 94, 0.06))",
        border: "1px solid rgba(96, 165, 250, 0.30)",
        borderRadius: 12,
        padding: "14px 16px",
        marginBottom: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
        <Info size={18} color="#60a5fa" style={{ flexShrink: 0, marginTop: 2 }} />
        <div>
          <div style={{ fontWeight: 600, color: "#e6edf7", fontSize: 14, marginBottom: 2 }}>
            Please verify the extracted values before saving.
          </div>
          <div style={{ color: "#94a3b8", fontSize: 12 }}>
            OCR may occasionally make mistakes — quickly check the fields below.
          </div>
        </div>
      </div>

      {chips.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginBottom: 12,
          }}
        >
          {chips.map(([label, value]) => (
            <div
              key={label}
              style={{
                background: "rgba(15, 23, 42, 0.65)",
                border: "1px solid rgba(120, 140, 180, 0.22)",
                borderRadius: 6,
                padding: "4px 9px",
                fontSize: 12,
                color: "#cbd5e1",
              }}
            >
              <span style={{ color: "#94a3b8", marginRight: 4 }}>{label}:</span>
              <strong style={{ color: "#e6edf7" }}>{String(value)}</strong>
            </div>
          ))}
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 12, color: "#94a3b8" }}>
          Found an issue with the extracted data?
        </span>
        <IssueReporterButton
          label="Report OCR Issue"
          variant="inline"
          defaultCategory="OCR_EXTRACTION"
          defaultModule={module || "ocr-extraction"}
          marketType={marketType || "Unknown"}
          ocrDataSnapshot={ocrData}
        />
      </div>
    </div>
  );
}
