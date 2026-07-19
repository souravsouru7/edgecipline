"use client";

import Link from "next/link";
import { ArrowRight, Camera, FilePenLine, PlayCircle } from "lucide-react";

export default function TradeStep({ market }) {
  const marketRoot = market === "Indian_Market" ? "/indian-market" : "";

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <Link href={`${marketRoot}/upload-trade?onboarding=1`} style={ctaCard("#22C78E")}>
        <span aria-hidden style={iconBubble("#22C78E")}>
          <Camera size={18} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={titleStyle}>Import broker screenshot</div>
          <div style={subStyle}>Upload your screenshot and let AI fill the trade details.</div>
        </div>
        <ArrowRight size={16} color="#22C78E" />
      </Link>

      <Link href={`${marketRoot}/upload-trade?onboarding=1&demo=1`} style={ctaCard("#0EA5E9")}>
        <span aria-hidden style={iconBubble("#0EA5E9")}>
          <PlayCircle size={18} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={titleStyle}>Try sample demo</div>
          <div style={subStyle}>See the import flow with sample data. Nothing fake is saved.</div>
        </div>
        <ArrowRight size={16} color="#0EA5E9" />
      </Link>

      <Link href={`${marketRoot}/add-trade?onboarding=1`} style={ctaCard("#8B5CF6")}>
        <span aria-hidden style={iconBubble("#8B5CF6")}>
          <FilePenLine size={18} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={titleStyle}>Enter trade manually</div>
          <div style={subStyle}>No screenshot? Add entry, exit, P&amp;L, and setup yourself.</div>
        </div>
        <ArrowRight size={16} color="#8B5CF6" />
      </Link>

      <p style={{ margin: "4px 0 0", fontSize: 11, color: "#64748B", lineHeight: 1.55, textAlign: "center" }}>
        After saving the trade, we&apos;ll bring you to your coach to review it.
      </p>
    </div>
  );
}

function ctaCard(accent) {
  return {
    display: "flex",
    gap: 12,
    alignItems: "center",
    padding: "14px 14px",
    borderRadius: 12,
    background: `${accent}10`,
    border: `1px solid ${accent}40`,
    textDecoration: "none",
    color: "inherit",
  };
}

function iconBubble(accent) {
  return {
    width: 36,
    height: 36,
    borderRadius: 10,
    background: `${accent}22`,
    color: accent,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  };
}

const titleStyle = { fontSize: 13, fontWeight: 800, color: "#F1F5F9", marginBottom: 2 };
const subStyle = { fontSize: 11, color: "#94A3B8", lineHeight: 1.5 };
