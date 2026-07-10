"use client";

import Link from "next/link";
import { Sparkles, Upload, ArrowRight } from "lucide-react";

// Sits on top of any dashboard panel when the user has no real data. We keep
// the panel underneath visible (blurred + dimmed) so the user can see what's
// coming — that's the "never empty" promise. The overlay always offers a
// concrete next action.
export default function EmptyStateOverlay({
  show,
  title = "Your charts wake up after your first trade.",
  body = "Upload a broker screenshot — AI fills the rest. ~30 seconds.",
  ctaHref = "/onboarding?step=tradeAdded",
  ctaLabel = "Add my first trade",
  variant = "sample",
}) {
  if (!show) return null;
  return (
    <div style={{
      position: "absolute",
      inset: 0,
      borderRadius: "inherit",
      background: variant === "sample"
        ? "linear-gradient(180deg, rgba(255,255,255,0.55) 0%, rgba(244,242,238,0.85) 100%)"
        : "rgba(244, 242, 238, 0.9)",
      backdropFilter: "blur(2px)",
      WebkitBackdropFilter: "blur(2px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 16,
      zIndex: 5,
    }}>
      <div style={{
        maxWidth: 320,
        textAlign: "center",
      }}>
        <span style={{
          display: "inline-flex",
          alignItems: "center", justifyContent: "center",
          width: 38, height: 38, borderRadius: 12,
          background: "rgba(13,158,110,0.14)", color: "#0D9E6E",
          marginBottom: 10,
        }}>
          <Sparkles size={18} />
        </span>
        <div style={{ fontSize: 13, fontWeight: 800, color: "#0F1923", lineHeight: 1.35, marginBottom: 4 }}>
          {title}
        </div>
        <div style={{ fontSize: 11.5, color: "#475569", lineHeight: 1.55, marginBottom: 10 }}>
          {body}
        </div>
        <Link
          href={ctaHref}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "8px 14px",
            background: "#0D9E6E", color: "#FFFFFF",
            borderRadius: 999,
            fontSize: 11.5, fontWeight: 800,
            textDecoration: "none",
            boxShadow: "0 6px 14px rgba(13,158,110,0.30)",
          }}
        >
          <Upload size={12} /> {ctaLabel} <ArrowRight size={12} />
        </Link>
      </div>
    </div>
  );
}
