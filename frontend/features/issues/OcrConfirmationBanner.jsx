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
export default function OcrConfirmationBanner({ ocrData, insights, marketType, module }) {
  if (!ocrData && !insights) return null;

  const confidence = insights?.confidenceReport;
  const decisionLabel = confidence?.decision === "AUTO_APPROVED"
    ? "High confidence"
    : confidence?.decision === "REVIEW_RECOMMENDED"
      ? "Review recommended"
      : "Verification required";

  const chips = [
    ["Symbol", ocrData?.symbol || ocrData?.pair],
    ["Entry", ocrData?.entry ?? ocrData?.entryPrice],
    ["Exit", ocrData?.exit ?? ocrData?.exitPrice],
    ["Stop Loss", ocrData?.stopLoss],
    ["Quantity", ocrData?.quantity],
    ["P/L", ocrData?.profit],
    ["Date", ocrData?.date || ocrData?.tradeDate],
    ["Type", ocrData?.tradeType || ocrData?.type],
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

      {confidence && (
        <div style={{ marginBottom: 12, padding: "9px 10px", borderRadius: 8, background: "rgba(15, 23, 42, 0.55)", color: "#cbd5e1", fontSize: 12 }}>
          <strong>{confidence.score}/100 - {decisionLabel}</strong>
          {insights?.brokerType && <span> | Broker: {insights.brokerType}</span>}
          {insights?.imageQuality?.issues?.length > 0 && (
            <div style={{ marginTop: 5, color: "#f59e0b" }}>
              Image checks: {insights.imageQuality.issues.join(", ").replaceAll("_", " ")}
            </div>
          )}
          {confidence.logic?.some((item) => item.failures?.length || item.warnings?.length) && (
            <div style={{ marginTop: 5, color: "#f59e0b" }}>
              Trade logic requires manual verification before saving.
            </div>
          )}
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
          ocrDataSnapshot={{
            extractedValues: insights?.extractedValues || ocrData || {},
            correctedValues: ocrData || {},
            broker: insights?.brokerType,
            extractionConfidence: confidence?.score,
          }}
        />
      </div>
    </div>
  );
}
