"use client";

import React from "react";
import { Info } from "lucide-react";
import IssueReporterButton from "./IssueReporterButton";

const theme = {
  text: "#0F1923",
  textMuted: "#64748B",
  border: "#E2E8F0",
  primary: "#0D9E6E",
  gold: "#B8860B",
  error: "#D63B3B",
};

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
        background: "#F8FAFC",
        border: `1px solid ${theme.border}`,
        borderRadius: 12,
        padding: "14px 16px",
        marginBottom: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
        <div style={{
          width: 30, height: 30, borderRadius: 8, flexShrink: 0,
          background: "rgba(13,158,110,0.1)", color: theme.primary,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Info size={16} />
        </div>
        <div>
          <div style={{ fontWeight: 700, color: theme.text, fontSize: 14, marginBottom: 2 }}>
            Please verify the extracted values before saving.
          </div>
          <div style={{ color: theme.textMuted, fontSize: 12 }}>
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
                background: "#FFFFFF",
                border: `1px solid ${theme.border}`,
                borderRadius: 6,
                padding: "4px 9px",
                fontSize: 12,
                color: theme.text,
              }}
            >
              <span style={{ color: theme.textMuted, marginRight: 4 }}>{label}:</span>
              <strong style={{ color: theme.text }}>{String(value)}</strong>
            </div>
          ))}
        </div>
      )}

      {confidence && (
        <div style={{ marginBottom: 12, padding: "9px 10px", borderRadius: 8, background: "#FFFFFF", border: `1px solid ${theme.border}`, color: theme.text, fontSize: 12 }}>
          <strong>{confidence.score}/100 - {decisionLabel}</strong>
          {insights?.brokerType && <span> · Broker: {insights.brokerType}</span>}
          {insights?.imageQuality?.issues?.length > 0 && (
            <div style={{ marginTop: 5, color: theme.gold }}>
              Image checks: {insights.imageQuality.issues.join(", ").replaceAll("_", " ")}
            </div>
          )}
          {confidence.logic?.some((item) => item.failures?.length || item.warnings?.length) && (
            <div style={{ marginTop: 5, color: theme.gold }}>
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
        <span style={{ fontSize: 12, color: theme.textMuted }}>
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
