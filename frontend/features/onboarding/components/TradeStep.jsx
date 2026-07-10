"use client";

import Link from "next/link";
import { Upload, PencilLine, ArrowRight, Coffee, AlertTriangle } from "lucide-react";

// Three parallel paths so every kind of new user gets a sensible doorway:
//
//   1. Upload a screenshot — fastest for active traders
//   2. Log manually        — for users without a screenshot or with weird brokers
//   3. "I haven't traded yet" — explorer / paper-trader path; marks tradeSkipped
//                              so the funnel still advances and the first
//                              insight uses the no-pressure explorer variant
//
// We also surface a tiny "OCR failed" reassurance row that links to the
// manual entry route — if the screenshot upload errors out, the user has a
// one-click escape that preserves their progress.
export default function TradeStep({ market, onSkipTrade, onSkipping, skipping, error }) {
  const indianRoot = market === "Indian_Market" ? "/indian-market" : "";
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <Link
        href={`${indianRoot}/upload-trade?onboarding=1`}
        style={ctaCard("#22C78E")}
      >
        <span aria-hidden style={iconBubble("#22C78E")}>
          <Upload size={18} />
        </span>
        <div style={{ flex: 1 }}>
          <div style={titleStyle}>Upload a screenshot</div>
          <div style={subStyle}>AI fills in the trade details from your broker UI. ~30 seconds.</div>
        </div>
        <ArrowRight size={16} color="#22C78E" />
      </Link>

      <Link
        href={`${indianRoot}/add-trade?onboarding=1`}
        style={ctaCard("#8B5CF6")}
      >
        <span aria-hidden style={iconBubble("#8B5CF6")}>
          <PencilLine size={18} />
        </span>
        <div style={{ flex: 1 }}>
          <div style={titleStyle}>Log manually</div>
          <div style={subStyle}>No screenshot? Type entry, exit, and P&amp;L. ~60 seconds.</div>
        </div>
        <ArrowRight size={16} color="#8B5CF6" />
      </Link>

      <button
        type="button"
        onClick={onSkipTrade}
        disabled={skipping || onSkipping}
        style={{
          ...ctaCard("#94A3B8"),
          textAlign: "left",
          width: "100%",
          fontFamily: "inherit",
          cursor: skipping ? "default" : "pointer",
          background: "rgba(148,163,184,0.06)",
        }}
      >
        <span aria-hidden style={iconBubble("#94A3B8")}>
          <Coffee size={18} />
        </span>
        <div style={{ flex: 1 }}>
          <div style={titleStyle}>I haven't traded yet</div>
          <div style={subStyle}>Demo / paper / just exploring. We'll set you up so the coach is ready when your first trade lands.</div>
        </div>
        <ArrowRight size={16} color="#94A3B8" />
      </button>

      {/* OCR fallback line — visible always, low contrast. The upload-trade
          page itself shows a richer error UI; this is just a hint while the
          user is choosing a path. */}
      <div style={{
        marginTop: 4,
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        fontSize: 11,
        color: "#64748B",
        lineHeight: 1.55,
      }}>
        <AlertTriangle size={12} style={{ marginTop: 1, flexShrink: 0 }} />
        <span>
          Screenshot didn't parse? You can always{" "}
          <Link href={`${indianRoot}/add-trade?onboarding=1&fromUploadFailure=1`} style={{ color: "#22C78E", fontWeight: 700 }}>
            switch to manual entry
          </Link>
          {" "}— your trade-step progress is saved either way.
        </span>
      </div>

      <p style={{ margin: "6px 0 0", fontSize: 11, color: "#64748B", lineHeight: 1.55, textAlign: "center" }}>
        We mark this step done automatically the moment a trade saves — even if you close this page.
      </p>

      {error && (
        <div style={{
          marginTop: 6,
          padding: "8px 10px",
          borderRadius: 8,
          background: "rgba(214,59,59,0.10)",
          border: "1px solid rgba(214,59,59,0.30)",
          color: "#FCA5A5",
          fontSize: 11,
        }}>
          Couldn't save that just now — try again, or pick a different path above.
        </div>
      )}
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
    width: 36, height: 36, borderRadius: 10,
    background: `${accent}22`,
    color: accent,
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    flexShrink: 0,
  };
}

const titleStyle = { fontSize: 13, fontWeight: 800, color: "#F1F5F9", marginBottom: 2 };
const subStyle   = { fontSize: 11, color: "#94A3B8", lineHeight: 1.5 };
